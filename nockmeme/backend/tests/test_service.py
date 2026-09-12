"""The service's lifecycle against a scripted chain: reservations survive a
restart, settlement is by transaction id and canonical inclusion (never by
inputs having been spent), a crash at each point of a submission resumes
correctly, two processes cannot double-select, balances are split."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from chain import ChainView, FundingRow, TokenRow, TxStatus, SendResult, Tools  # noqa: E402
from service import WalletService  # noqa: E402
from wallet_backend import WalletError, Planner, Snapshot, Note, Request  # noqa: E402

TOKEN = "TOKENB"
LORE = "LORELOCK"


class FakeTools:
    """A chain in memory. Notes: {name: (nicks, kind, token, units)}."""
    rows, fee_line, quote, new_sighashes = (staticmethod(Tools.rows), staticmethod(Tools.fee_line),
                                            staticmethod(Tools.quote), staticmethod(Tools.new_sighashes))

    def __init__(self, root):
        self.root = Path(root)
        self.notes = {}
        self.height = 100
        self.status = {}  # txid -> TxStatus
        self.admit = True
        self.sent = []
        self.created_inputs = None  # override: what create_tx "spends"
        self.wallets = self.root / "wallets"
        self.keys = self.root / "keys"

    # identity
    def genesis(self):
        return "GENESIS"

    def block(self, h):
        return h, f"B{h}", f"B{h - 1}"

    def key_lock(self, address):
        return f"lock-of-{address}", f"first-of-{address}"

    def address(self, who):
        return f"addr-{who}"

    def wallet_dir(self, who):
        return self.wallets / who

    # reads
    def view(self, lock):
        funding, tokens = [], []
        for name, (nicks, kind, token, units) in sorted(self.notes.items()):
            f, l = name.split()
            funding.append(FundingRow(f, l, "claim" if kind == "token" else "plain", nicks, 1))
            if kind == "token":
                tokens.append(TokenRow(f, l, nicks, units, token))
        return ChainView(self.height, f"B{self.height}", tuple(funding), tuple(tokens), ())

    def tx_status(self, txid):
        return self.status.get(txid, TxStatus(txid, "unknown", tip=self.height, detail="no such transaction"))

    def pool(self, *a):
        return "PF PL 5 10000000 60000"

    # building
    def create_tx(self, who, names, to, amount, fee):
        p = self.wallets / who / "txs" / f"{len(list((self.wallets / who / 'txs').glob('*')) if (self.wallets / who / 'txs').is_dir() else [])}.tx"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"inputs": list(self.created_inputs or names), "to": to, "amount": amount, "fee": fee}))
        return p

    def inputs_of(self, path):
        return json.loads(Path(path).read_text())["inputs"]

    def check_inputs(self, path, token_notes=()):
        return True, "INPUTS ok"

    def sighash(self, path, out_dir):
        return [("k1", "d1", "pub", "pkh", "sig")]

    def verify_hash(self, who, digest, sigfile, pubkey):
        return True

    def fee(self, path):
        return 16384, 8192

    def pool_trade(self, path, out, pool, token, fee_bps, lore_bps, lore_lock, side, placeholder, dust, tokens_in=0, claim=None):
        Path(out).write_text(Path(path).read_text() + f"|trade:{side}:{tokens_in}:{claim}")
        q = ("QUOTE\tbuy\tin=655360 nicks\tout_net=3953 tokens\tpool_fee=6510 nicks\tlore_fee=3281 nicks\tnetwork_fee=16384 nicks"
             if side == "buy" else
             f"QUOTE\tsell\tin={tokens_in} tokens\tout_net=347576 nicks\tpool_fee=20 tokens\tlore_fee=1751 nicks\tnetwork_fee=16384 nicks")
        return q + "\nPOOL-AFTER\t10704173\t61662\nNEWSIGHASH\tk1\td2\nFEE\tcurrent=16384\trequired=16384\n"

    def attach(self, path, out, claims):
        Path(out).write_text(Path(path).read_text() + f"|attach:{claims}")
        return "ATTACHED\tx\t1\nNEWSIGHASH\tk1\td2\nFEE\tcurrent=16384\trequired=16384\n"

    def sign_hash(self, who, digest, dest):
        Path(dest).write_text(digest)
        return dest

    def set_sig(self, cur, key, pkh, pubkey, sig, out):
        Path(out).write_text(Path(cur).read_text() + f"|sig:{key}")

    def tx_id(self, path):
        return "tx" + hashlib.sha256(Path(path).read_bytes()).hexdigest()[:12]

    def send(self, path):
        txid = self.tx_id(path)
        self.sent.append(txid)
        if self.admit:
            self.status[txid] = TxStatus(txid, "pending", tip=self.height)
            return SendResult(txid, True, "MEMPOOL\tadmitted")
        return SendResult(txid, False, "MEMPOOL\tnot admitted\tv1-token-claims")

    # what the chain does next
    def mine(self, txid, canonical="yes"):
        self.height += 1
        self.status[txid] = TxStatus(txid, "mined", self.height, f"B{self.height}", canonical,
                                     f"B{self.height}" if canonical == "yes" else "OTHER", self.height)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tools = FakeTools(self.tmp.name)
        self.tools.notes = {"p1 a": (2_000_000, "plain", "", 0), "t1 b": (500_000, "token", TOKEN, 3000)}
        self.log = []

    def tearDown(self):
        self.tmp.cleanup()

    def svc(self, **kw):
        s = WalletService(self.tools, "dave", placeholder_address="alice", placeholder_lock="lock-of-alice",
                          lore_lock=LORE, log=self.log.append, **kw)
        return s.open()

    def test_buy_reserves_builds_sends_and_settles_by_txid(self):
        s = self.svc()
        sub = s.buy(TOKEN, 655_360, "buy-1")
        self.assertEqual(sub.state, "sent")
        self.assertEqual(s.planner.reserved(), {"p1 a": "buy-1"})
        self.assertTrue(Path(sub.file).is_file())
        # the inputs "leaving the unspent set" is not settlement: the note
        # vanishes from the chain view, the node still says pending
        del self.tools.notes["p1 a"]
        self.assertEqual(s.settle(s.get("buy-1")).state, "sent")
        self.assertEqual(s.planner.reserved(), {"p1 a": "buy-1"})
        # mined in a block that is not canonical: still not settled
        self.tools.mine(sub.txid, canonical="no")
        self.assertEqual(s.settle(s.get("buy-1")).state, "sent")
        self.assertEqual(s.planner.reserved(), {"p1 a": "buy-1"})
        # canonical: settled, released
        self.tools.mine(sub.txid, canonical="yes")
        done = s.settle(s.get("buy-1"))
        self.assertEqual((done.state, done.mined_block), ("mined", f"B{self.tools.height}"))
        self.assertEqual(s.planner.reserved(), {})
        s.close()

    def test_sell_uses_the_token_note_and_carries_the_change_claim(self):
        s = self.svc()
        sub = s.sell(TOKEN, 1000, "sell-1")
        self.assertEqual(s.planner.reserved(), {"t1 b": "sell-1"})
        info = json.loads(sub.detail)
        self.assertEqual(info["change_claim"], f"lock-of-addr-dave=transfer:{TOKEN}:2000")
        self.assertIn("|trade:sell:1000:", Path(sub.file).read_text())
        s.close()

    def test_transfer_claims(self):
        s = self.svc()
        sub = s.transfer(TOKEN, 100, "bob", "x-1")
        info = json.loads(sub.detail)
        self.assertEqual(info["claims"], [f"lock-of-bob=transfer:{TOKEN}:100", f"lock-of-addr-dave=transfer:{TOKEN}:2900"])
        s.close()

    def test_refusal_releases(self):
        self.tools.admit = False
        s = self.svc()
        sub = s.buy(TOKEN, 655_360, "buy-1")
        self.assertEqual(sub.state, "refused")
        self.assertEqual(s.planner.reserved(), {})
        with self.assertRaisesRegex(WalletError, "already planned"):
            s.buy(TOKEN, 655_360, "buy-1")
        s.close()

    def test_wallet_spending_other_inputs_aborts_before_signing(self):
        self.tools.created_inputs = ["t1 b"]
        s = self.svc()
        with self.assertRaisesRegex(WalletError, "the plan reserved"):
            s.buy(TOKEN, 655_360, "buy-1")
        self.assertEqual(s.get("buy-1").state, "aborted")
        self.assertEqual(s.planner.reserved(), {})
        self.assertEqual(self.tools.sent, [])
        s.close()

    def test_restart_after_reservation_aborts_and_releases(self):
        s = self.svc()
        snap, view = s.snapshot()
        plan = s.planner.reserve(snap, Request("r-1", "buy", TOKEN, 1, 655_360, 16384, 1000),
                                 current_block=view.block, now=snap.observed_at)
        from service import Submission
        s._put(Submission("r-1", "buy", TOKEN, "planned", inputs=json.dumps(list(plan.inputs)), created=1.0))
        s.close()
        s2 = self.svc()  # the restart: the reservation is still there
        self.assertEqual(s2.planner.reserved(), {"p1 a": "r-1"})
        s2.reconcile()
        self.assertEqual(s2.get("r-1").state, "aborted")
        self.assertEqual(s2.planner.reserved(), {})
        self.assertEqual(self.tools.sent, [])
        s2.close()

    def test_restart_after_build_sends_the_stored_transaction(self):
        s = self.svc()
        original = self.tools.send
        self.tools.send = lambda path: (_ for _ in ()).throw(SystemExit(3))  # the crash
        with self.assertRaises(SystemExit):
            s.buy(TOKEN, 655_360, "buy-1")
        s.close()
        self.tools.send = original
        s2 = self.svc()
        self.assertEqual(s2.get("buy-1").state, "built")
        self.assertEqual(s2.planner.reserved(), {"p1 a": "buy-1"})
        s2.reconcile()
        sub = s2.get("buy-1")
        self.assertEqual((sub.state, self.tools.sent), ("sent", [sub.txid]))
        self.tools.mine(sub.txid)
        self.assertEqual(s2.wait("buy-1", timeout=1, poll=0).state, "mined")
        s2.close()

    def test_restart_after_broadcast_finds_it_in_the_mempool_without_resending(self):
        s = self.svc()
        original = self.tools.send

        def crash_after_send(path):
            original(path)
            raise SystemExit(3)
        self.tools.send = crash_after_send
        with self.assertRaises(SystemExit):
            s.buy(TOKEN, 655_360, "buy-1")
        s.close()
        self.tools.send = original
        s2 = self.svc()
        self.assertEqual(s2.get("buy-1").state, "built")
        s2.reconcile()
        sub = s2.get("buy-1")
        self.assertEqual(sub.state, "sent")
        self.assertEqual(len(self.tools.sent), 1)  # not sent twice
        s2.close()

    def test_node_forgetting_a_sent_transaction_resends_the_same_id(self):
        s = self.svc()
        sub = s.buy(TOKEN, 655_360, "buy-1")
        del self.tools.status[sub.txid]  # the node restarted: its mempool is gone
        s.settle(s.get("buy-1"))
        self.assertEqual(self.tools.sent, [sub.txid, sub.txid])
        self.assertEqual(s.get("buy-1").state, "sent")
        s.close()

    def test_two_processes_one_note(self):
        # two services on one database (as two processes would be), one plain note
        results = {}

        def go(name):
            s = self.svc()
            try:
                results[name] = s.buy(TOKEN, 655_360, name).state
            except WalletError as e:
                results[name] = f"refused: {e}"
            finally:
                s.close()
        a, b = threading.Thread(target=go, args=("A",)), threading.Thread(target=go, args=("B",))
        a.start(); b.start(); a.join(); b.join()
        self.assertEqual(sorted(v[:7] for v in results.values()), ["refused", "sent"])
        self.assertEqual(len(self.tools.sent), 1)
        self.assertIn("insufficient ordinary NOCK", [v for v in results.values() if v.startswith("refused")][0])

    def test_balances_split_total_available_pending_attached(self):
        s = self.svc()
        s.sell(TOKEN, 1000, "sell-1")
        b = s.balances()
        self.assertEqual((b["nock_total"], b["nock_available"], b["nock_pending"], b["nock_attached"], b["nock_attached_pending"]),
                         (2_500_000, 2_000_000, 0, 500_000, 500_000))
        self.assertEqual(b["tokens"][TOKEN], {"total": 3000, "available": 0, "reserved": 3000, "notes": 1})
        self.assertEqual([r["request"] for r in b["pending_requests"]], ["sell-1"])
        s.close()


if __name__ == "__main__":
    unittest.main()
