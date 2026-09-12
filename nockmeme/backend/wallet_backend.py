"""Fakenet wallet planning: selection and atomic, persistent reservation.

The supplied backend (nockmeme-wallet-backend, first implementation) with its
selection rule adapted to what the fakenet showed about NOCK attached to
token notes (docs/WALLET.md §1 and §4):

  * consensus merges a spend's change seed with a token seed to the same
    lock into ONE note, so after a buy the buyer's NOCK change sits inside
    the token note it bought, and after a sell the seller's does too;
  * the stock wallet spreads a transaction's fee evenly over the notes it is
    told to spend (ceil(fee / n) each, capped to leave one nick per note),
    then draws the payment from what remains in order, and returns each
    note's leftover as its own change seed (tx-builder.hoon,
    ++create-spends-1 / ++process-spends-1 / ++allocate-orders).

So: a token note of the REQUESTED token that a sell or a transfer spends
anyway — with its change claim attached — pays the network fee and the
dust payment from the NOCK it carries; a plain note is added only when that
backing cannot cover them. Spending a plain note next to a token note would
only move the plain note's change INTO the token note (the merge above),
which strands it. Token notes of any other token, notes whose claim does not
decode, and reserved notes never fund anything; a buy is funded from plain
notes only (its NOCK output would collide with the bought tokens' claim at
the same lock). Tokens and their change are never touched by fee payment:
the plan states the change claim (`token_change_units`) the transaction
must carry, and the backing NOCK not spent on fee and payment returns as the
token note's change (`token_backing_nicks - backing_spent_nicks`).

A buy, too, may be funded from token notes of the token being bought (pack
8: after a buy all of a wallet's NOCK sits inside its token note, and a
wallet that could not buy again with it would be stuck): their units are
re-claimed on the bought output — one merged claim at the buyer's lock,
`held + bought` — so nothing is burned and the notes consolidate into one.
Plain notes are still taken first; a token note of the same token is added
only when they do not cover fee and payment. Notes of another token never
fund a buy: their claim would be a second claim at the buyer's lock, and
consensus keeps one.

Trusted local adapter API, never a public request API.
"""
from dataclasses import dataclass
import os
from pathlib import Path
import re
import sqlite3
import subprocess

MAX = (1 << 64) - 1
SIDES = ("buy", "sell", "transfer", "pay")  # pay: a plain NOCK payment, no token


class WalletError(ValueError):
    pass


def amount(value):
    if type(value) is not int or not 0 <= value <= MAX:
        raise WalletError("amount must be an unsigned 64-bit integer in raw units")
    return value


def total(values):
    return amount(sum(amount(x) for x in values))


@dataclass(frozen=True)
class Note:
    # Full consensus note name ("<first> <last>"), not just first-name or a display address.
    name: str
    nicks: int
    kind: str  # plain, token, unknown; supplied by trusted verified replay
    token: str = ""
    units: int = 0
    spendable: bool = True


@dataclass(frozen=True)
class Snapshot:
    genesis: str
    block: str
    observed_at: int
    owner: str
    notes: tuple[Note, ...]


@dataclass(frozen=True)
class Request:
    request_id: str
    side: str  # buy, sell, transfer, pay
    token: str  # empty for a plain payment
    # Sell/transfer: the units to sell or send. Buy: the MINIMUM units the
    # quote must deliver (the builder refuses a quote below it); at least 1.
    token_units: int
    # Buy: entire quoted NOCK debit INCLUDING pool/Lore fees, excluding network.
    # Sell/transfer: zero; sale fees are in the quote, NOT additional upfront funding.
    buy_debit_nicks: int
    network_fee_nicks: int
    extra_nicks: int = 0  # explicit additional output funding (the dust seed), never hidden


@dataclass(frozen=True)
class Plan:
    request_id: str
    block: str
    plain_inputs: tuple[str, ...]
    token_inputs: tuple[str, ...]
    required_plain_nicks: int  # NOCK the plain inputs must supply (fee + payment not paid by backing)
    plain_change_nicks: int  # change of the plain inputs
    token_change_units: int  # sell/transfer: the change claim; buy: units held on the token inputs, re-claimed with the bought units
    token_backing_nicks: int  # NOCK carried by the token inputs: conserved minus backing_spent_nicks
    backing_spent_nicks: int = 0  # of the backing, what pays fee and payment
    fee_per_note_nicks: int = 0  # the wallet's even share, ceil(fee / inputs)

    @property
    def inputs(self):
        """The names in the order the wallet must spend them (token notes first)."""
        return self.token_inputs + self.plain_inputs

    @property
    def token_change_nicks(self):
        return self.token_backing_nicks - self.backing_spent_nicks


