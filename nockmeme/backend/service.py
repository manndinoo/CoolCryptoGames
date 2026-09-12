"""The wallet service: request → atomic reservation → build → durable record
→ broadcast → settlement by transaction id → release.

One `WalletService` drives one wallet (its keys, its lock root, its
database). Every step that matters is recorded in the database BEFORE the
step that follows it, so a restart at any point resumes from the record
(`reconcile`): a request with a reservation but no built transaction was
never broadcast and is aborted; a built transaction whose id the node does
not know is broadcast (again — the id is a content hash, a second broadcast
of the same file is the same transaction); a transaction the node holds in
its mempool stays `sent`; one the node reports in a block is `mined` only
when that block is the canonical block at its height, and only then are
its inputs released. Inputs having left the unspent set is never taken as
settlement: it proves that *a* transaction spending them was mined, not
this one (a conflicting spend, or an earlier transaction's merge, would
look the same).

States of a submission: planned → built → sent → mined
                                 ↘ aborted   ↘ refused
"""
from dataclasses import dataclass, asdict
import json
import os
from pathlib import Path
import sqlite3
import time

from wallet_backend import Note, Snapshot, Request, Plan, Planner, WalletError
from chain import ChainError
import fcntl


class PoolQueue:
    """One trade at a time per pool, across every wallet and process on this
    node (pack 8). Two trades built against the same pool note cannot both
    stand: the pool note is one input, the node admits the first spend of
    it and refuses the second at admission (seen live, §A23). So a request
    takes the pool's turn — a file lock per pool lock root — and, before it
    reads the pool and quotes, waits until the previous trade on that pool
    is no longer pending (mined, or gone from the node); then it reads the
    pool AS IT STANDS, quotes, checks the request's slippage floor, builds
    and broadcasts, and records its id for the next in line. The registry
    is a small SQLite file shared by every wallet (`<wallets>/pools.sqlite`).
    """

    def __init__(self, tools, log=None):
        self.tools, self.log = tools, log or (lambda s: None)
        self.dir = tools.wallets
        self.dir.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.dir / "pools.sqlite"), timeout=30, isolation_level=None)
        self.db.execute("CREATE TABLE IF NOT EXISTS pool_trades (pool TEXT PRIMARY KEY, txid TEXT, request TEXT, wallet TEXT, at REAL)")

    def close(self):
        self.db.close()

    class Turn:
        def __init__(self, queue, pool_lock, wait, poll):
            self.queue, self.pool_lock, self.wait, self.poll = queue, pool_lock, wait, poll
            self.fh = None

        def __enter__(self):
            q = self.queue
            self.fh = open(q.dir / f"pool-{self.pool_lock}.lock", "w")
            t0 = time.time()
            fcntl.flock(self.fh, fcntl.LOCK_EX)
            waited = time.time() - t0
            if waited > 1:
                q.log(f"QUEUE\tpool={self.pool_lock[:10]}…\twaited {waited:.0f}s for the pool's turn")
            # the previous trade on this pool must be out of the way
            row = q.db.execute("SELECT txid, request, wallet FROM pool_trades WHERE pool=?", (self.pool_lock,)).fetchone()
            if row and row[0]:
                deadline = time.time() + self.wait
                while True:
                    st = q.tools.tx_status(row[0])
                    if st.state != "pending":
                        q.log(f"QUEUE\tpool={self.pool_lock[:10]}…\tprevious trade {row[1]} ({row[0][:10]}…) is {st.state}: the pool is free")
                        break
                    if time.time() > deadline:
                        fcntl.flock(self.fh, fcntl.LOCK_UN)
                        self.fh.close()
                        raise WalletError(f"pool busy: {row[1]} ({row[0]}) still pending after {self.wait}s")
                    q.log(f"QUEUE\tpool={self.pool_lock[:10]}…\twaiting for {row[1]} ({row[0][:10]}…) to leave the mempool")
                    time.sleep(self.poll)
            return self

        def record(self, txid, request, wallet):
            self.queue.db.execute("INSERT OR REPLACE INTO pool_trades VALUES (?, ?, ?, ?, ?)",
                                  (self.pool_lock, txid, request, wallet, time.time()))

        def __exit__(self, *exc):
            fcntl.flock(self.fh, fcntl.LOCK_UN)
            self.fh.close()
            return False

    def turn(self, pool_lock, wait=900, poll=10):
        return PoolQueue.Turn(self, pool_lock, wait, poll)

