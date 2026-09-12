"""The trusted node / indexer / wallet adapter behind the planner and service.

Everything the backend knows about the chain comes through the package's own
tools over the node's gRPC (`nmeme-index`, `nmeme-tx`) and the stock wallet
binary (`nockchain-wallet`), each a subprocess with a line-oriented output
(docs/WALLET.md §3). This module turns those lines into values; it decides
nothing about spending. Wallet calls are serialised per wallet with a file
lock — the wallet's arena is a memory-mapped file that two concurrent
processes corrupt (seen live) — and an arena past `arena_limit_mb` is thrown
away and rebuilt from the wallet's exported keys before the call (it grows by
hundreds of megabytes per call; docs/WALLET.md §4).
"""
from dataclasses import dataclass, field
import fcntl
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

ANSI = re.compile(r"\x1b\[[0-9;]*m")


class ChainError(RuntimeError):
    pass


@dataclass(frozen=True)
class FundingRow:
    first: str
    last: str
    kind: str  # plain, coinbase, claim (as the indexer proves them)
    nicks: int
    origin: int

    @property
    def name(self):
        return f"{self.first} {self.last}"


@dataclass(frozen=True)
class TokenRow:
    first: str
    last: str
    nicks: int
    units: int
    token: str
    genesis: bool = False

    @property
    def name(self):
        return f"{self.first} {self.last}"


@dataclass(frozen=True)
class ChainView:
    """One consistent read of a lock: the block it was read at, every unspent
    note there typed by the indexer, and the token claims the indexer decoded."""
    height: int
    block: str
    funding: tuple[FundingRow, ...]
    tokens: tuple[TokenRow, ...]
    unknown: tuple[str, ...]  # names of claim-bearing notes whose claim does not decode


@dataclass(frozen=True)
class TxStatus:
    txid: str
    state: str  # mined, pending, unknown
    height: int = 0
    block: str = ""
    canonical: str = ""  # yes, no, unverified ("" unless mined)
    canonical_block: str = ""
    tip: int = -1
    detail: str = ""


@dataclass(frozen=True)
class SendResult:
    txid: str
    admitted: bool
    detail: str