def wallet_split(assets, fee, gift):
    """The stock wallet's allocation over notes spent in this order.

    Returns per note (fee_portion, gift_portion, change), or None when the
    fee or the gift cannot be paid ("Insufficient funds to pay fee and gift").
    A port of ++create-spends-1: fee_per_note = ceil(fee / n); per note the
    fee portion is min(remaining fee, fee_per_note, assets - 1), the gift is
    drawn from what remains, the leftover is that note's change.
    """
    n = len(assets)
    if n == 0:
        return None if fee or gift else []
    per = fee // n + (1 if fee % n else 0)
    rows = []
    rem_fee, rem_gift = fee, gift
    for a in assets:
        if a == 0:
            return None
        f = min(rem_fee, per, a - 1)
        rem_fee -= f
        g = min(rem_gift, a - f)
        rem_gift -= g
        rows.append((f, g, a - f - g))
    if rem_fee or rem_gift:
        return None
    return rows


class Planner:
    """Local persistent reservations; every caller for this wallet MUST share DB.

    Snapshot classifications are not evidence by themselves. The integration
    must obtain them from node data + complete verified token replay. Never
    expose this constructor/reserve directly to browser-provided JSON.
    """
    def __init__(self, db, genesis, owner):
        if not genesis or not owner:
            raise WalletError("explicit fakenet genesis and owner required")
        self.genesis, self.owner = genesis, owner
        self.db = sqlite3.connect(db, timeout=30, isolation_level=None)
        self.db.execute("CREATE TABLE IF NOT EXISTS binding (genesis TEXT, owner TEXT)")
        self.db.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY)")
        self.db.execute("CREATE TABLE IF NOT EXISTS reservations (name TEXT PRIMARY KEY, request TEXT NOT NULL)")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            row = self.db.execute("SELECT genesis, owner FROM binding").fetchone()
            if row is None:
                self.db.execute("INSERT INTO binding VALUES (?, ?)", (genesis, owner))
            elif row != (genesis, owner):
                raise WalletError("database belongs to another chain or wallet")
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            self.db.close()
            raise

    def close(self):
        self.db.close()

    def reserved(self):
        """{note name: request id} for every reservation held."""
        return dict(self.db.execute("SELECT name, request FROM reservations"))

    def release(self, request_id):
        """Releases a request's reservations (the caller established settlement
        or refusal by the transaction's own id; see service.py). The request id
        stays recorded so it can never be planned twice."""
        self.db.execute("BEGIN IMMEDIATE")
        try:
            n = self.db.execute("DELETE FROM reservations WHERE request=?", (request_id,)).rowcount
            self.db.execute("COMMIT")
            return n
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    @staticmethod
    def check_snapshot(snapshot):
        names = set()
        for note in snapshot.notes:
            if not note.name or note.name in names:
                raise WalletError("missing or duplicate full note name")
            names.add(note.name)
            amount(note.nicks)
            amount(note.units)
            if type(note.spendable) is not bool or note.kind not in ("plain", "token", "unknown"):
                raise WalletError("invalid note classification")
            if note.kind == "plain" and (note.token or note.units):
                raise WalletError("inconsistent plain note")
            if note.kind == "token" and (not note.token or not note.units):
                raise WalletError("inconsistent token note")

    def reserve(self, snapshot, request, *, current_block, now, max_age=30):
        if (snapshot.genesis, snapshot.owner) != (self.genesis, self.owner):
            raise WalletError("wrong chain or wallet")
        for n in (snapshot.observed_at, now, max_age):
            amount(n)
        if not current_block or snapshot.block != current_block or not 0 <= now - snapshot.observed_at <= max_age:
            raise WalletError("refresh node snapshot and token replay before planning")
        if not request.request_id or request.side not in SIDES:
            raise WalletError("invalid request")
        for n in (request.token_units, request.buy_debit_nicks, request.network_fee_nicks, request.extra_nicks):
            amount(n)
        if request.side == "pay":
            if request.token or request.token_units:
                raise WalletError("a plain payment names no token")
        elif not request.token or not request.token_units:
            raise WalletError("positive token amount and estimated network fee required")
        if not request.network_fee_nicks:
            raise WalletError("positive token amount and estimated network fee required")
        if (request.side in ("buy", "pay")) != (request.buy_debit_nicks > 0):
            raise WalletError("only buys and payments have an upfront NOCK debit")
        self.check_snapshot(snapshot)
        fee = request.network_fee_nicks
        gift = total((request.buy_debit_nicks, request.extra_nicks))
        self.db.execute("BEGIN IMMEDIATE")
        try:
            if self.db.execute("SELECT 1 FROM requests WHERE id=?", (request.request_id,)).fetchone():
                raise WalletError("request already planned; do not broadcast a duplicate")
            locked = {row[0] for row in self.db.execute("SELECT name FROM reservations")}
            available = sorted((n for n in snapshot.notes if n.spendable and n.name not in locked), key=lambda n: n.name)
            tokens, units, backing = [], 0, 0
            same_token = sorted((n for n in available if n.kind == "token" and n.token == request.token),
                                key=lambda n: (-n.units, n.name))
            if request.side not in ("buy", "pay"):
                # the token notes a sell or transfer spends anyway: enough of
                # the requested token, largest holdings first (fewest inputs)
                for note in same_token:
                    if units >= request.token_units:
                        break
                    tokens.append(note)
                    units = total((units, note.units))
                    backing = total((backing, note.nicks))
                if units < request.token_units:
                    raise WalletError("insufficient verified, unreserved tokens")
            # plain notes only until the wallet's own allocation pays fee and
            # payment in full; a token note's backing is tried first
            # plain notes largest first: the fewest inputs (the chain's fee
            # requirement grows with every input, and a lock full of trade
            # dust cannot pay a fee at all, seen live), ties by name
            plain = []
            split = wallet_split([n.nicks for n in tokens], fee, gift)
            for note in sorted((n for n in available if n.kind == "plain"), key=lambda n: (-n.nicks, n.name)):
                if split is not None:
                    break
                plain.append(note)
                split = wallet_split([n.nicks for n in tokens + plain], fee, gift)
            if split is None and request.side == "buy":
                # a buy may draw on token notes of the token it buys (their
                # units join the bought claim), the most NOCK first
                for note in sorted(same_token, key=lambda n: (-n.nicks, n.name)):
                    if split is not None:
                        break
                    tokens.append(note)
                    units = total((units, note.units))
                    backing = total((backing, note.nicks))
                    split = wallet_split([n.nicks for n in tokens + plain], fee, gift)
            if split is None:
                have = total(n.nicks for n in plain)
                raise WalletError(f"insufficient ordinary NOCK: need {fee + gift} nicks for fee and payment, "
                                  f"plain notes hold {have}, token backing {backing}")
            # the wallet spends the notes in the order named: token notes first
            ordered = tokens + plain
            split = wallet_split([n.nicks for n in ordered], fee, gift)
            k = len(tokens)
            backing_spent = sum(f + g for f, g, _ in split[:k])
            plain_change = sum(c for _, _, c in split[k:])
            required_plain = fee + gift - backing_spent
            n_in = len(ordered)
            per = fee // n_in + (1 if fee % n_in else 0)
            self.db.execute("INSERT INTO requests VALUES (?)", (request.request_id,))
            self.db.executemany("INSERT INTO reservations VALUES (?, ?)",
                                ((n.name, request.request_id) for n in ordered))
            change_units = units if request.side == "buy" else (units - request.token_units if tokens else 0)
            plan = Plan(request.request_id, snapshot.block, tuple(n.name for n in plain), tuple(n.name for n in tokens),
                        required_plain, plain_change, change_units, backing, backing_spent, per)
            self.db.execute("COMMIT")
            return plan
        except Exception:
            self.db.execute("ROLLBACK")
            raise


def create_test_wallet(binary, root, name, port):
    """Invoke pack-4's native CLI keygen; never generate fake keys or addresses.

    Test keys only. No export, signing, transaction submission, or funding.
    Failed/partial directories remain for inspection; never overwrite/retry them.
    """
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,48}", name):
        raise WalletError("invalid wallet name")
    if type(port) is not int or not 1 <= port <= 65535:
        raise WalletError("invalid local private gRPC port")
    executable = Path(binary).resolve(strict=True)
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise WalletError("compiled Nockchain wallet required")
    directory = Path(root).resolve() / name
    directory.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.mkdir(mode=0o700)  # refuses existing wallets, including symlinks
    env = dict(os.environ, NOCKAPP_HOME=str(directory), RUST_LOG="error")
    args = [str(executable), "--pma-initial-size", "256MiB", "--client", "private",
            "--private-grpc-server-port", str(port), "--fakenet"]
    # Suppress CLI output because some versions print recovery material.
    with open(os.devnull, "wb") as sink:
        subprocess.run(args + ["keygen"], cwd=directory, env=env, stdout=sink,
                       stderr=sink, check=True, timeout=300)
    return directory