STATES = ("planned", "built", "sent", "mined", "refused", "aborted")
ACTIVE = ("planned", "built", "sent")


@dataclass
class Submission:
    request: str
    side: str
    token: str
    state: str
    txid: str = ""
    file: str = ""
    inputs: str = "[]"  # json list of names
    detail: str = ""
    sent_height: int = -1
    mined_height: int = -1
    mined_block: str = ""
    attempts: int = 0
    created: float = 0.0
    updated: float = 0.0

    def input_names(self):
        return json.loads(self.inputs)


class WalletService:
    def __init__(self, tools, who, *, placeholder_address="", placeholder_lock="", lore_bps=50, lore_lock="",
                 fee_bps=100, network_fee=16384, dust=1000, db_path=None, log=None, crash_after=None):
        self.tools, self.who = tools, who
        self.placeholder_address, self.placeholder_lock = placeholder_address, placeholder_lock
        self.lore_bps, self.lore_lock, self.fee_bps = lore_bps, lore_lock, fee_bps
        self.network_fee, self.dust = network_fee, dust
        self.log = log or (lambda s: None)
        self.crash_after = crash_after  # test hook: reserved, built, broadcast
        self.queue = None  # PoolQueue, opened with the service
        self.queue_wait = 900
        self.dir = tools.wallet_dir(who)
        self.db_path = str(db_path or self.dir / "backend.sqlite")
        self.address = self.lock = self.first = None
        self.planner = None
        self.db = None

    # ----- identity and database -----------------------------------------
    def open(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        ident = self.dir / "identity.json"
        d = None
        try:
            if ident.is_file():
                d = json.loads(ident.read_text())
        except json.JSONDecodeError:
            d = None  # a second process is writing it right now (seen in the two-process test)
        if d is None:
            address = self.tools.address(self.who)
            lock, first = self.tools.key_lock(address)
            d = {"address": address, "lock": lock, "first": first}
            tmp = ident.with_suffix(f".{os.getpid()}.tmp")
            tmp.write_text(json.dumps(d))
            os.replace(tmp, ident)  # atomic: a reader sees the old file or the whole new one
        self.address, self.lock, self.first = d["address"], d["lock"], d["first"]
        genesis = self.tools.genesis()
        self.planner = Planner(self.db_path, genesis, self.lock)
        self.queue = PoolQueue(self.tools, self.log)
        self.db = sqlite3.connect(self.db_path, timeout=30, isolation_level=None)
        self.db.execute("""CREATE TABLE IF NOT EXISTS submissions (
            request TEXT PRIMARY KEY, side TEXT, token TEXT, state TEXT, txid TEXT DEFAULT '', file TEXT DEFAULT '',
            inputs TEXT DEFAULT '[]', detail TEXT DEFAULT '', sent_height INTEGER DEFAULT -1,
            mined_height INTEGER DEFAULT -1, mined_block TEXT DEFAULT '', attempts INTEGER DEFAULT 0,
            created REAL, updated REAL)""")
        return self

    def close(self):
        if self.planner:
            self.planner.close()
        if self.db:
            self.db.close()
        if self.queue:
            self.queue.close()

    def _put(self, sub):
        sub.updated = time.time()
        cols = list(asdict(sub))
        self.db.execute(f"INSERT OR REPLACE INTO submissions ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                        [getattr(sub, c) for c in cols])

    def get(self, request_id):
        row = self.db.execute("SELECT * FROM submissions WHERE request=?", (request_id,)).fetchone()
        if row is None:
            return None
        cols = [d[0] for d in self.db.execute("SELECT * FROM submissions LIMIT 0").description]
        return Submission(**dict(zip(cols, row)))

    def submissions(self, states=None):
        cols = [d[0] for d in self.db.execute("SELECT * FROM submissions LIMIT 0").description]
        rows = self.db.execute("SELECT * FROM submissions ORDER BY created").fetchall()
        subs = [Submission(**dict(zip(cols, r))) for r in rows]
        return [s for s in subs if states is None or s.state in states]

    # ----- the chain as the planner sees it ------------------------------
    def snapshot(self):
        """The wallet's unspent notes typed for the planner, at one block:
        plain and coinbase notes are `plain`; a claim-bearing note is `token`
        with the token and units the indexer decoded, or `unknown`."""
        view = self.tools.view(self.lock)
        tokens = {t.name: t for t in view.tokens}
        unknown = set(view.unknown)
        notes = []
        for f in view.funding:
            if f.kind in ("plain", "coinbase"):
                notes.append(Note(f.name, f.nicks, "plain"))
            elif f.name in tokens:
                t = tokens[f.name]
                notes.append(Note(f.name, f.nicks, "token", t.token, t.units))
            else:
                notes.append(Note(f.name, f.nicks, "unknown"))
        snap = Snapshot(self.tools.genesis(), view.block, int(time.time()), self.lock, tuple(notes))
        return snap, view

    def balances(self):
        """Total NOCK, available NOCK, pending NOCK and NOCK attached to token
        notes, separately; tokens total / available / reserved; open requests."""
        snap, view = self.snapshot()
        reserved = self.planner.reserved()
        b = {"wallet": self.who, "lock": self.lock, "height": view.height, "block": view.block,
             "nock_total": 0, "nock_available": 0, "nock_pending": 0, "nock_attached": 0,
             "nock_attached_pending": 0, "nock_unknown": 0, "tokens": {}, "notes": []}
        for n in snap.notes:
            b["nock_total"] += n.nicks
            r = n.name in reserved
            if n.kind == "plain":
                b["nock_pending" if r else "nock_available"] += n.nicks
            elif n.kind == "token":
                b["nock_attached"] += n.nicks
                if r:
                    b["nock_attached_pending"] += n.nicks
                t = b["tokens"].setdefault(n.token, {"total": 0, "available": 0, "reserved": 0, "notes": 0})
                t["total"] += n.units
                t["reserved" if r else "available"] += n.units
                t["notes"] += 1
            else:
                b["nock_unknown"] += n.nicks
            b["notes"].append({"name": n.name, "nicks": n.nicks, "kind": n.kind, "token": n.token, "units": n.units,
                               "reserved_by": reserved.get(n.name, "")})
        b["pending_requests"] = [{"request": s.request, "state": s.state, "txid": s.txid, "side": s.side}
                                 for s in self.submissions(ACTIVE)]
        return b

    # ----- requests -----------------------------------------------------
    def pay(self, to_address, nicks, request_id):
        req = Request(request_id, "pay", "", 0, nicks, self.network_fee, 0)
        return self._execute(req, to_address, nicks, self._finish_plain)

    def pool_lock_of(self, token):
        return self.tools.pool_lock(token, self.fee_bps, self.lore_bps, self.lore_lock)

    def quote_now(self, token, side, amount):
        """A quote against the pool as it stands (no reservation, no build)."""
        pool = self.tools.pool(token, self.fee_bps, self.lore_bps, self.lore_lock)
        return self.tools.quote_only(pool, token, self.fee_bps, self.lore_bps, self.lore_lock, side, amount,
                                     self.dust, self.network_fee)

    @staticmethod
    def floor_from_slippage(quote_out, slippage_bps):
        """The least output acceptable: the quote's output less the slippage allowance (rounded down)."""
        return max(1, quote_out - (quote_out * slippage_bps) // 10_000)

    def buy(self, token, nicks, request_id, min_tokens_out=1, slippage_bps=None):
        """`min_tokens_out`: the slippage floor the quote at build time must
        meet; with `slippage_bps` the floor is taken from a quote made now."""
        if slippage_bps is not None:
            q = self.quote_now(token, "buy", nicks)
            min_tokens_out = self.floor_from_slippage(q["out_net"], slippage_bps)
            self.log(f"FLOOR\t{request_id}\tquote_now out={q['out_net']} tokens\tslippage={slippage_bps} bps\tmin_out={min_tokens_out}")
        req = Request(request_id, "buy", token, min_tokens_out, nicks, self.network_fee, self.dust)
        return self._execute(req, self.placeholder_address, nicks, self._finish_trade)

    def sell(self, token, units, request_id, min_nicks_out=0, slippage_bps=None):
        if slippage_bps is not None:
            q = self.quote_now(token, "sell", units)
            min_nicks_out = self.floor_from_slippage(q["out_net"], slippage_bps)
            self.log(f"FLOOR\t{request_id}\tquote_now out={q['out_net']} nicks\tslippage={slippage_bps} bps\tmin_out={min_nicks_out}")
        self._min_nicks_out = min_nicks_out
        req = Request(request_id, "sell", token, units, 0, self.network_fee, self.dust)
        return self._execute(req, self.placeholder_address, self.dust, self._finish_trade)

    def transfer(self, token, units, to_address, request_id):
        req = Request(request_id, "transfer", token, units, 0, self.network_fee, self.dust)
        to_lock, _ = self.tools.key_lock(to_address)
        return self._execute(req, to_address, self.dust, lambda *a: self._finish_transfer(*a, to_lock=to_lock))

    def _crash(self, point):
        if self.crash_after == point:
            self.log(f"CRASH\t{point}\t(test hook: exiting without cleanup)")
            os._exit(3)

    def _execute(self, req, to_address, gift, finish):
        # 1. reserve atomically against a fresh snapshot, re-checking the tip
        snap, view = self.snapshot()
        current = self.tools.block(view.height)[1]
        plan = self.planner.reserve(snap, req, current_block=current, now=int(time.time()))
        sub = Submission(req.request_id, req.side, req.token, "planned", inputs=json.dumps(list(plan.inputs)),
                         created=time.time())
        self._put(sub)
        self.log(f"PLAN\t{req.request_id}\t{req.side}\tinputs={list(plan.inputs)}\trequired_plain={plan.required_plain_nicks}"
                 f"\tplain_change={plan.plain_change_nicks}\ttoken_change={plan.token_change_units}"
                 f"\tbacking={plan.token_backing_nicks}\tbacking_spent={plan.backing_spent_nicks}\tfee_per_note={plan.fee_per_note_nicks}")
        self._crash("reserved")
        work = self.dir / "requests" / req.request_id
        work.mkdir(parents=True, exist_ok=True)
        if req.side in ("buy", "sell"):
            # a trade: the pool's turn is held from the pool read through the broadcast
            try:
                turn = self.queue.turn(self.pool_lock_of(req.token), self.queue_wait)
                with turn:
                    sub = self._build(sub, plan, req, to_address, gift, finish, work)
                    self._crash("built")
                    sub = self.broadcast(sub)
                    if sub.state == "sent":
                        turn.record(sub.txid, sub.request, self.who)
                return sub
            except WalletError as e:
                if sub.state == "planned":  # the queue refused before anything was built
                    sub.state, sub.detail = "aborted", f"{e}"[:800]
                    self._put(sub)
                    self.planner.release(req.request_id)
                    self.log(f"ABORTED\t{req.request_id}\t{e}")
                raise
        sub = self._build(sub, plan, req, to_address, gift, finish, work)
        self._crash("built")
        return self.broadcast(sub)

    def _build(self, sub, plan, req, to_address, gift, finish, work):
        try:
            # 2. the wallet builds the base transaction over exactly the planned inputs
            base = self.tools.create_tx(self.who, plan.inputs, to_address, gift, req.network_fee_nicks)
            got = self.tools.inputs_of(base)
            if sorted(got) != sorted(plan.inputs):
                raise WalletError(f"the wallet spent {got}, the plan reserved {list(plan.inputs)}")
            ok, text = self.tools.check_inputs(base, plan.token_inputs)
            (work / "check-inputs.txt").write_text(text)
            if not ok:
                raise WalletError("input gate refused the base transaction (see check-inputs.txt)")
            rows = self.tools.sighash(base, work / "sig")
            for key, digest, pubkey, pkh, sigfile in rows:
                if not self.tools.verify_hash(self.who, digest, sigfile, pubkey):
                    raise WalletError(f"the wallet's signature over spend {key} does not verify")
            # 3. the request-specific rewrite (trade or claims), fee and quote checks, re-signing
            final, info = finish(base, plan, req, work, rows)
            sub.detail = json.dumps(info)
            # 4. durable record of the signed transaction and its id, before any broadcast
            stored = work / "final.jam"
            if Path(final) != stored:
                stored.write_bytes(Path(final).read_bytes())
            sub.txid, sub.file, sub.state = self.tools.tx_id(stored), str(stored), "built"
            self._put(sub)
            self.log(f"BUILT\t{req.request_id}\ttxid={sub.txid}\tfile={stored}")
        except Exception as e:
            sub.state, sub.detail = "aborted", f"{e}"[:800]
            self._put(sub)
            self.planner.release(req.request_id)
            self.log(f"ABORTED\t{req.request_id}\t{e}")
            raise
        return sub

    def broadcast(self, sub):
        """Sends a built transaction and records the node's answer."""
        tip = self.tools.tx_status(sub.txid).tip
        result = self.tools.send(sub.file)
        self._crash("broadcast")
        (self.dir / "requests" / sub.request / f"send-{sub.attempts}.txt").write_text(result.detail)
        sub.attempts += 1
        if result.txid != sub.txid:
            sub.state, sub.detail = "aborted", f"send returned id {result.txid!r} for {sub.txid}"
            self._put(sub)
            self.planner.release(sub.request)
            raise WalletError(sub.detail)
        if result.admitted:
            sub.state, sub.sent_height = "sent", tip
            self._put(sub)
            self.log(f"SENT\t{sub.request}\ttxid={sub.txid}\tat_height={tip}\treserved={sub.input_names()}")
        else:
            sub.state, sub.detail = "refused", result.detail[-800:]
            self._put(sub)
            self.planner.release(sub.request)
            self.log(f"REFUSED\t{sub.request}\ttxid={sub.txid}\t{result.detail.splitlines()[-1] if result.detail else ''}")
        return sub

    # ----- the three finishing steps -----------------------------------
    def _resign(self, work, rows, cur, text):
        new = self.tools.new_sighashes(text)
        i = 0
        for key, digest, pubkey, pkh, sigfile in rows:
            d = new.get(key)
            if d is None:
                self.log(f"  resign: spend {key[:12]}… untouched, its signature stands")
                continue
            i += 1
            sig = self.tools.sign_hash(self.who, d, work / f"resign-{i}.sig")
            out = work / f"resign-{i}.jam"
            self.tools.set_sig(cur, key, pkh, pubkey, sig, out)
            cur = out
        if i == 0:
            raise WalletError("nothing to re-sign")
        return cur

    def _fee_ok(self, text, label):
        current, required = self.tools.fee_line(text)
        if current < required:
            raise WalletError(f"{label}: fee {current} below the chain's requirement {required}")
        return current, required

    def _finish_plain(self, base, plan, req, work, rows):
        # a plain payment: the wallet's own signatures stand; the fee it set
        # is checked against the chain's requirement for this shape
        current, required = self.tools.fee(base)
        if current < required:
            raise WalletError(f"pay: fee {current} below the chain's requirement {required}")
        return base, {"kind": "pay", "nicks": req.buy_debit_nicks, "fee": current, "fee_required": required}

    def _finish_trade(self, base, plan, req, work, rows):
        # the pool is read inside the pool's turn (PoolQueue): the previous
        # trade on it is settled or gone, so this is the pool as it stands
        pool = self.tools.pool(req.token, self.fee_bps, self.lore_bps, self.lore_lock)
        claim = None
        tokens_in = held = 0
        if req.side == "sell":
            tokens_in = req.token_units
            claim = f"{self.lock}=transfer:{req.token}:{plan.token_change_units}"
        else:
            # token notes of this token spent as funding: their units join
            # the bought claim (one claim at the buyer's lock)
            held = plan.token_change_units
        text = self.tools.pool_trade(base, work / "assembled.jam", pool, req.token, self.fee_bps, self.lore_bps,
                                     self.lore_lock, req.side, self.placeholder_lock, self.dust, tokens_in, claim, held)
        (work / "trade.txt").write_text(text)
        quote = self.tools.quote(text)
        current, required = self._fee_ok(text, req.side)
        if req.side == "buy" and quote["out_net"] < req.token_units:
            raise WalletError(f"quote delivers {quote['out_net']} tokens, below the request's floor {req.token_units}")
        if req.side == "sell":
            if quote["in"] != tokens_in:
                raise WalletError("quote does not sell the requested units")
            floor = getattr(self, "_min_nicks_out", 0)
            if quote["out_net"] < floor:
                raise WalletError(f"quote pays {quote['out_net']} nicks, below the request's floor {floor}")
        final = self._resign(work, rows, work / "assembled.jam", text)
        info = {"kind": req.side, "quote": quote, "fee": current, "fee_required": required, "pool_before": pool,
                "change_claim": claim, "held": held, "floor": req.token_units if req.side == "buy" else getattr(self, "_min_nicks_out", 0)}
        return final, info

    def _finish_transfer(self, base, plan, req, work, rows, *, to_lock):
        claims = [f"{to_lock}=transfer:{req.token}:{req.token_units}",
                  f"{self.lock}=transfer:{req.token}:{plan.token_change_units}"]
        text = self.tools.attach(base, work / "attached.jam", claims)
        (work / "attach.txt").write_text(text)
        current, required = self._fee_ok(text, "transfer")
        final = self._resign(work, rows, work / "attached.jam", text)
        return final, {"kind": "transfer", "units": req.token_units, "to_lock": to_lock, "claims": claims,
                       "fee": current, "fee_required": required}

    # ----- settlement -----------------------------------------------------
    def settle(self, sub):
        """One submission against the node, by its transaction id."""
        if sub.state == "planned":
            # a reservation without a built transaction: nothing was ever
            # broadcast (the record is written before the send), so the
            # request is aborted and its inputs released
            sub.state, sub.detail = "aborted", "restart before the transaction was built"
            self._put(sub)
            self.planner.release(sub.request)
            self.log(f"ABORTED\t{sub.request}\t{sub.detail}")
            return sub
        if sub.state not in ("built", "sent"):
            return sub
        st = self.tools.tx_status(sub.txid)
        if st.state == "mined":
            if st.canonical == "yes":
                sub.state, sub.mined_height, sub.mined_block = "mined", st.height, st.block
                self._put(sub)
                self.planner.release(sub.request)
                self.log(f"MINED\t{sub.request}\ttxid={sub.txid}\theight={st.height}\tblock={st.block}\tcanonical=yes\treleased={sub.input_names()}")
            else:
                sub.detail = f"in block {st.block} at {st.height}, canonical={st.canonical} ({st.canonical_block})"
                self._put(sub)
                self.log(f"NOT-CANONICAL\t{sub.request}\ttxid={sub.txid}\t{sub.detail}")
            return sub
        if st.state == "pending":
            if sub.state == "built":
                # broadcast happened, the record of it did not (a crash in between)
                sub.state, sub.sent_height = "sent", st.tip
                self._put(sub)
                self.log(f"SENT\t{sub.request}\ttxid={sub.txid}\t(found in the mempool after a restart)")
            return sub
        # unknown to the node: a built transaction that was never sent, or one
        # the node no longer holds (its mempool is not durable) — send the
        # stored file; the id is its content hash, so this is the same transaction
        self.log(f"RESEND\t{sub.request}\ttxid={sub.txid}\tnode: {st.detail or 'unknown'}\tstate_was={sub.state}")
        return self.broadcast(sub)

    def reconcile(self):
        return [self.settle(s) for s in self.submissions(ACTIVE)]

    def wait(self, request_id, timeout=900, poll=10):
        deadline = time.time() + timeout
        while True:
            sub = self.settle(self.get(request_id))
            if sub.state not in ACTIVE:
                return sub
            if time.time() > deadline:
                raise WalletError(f"{request_id}: {sub.state} after {timeout}s ({sub.txid})")
            time.sleep(poll)