@dataclass
class Tools:
    repo: Path
    run: Path
    port: int = 25655
    public_addr: str = "127.0.0.1:5556"
    arena_limit_mb: int = 500
    wallet_timeout: int = 900
    log: object = None  # callable(str) for progress lines

    def __post_init__(self):
        self.repo, self.run = Path(self.repo), Path(self.run)
        self.wallet_bin = self.repo / "target/release/nockchain-wallet"
        self.nmeme_tx = self.repo / "target/release/nmeme-tx"
        self.nmeme_index = self.repo / "target/release/nmeme-index"
        self.wallets = self.run / "wallets"
        self.keys = self.run / "keys"
        self._genesis = None

    # ----- subprocesses -------------------------------------------------
    def _run(self, args, *, cwd=None, env=None, timeout=600, ok=True):
        cp = subprocess.run([str(a) for a in args], cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        cp.stdout, cp.stderr = ANSI.sub("", cp.stdout), ANSI.sub("", cp.stderr)
        if ok and cp.returncode != 0:
            raise ChainError(f"{Path(str(args[0])).name} {' '.join(str(a) for a in args[1:3])}: rc={cp.returncode}: "
                             f"{(cp.stderr or cp.stdout).strip()[-800:]}")
        return cp

    def index(self, *args, ok=True):
        return self._run([self.nmeme_index, *args], ok=ok)

    def tx(self, *args, ok=True):
        return self._run([self.nmeme_tx, *args], ok=ok)

    @staticmethod
    def rows(text, tag):
        return [line.split("\t")[1:] for line in text.splitlines() if line.startswith(tag + "\t")]

    # ----- node reads ---------------------------------------------------
    def genesis(self):
        """The chain the database is bound to: block 0's id."""
        if self._genesis is None:
            self._genesis = self.block(0)[1]
        return self._genesis

    def block(self, height):
        out = self.index("block", "--addr", self.public_addr, "--height", str(height)).stdout
        row = self.rows(out, "BLOCK")
        if not row:
            raise ChainError(f"block {height}: no BLOCK line")
        h, block_id, parent = row[0]
        return int(h), block_id, parent.removeprefix("parent=")

    def funding(self, lock):
        out = self.index("funding", "--addr", self.public_addr, "--lock", lock).stdout
        height = int(self.rows(out, "HEIGHT")[0][0])
        block = self.rows(out, "BLOCK")[0][0]
        notes = tuple(FundingRow(f, l, k, int(n), int(o)) for f, l, k, n, o in self.rows(out, "FUNDING"))
        return height, block, notes

    def token_notes(self, lock):
        """Every token-bearing note at the lock, and the height/block of the read."""
        out = self.index("token-note", "--addr", self.public_addr, "--lock", lock, "--all").stdout
        m = re.search(r"# snapshot height (\d+) block (\S+)", out)
        if not m:
            raise ChainError("token-note: no snapshot line")
        found, unknown = [], []
        for name, nicks, units, token in self.rows(out, "NOTE"):
            first, last = name.strip("[]").split()
            genesis = token.endswith(" (genesis)")
            found.append(TokenRow(first, last, int(nicks), int(units), token.split()[0], genesis))
        for row in self.rows(out, "NOTE-UNKNOWN"):
            unknown.append(row[0].strip("[]"))
        return int(m.group(1)), m.group(2), tuple(found), tuple(unknown)

    def view(self, lock, attempts=12):
        """A funding read and a token read of one lock at the SAME block: the
        two are separate RPCs on a chain that mines every few seconds, so a
        pair that disagrees is read again rather than mixed."""
        last = None
        for _ in range(attempts):
            h1, b1, funding = self.funding(lock)
            h2, b2, tokens, unknown = self.token_notes(lock)
            if b1 == b2:
                return ChainView(h1, b1, funding, tokens, unknown)
            last = (h1, b1, h2, b2)
            time.sleep(3)
        raise ChainError(f"could not read {lock} at one block: {last}")

    def tx_status(self, txid):
        out = self.index("tx-status", "--addr", self.public_addr, "--txid", txid).stdout
        row = self.rows(out, "TX-STATUS")
        if not row:
            raise ChainError(f"tx-status {txid}: no TX-STATUS line")
        tip_rows = self.rows(out, "TIP")
        tip = int(tip_rows[0][0]) if tip_rows else -1
        r = row[0]
        if r[1] == "mined":
            kv = dict(x.split("=", 1) for x in r[2:])
            return TxStatus(txid, "mined", int(kv["height"]), kv["block"], kv.get("canonical", ""),
                            kv.get("canonical_block", ""), tip)
        return TxStatus(txid, r[1], tip=tip, detail=" ".join(r[2:]))

    def pool(self, token, fee_bps, lore_bps, lore_lock):
        """The main pool's note as one `POOL` line: `<first> <last> <origin> <nock> <tokens>`."""
        out = self.index("pool", "--addr", self.public_addr, "--token", token, "--fee-bps", str(fee_bps),
                         "--lore-bps", str(lore_bps), "--lore-lock", lore_lock).stdout
        row = self.rows(out, "POOL")
        if not row:
            raise ChainError(f"no pool for {token} at {fee_bps} bps")
        return " ".join(row[0])

    # ----- transaction files --------------------------------------------
    def tx_id(self, path):
        return self.index("tx-id", "--tx", path).stdout.strip()

    def inputs_of(self, path):
        """The names a transaction file spends, as `<first> <last>`."""
        out = self.index("outputs", "--tx", path).stdout
        return [f"{f} {l}" for f, l in self.rows(out, "INPUT")]

    def check_inputs(self, path, token_notes=()):
        args = ["check-inputs", "--addr", self.public_addr, "--tx", path]
        for n in token_notes:
            args += ["--token-note", n]
        cp = self.index(*args, ok=False)
        return cp.returncode == 0, cp.stdout + cp.stderr

    def send(self, path):
        cp = self.index("send", "--addr", self.public_addr, "--tx", path, ok=False)
        out = cp.stdout + cp.stderr
        txid = (self.rows(out, "TXID") or [[""]])[0][0]
        verdicts = self.rows(out, "MEMPOOL")
        admitted = bool(verdicts) and verdicts[0][0] == "admitted"
        return SendResult(txid, admitted, out.strip())

    def key_lock(self, address):
        out = self.tx("key-lock", address).stdout
        return self.rows(out, "KEY-LOCK")[0][0], self.rows(out, "KEY-FIRST")[0][0]

    def sighash(self, path, out_dir):
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        out = self.tx("sighash", path, out_dir).stdout
        return [tuple(r) for r in self.rows(out, "SIGHASH")]  # (key, digest, pubkey, pkh, sigfile)

    def pool_lock(self, token, fee_bps, lore_bps, lore_lock):
        out = self.tx("pool-lock", "--token", token, "--fee-bps", str(fee_bps), "--lore-bps", str(lore_bps),
                      "--lore-lock", lore_lock).stdout
        return self.rows(out, "POOL-LOCK")[0][0]

    def quote_only(self, pool_line, token, fee_bps, lore_bps, lore_lock, side, amount, dust, network_fee):
        """`nmeme-tx quote`: the quote alone against a POOL line (no transaction)."""
        args = ["quote", "--pool", pool_line, "--token", token, "--fee-bps", str(fee_bps), "--lore-bps", str(lore_bps),
                "--lore-lock", lore_lock, "--side", side, "--dust", str(dust), "--network-fee", str(network_fee),
                "--nicks-in" if side == "buy" else "--tokens-in", str(amount)]
        cp = self.tx(*args, ok=False)
        if cp.returncode != 0:
            raise ChainError(f"quote: {(cp.stderr or cp.stdout).strip()[-600:]}")
        return self.quote(cp.stdout)

    def pool_trade(self, path, out, pool_line, token, fee_bps, lore_bps, lore_lock, side, placeholder_lock, dust,
                   tokens_in=0, claim=None, held=0):
        args = ["pool-trade", path, out, "--pool", pool_line, "--token", token, "--fee-bps", str(fee_bps),
                "--lore-bps", str(lore_bps), "--lore-lock", lore_lock, "--side", side, "--placeholder",
                placeholder_lock, "--dust", str(dust)]
        if tokens_in:
            args += ["--tokens-in", str(tokens_in)]
        if claim:
            args += ["--claim", claim]
        if held:
            args += ["--held", str(held)]
        cp = self.tx(*args, ok=False)
        if cp.returncode != 0:
            raise ChainError(f"pool-trade: {(cp.stderr or cp.stdout).strip()[-600:]}")
        return cp.stdout

    def attach(self, path, out, claims):
        cp = self.tx("attach", path, out, *claims, ok=False)
        if cp.returncode != 0:
            raise ChainError(f"attach: {(cp.stderr or cp.stdout).strip()[-600:]}")
        return cp.stdout

    def set_sig(self, cur, key, pkh, pubkey, sigfile, out):
        self.tx("set-sig", cur, key, pkh, pubkey, sigfile, out)

    def fee(self, path):
        """The chain's fee requirement for a transaction file against what it carries."""
        cp = self.tx("fee", path, ok=False)
        return self.fee_line(cp.stdout)

    @staticmethod
    def fee_line(text):
        m = re.search(r"^FEE\tcurrent=(\d+)\trequired=(\d+)", text, re.M)
        if not m:
            raise ChainError("no FEE line")
        return int(m.group(1)), int(m.group(2))

    @staticmethod
    def quote(text):
        """The QUOTE line of a pool trade as a dict of its fields."""
        m = re.search(r"^QUOTE\t(.*)$", text, re.M)
        if not m:
            raise ChainError("no QUOTE line")
        fields = {}
        for part in m.group(1).split("\t"):
            if "=" in part:
                k, v = part.split("=", 1)
                fields[k] = int(v.split()[0])
        after = re.search(r"^POOL-AFTER\t(\d+)\t(\d+)", text, re.M)
        if after:
            fields["pool_after"] = (int(after.group(1)), int(after.group(2)))
        return fields

    @staticmethod
    def new_sighashes(text):
        return {key: digest for key, digest in Tools.rows(text, "NEWSIGHASH")}

    # ----- the wallet binary --------------------------------------------
    def wallet_dir(self, who):
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,48}", who):
            raise ChainError("invalid wallet name")
        return self.wallets / who

    def _lock(self, who):
        d = self.wallet_dir(who)
        d.mkdir(parents=True, exist_ok=True)
        return open(d / ".lock", "w")

    def _wallet_env(self, who):
        return dict(os.environ, NOCKAPP_HOME=str(self.wallet_dir(who)), RUST_LOG="error")

    def _wallet_args(self, *args):
        return [self.wallet_bin, "--pma-initial-size", "256MiB", "--client", "private",
                "--private-grpc-server-port", str(self.port), "--fakenet", *args]

    def _wallet_raw(self, who, *args, ok=True, timeout=None):
        d = self.wallet_dir(who)
        return self._run(self._wallet_args(*args), cwd=d, env=self._wallet_env(who),
                         timeout=timeout or self.wallet_timeout, ok=ok)

    def wallet_fresh_locked(self, who):
        """Rebuilds the wallet's arena from its exported keys (caller holds the lock)."""
        keys = self.keys / f"{who}.export"
        if not keys.is_file():
            keys = self.wallet_dir(who) / "keys.export"
        if not keys.is_file():
            raise ChainError(f"no exported keys for {who}")
        shutil.rmtree(self.wallet_dir(who) / "wallet", ignore_errors=True)
        self._wallet_raw(who, "import-keys", "--file", str(keys))
        # a fresh wallet knows no notes until it has listed them once
        self._wallet_raw(who, "list-notes", ok=False)

    def wallet(self, who, *args, ok=True, timeout=None):
        """One wallet call, serialised per wallet, its arena rebuilt first when too large."""
        with self._lock(who) as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            arena = self.wallet_dir(who) / "wallet"
            if arena.is_dir():
                # allocated blocks, not apparent size: the arena is a sparse mapping
                mb = sum(f.stat().st_blocks * 512 for f in arena.rglob("*") if f.is_file()) // (1024 * 1024)
                if mb > self.arena_limit_mb:
                    if self.log:
                        self.log(f"rebuilding {who}'s wallet arena ({mb} MB)")
                    self.wallet_fresh_locked(who)
            elif (self.keys / f"{who}.export").is_file() or (self.wallet_dir(who) / "keys.export").is_file():
                # an arena thrown away (disk) is rebuilt from the exported keys:
                # the keys are the wallet, the arena is disposable
                if self.log:
                    self.log(f"rebuilding {who}'s wallet arena from its keys")
                self.wallet_fresh_locked(who)
            return self._wallet_raw(who, *args, ok=ok, timeout=timeout)

    def keygen(self, who):
        """A new wallet: keys generated by the stock wallet and exported to
        run/keys/<who>.export (the arena is disposable; the keys are the wallet).
        Refuses an existing wallet directory."""
        d = self.wallet_dir(who)
        if d.exists():
            raise ChainError(f"wallet {who} exists")
        d.mkdir(parents=True, mode=0o700)
        with self._lock(who) as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self._wallet_raw(who, "keygen")
            self._wallet_raw(who, "export-keys")
            exported = d / "keys.export"
            if not exported.is_file():
                raise ChainError(f"{who}: keygen left no keys.export")
            self.keys.mkdir(parents=True, exist_ok=True)
            shutil.copy(exported, self.keys / f"{who}.export")
            self._wallet_raw(who, "list-notes", ok=False)
        return d

    def address(self, who):
        """The wallet's master address (a wallet rebuilt from keys lists no active
        child addresses; the master address is what the suites pay)."""
        out = self.wallet(who, "list-master-addresses").stdout
        m = re.search(r"^- Address: ([A-Za-z0-9]+)", out, re.M)
        if not m:
            raise ChainError(f"{who}: no master address in wallet output")
        return m.group(1)

    def list_notes(self, who):
        self.wallet(who, "list-notes", ok=False)

    def tx_files(self, who):
        d = self.wallet_dir(who)
        return set(p for base in (d / "txs", d / "wallet" / "txs") if base.is_dir() for p in base.glob("*.tx"))

    def create_tx(self, who, names, to_address, amount, fee, allow_low_fee=True):
        """`create-tx --names [..]` spends exactly the named notes (seen live),
        pays `amount` to the address, `fee` spread over the notes, and returns
        each note's change to the wallet's own lock. Returns the file written."""
        before = self.tx_files(who)
        args = ["create-tx", "--names", ",".join(f"[{n}]" for n in names), "--recipient",
                f'{{"kind":"p2pkh","address":"{to_address}","amount":{amount}}}', "--fee-nicks", str(fee)]
        if allow_low_fee:
            args.append("--allow-low-fee")
        cp = self.wallet(who, *args, ok=False)
        if cp.returncode != 0:
            raise ChainError(f"create-tx ({who}): {(cp.stderr or cp.stdout).strip()[-600:]}")
        m = re.search(r"txs/[0-9A-Za-z]+\.tx", cp.stdout + cp.stderr)
        if m and (self.wallet_dir(who) / m.group(0)).is_file():
            return self.wallet_dir(who) / m.group(0)
        new = self.tx_files(who) - before
        if len(new) != 1:
            raise ChainError(f"create-tx ({who}): expected one new transaction file, found {len(new)}")
        return new.pop()

    def sign_hash(self, who, digest, dest):
        src = self.wallet_dir(who) / "hash.sig"
        src.unlink(missing_ok=True)
        self.wallet(who, "sign-hash", digest)
        if not src.is_file() or src.stat().st_size == 0:
            raise ChainError(f"sign-hash ({who}) wrote nothing")
        shutil.move(src, dest)
        return dest

    def verify_hash(self, who, digest, sigfile, pubkey):
        cp = self.wallet(who, "verify-hash", digest, sigfile, pubkey, ok=False)
        out = cp.stdout + cp.stderr
        return cp.returncode == 0 and "Invalid signature" not in out and "Valid signature, hash verified" in out
