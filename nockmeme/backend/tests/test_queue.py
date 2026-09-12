"""The per-pool trade queue under failure (pack 9, after the independent
review of pack 8): pool ownership survives a crash anywhere after the build,
a resend goes through the queue, the wait bounds the lock, and a failure
while entering the turn releases it. The first three tests are the
reviewer's regressions, unchanged in what they assert."""
import fcntl
import json
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_service import FakeTools, TOKEN, LORE  # noqa: E402
from service import PoolQueue, WalletService  # noqa: E402
from chain import ChainError  # noqa: E402
from wallet_backend import WalletError  # noqa: E402

BACKEND = Path(__file__).resolve().parent.parent


def service(tools, who, log=None, wait=3):
    s = WalletService(tools, who, placeholder_address="alice", placeholder_lock="lock-of-alice", lore_lock=LORE,
                      log=(log.append if log is not None else None))
    s.queue_wait = wait
    return s.open()


def lock_is_free(q, pool="POOLLOCK"):
    with open(q.dir / f"pool-{pool}.lock", "w") as probe:
        try:
            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        fcntl.flock(probe, fcntl.LOCK_UN)
        return True


class ReviewerRegressions(unittest.TestCase):
    def test_reconcile_restores_pending_pool_ownership(self):
        with tempfile.TemporaryDirectory() as root:
            t = FakeTools(root)
            t.notes = {"p1 a": (2000000, "plain", "", 0), "p2 b": (2000000, "plain", "", 0)}
            s = service(t, "dave")
            send = t.send

            def crash_after_send(path):
                send(path)
                raise SystemExit(3)
            t.send = crash_after_send
            with self.assertRaises(SystemExit):
                s.buy(TOKEN, 655360, "first")
            first = s.get("first")
            s.close()
            t.send = send
            s = service(t, "dave")
            try:
                s.reconcile()
                self.assertEqual(t.tx_status(first.txid).state, "pending")
                rows = s.queue.db.execute("SELECT txid FROM pool_trades WHERE pool=?", ("POOLLOCK",)).fetchall()
                self.assertEqual(rows, [(first.txid,)], "Pending transaction is missing from the pool queue after restart")
                self.assertEqual(s.get("first").state, "sent")
            finally:
                s.close()

    def test_queue_deadline_covers_file_lock_wait(self):
        with tempfile.TemporaryDirectory() as root:
            q = PoolQueue(FakeTools(root))
            with open(q.dir / "pool-POOLLOCK.lock", "w") as held:
                fcntl.flock(held, fcntl.LOCK_EX)
                code = """import sys
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[1] + '/tests')
from test_service import FakeTools
from service import PoolQueue
from wallet_backend import WalletError
q = PoolQueue(FakeTools(sys.argv[2]))
try:
    with q.turn('POOLLOCK', wait=0.05, poll=0.01):
        raise AssertionError('Acquired an already-held lock')
except WalletError:
    pass
finally:
    q.close()
"""
                try:
                    try:
                        result = subprocess.run([sys.executable, "-c", code, str(BACKEND), root],
                                                capture_output=True, text=True, timeout=0.5)
                    except subprocess.TimeoutExpired:
                        self.fail("Still blocked after 0.5 seconds with a 0.05-second queue timeout")
                    self.assertEqual(result.returncode, 0, result.stderr)
                finally:
                    fcntl.flock(held, fcntl.LOCK_UN)
                    q.close()

    def test_node_query_error_releases_pool_lock(self):
        with tempfile.TemporaryDirectory() as root:
            t = FakeTools(root)
            q = PoolQueue(t)
            q.db.execute("INSERT INTO pool_trades VALUES (?,?,?,?,?)", ("POOLLOCK", "tx1", "first", "dave", 0))

            def unavailable(txid):
                raise ChainError("node unavailable")
            t.tx_status = unavailable
            turn = q.turn("POOLLOCK", wait=0.05, poll=0.01)
            try:
                with self.assertRaises(ChainError):
                    with turn:
                        pass
                self.assertTrue(lock_is_free(q), "Pool lock remains held after __enter__ raises ChainError")
            finally:
                if turn.fh and not turn.fh.closed:
                    turn.fh.close()
                q.close()


class TwoWallets(unittest.TestCase):
    """dave and erin on one node: one fake chain (its accepted set, its pool),
    two wallets each with its own records and reservations."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.t = FakeTools(self.tmp.name)
        self.t.notes = {"p1 a": (2_000_000, "plain", "", 0), "p2 b": (2_000_000, "plain", "", 0),
                        "p3 c": (2_000_000, "plain", "", 0)}
        self.log = []

    def tearDown(self):
        self.tmp.cleanup()

    def registry(self, s):
        return s.queue.db.execute("SELECT txid, wallet FROM pool_trades WHERE pool='POOLLOCK'").fetchall()

    def crash(self, when):
        """The process dies before ("built") or right after ("broadcast") the
        send; the service's own hook leaves the process for real, so the
        tests emulate it through the fake node's send."""
        send = self.t.send

        def dying_send(path):
            if when == "broadcast":
                send(path)
            raise SystemExit(3)
        self.t.send = dying_send
        return send

    def revive(self, send):
        self.t.send = send

    def test_crash_after_build_the_other_wallet_proceeds_and_the_stale_resend_is_refused(self):
        dave = service(self.t, "dave", self.log)
        send = self.crash("built")
        with self.assertRaises(SystemExit):
            dave.buy(TOKEN, 655_360, "dave-1")
        self.revive(send)
        first = dave.get("dave-1")
        self.assertEqual(first.state, "built")
        self.assertEqual(self.registry(dave), [(first.txid, "dave")])  # owned before any broadcast
        self.assertEqual(self.t.sent, [])
        dave.close()
        # erin trades on the same pool right away: the owner is unknown to the node, the pool is free
        erin = service(self.t, "erin", self.log)
        second = erin.buy(TOKEN, 655_360, "erin-1")
        self.assertEqual(second.state, "sent")
        self.assertEqual(self.registry(erin), [(second.txid, "erin")])
        self.assertTrue(any("is unknown to the node: the pool is free" in line for line in self.log))
        # dave's restart resends through the queue: erin's trade is pending, so it waits and then defers
        dave = service(self.t, "dave", self.log, wait=1)
        t0 = time.time()
        dave.reconcile()
        self.assertGreater(time.time() - t0, 0.9)
        self.assertEqual(dave.get("dave-1").state, "built")
        self.assertTrue(any(line.startswith("DEFERRED\tdave-1") for line in self.log))
        self.assertEqual(self.registry(dave), [(second.txid, "erin")])  # a deferred resend takes nothing
        # erin's trade is mined and the pool has moved on: the node refuses dave's stale transaction
        self.t.mine(second.txid, pool_after=json.loads(second.detail)["quote"]["pool_after"])
        self.t.admit = False
        dave.reconcile()
        self.assertEqual(dave.get("dave-1").state, "refused")
        self.assertEqual(dave.planner.reserved(), {})
        self.assertEqual(self.registry(dave), [])  # a refused trade owns no pool
        self.assertTrue(lock_is_free(dave.queue))
        dave.close()
        erin.close()

    def test_crash_after_broadcast_the_other_wallet_waits_and_is_quoted_against_the_moved_pool(self):
        dave = service(self.t, "dave", self.log)
        send = self.crash("broadcast")
        with self.assertRaises(SystemExit):
            dave.buy(TOKEN, 655_360, "dave-1")
        self.revive(send)
        first = dave.get("dave-1")
        self.assertEqual(first.state, "built")  # the send happened, the record of it did not
        self.assertEqual(self.t.tx_status(first.txid).state, "pending")
        self.assertEqual(self.registry(dave), [(first.txid, "dave")])
        q1 = json.loads(first.detail)["quote"]
        dave.close()
        # erin starts at once; dave's transaction is mined a moment later
        erin = service(self.t, "erin", self.log)

        def mine_soon():
            time.sleep(1)
            self.t.mine(first.txid, pool_after=q1["pool_after"])
        threading.Thread(target=mine_soon).start()
        t0 = time.time()
        second = erin.buy(TOKEN, 655_360, "erin-1")
        self.assertGreater(time.time() - t0, 0.9)  # it waited for dave's pending trade
        self.assertTrue(any("waiting for dave-1" in line for line in self.log))
        q2 = json.loads(second.detail)["quote"]
        self.assertLess(q2["out_net"], q1["out_net"])  # quoted against the pool after dave's trade
        self.assertEqual(self.registry(erin), [(second.txid, "erin")])
        # dave's restart finds its transaction mined: settled by id, never sent twice
        dave = service(self.t, "dave", self.log)
        dave.reconcile()
        self.assertEqual(dave.get("dave-1").state, "mined")
        self.assertEqual(self.t.sent.count(first.txid), 1)
        self.assertEqual(dave.planner.reserved(), {})
        dave.close()
        erin.close()

    def test_the_other_wallet_gives_up_on_a_pool_held_by_a_crashed_pending_trade(self):
        dave = service(self.t, "dave", self.log)
        send = self.crash("broadcast")
        with self.assertRaises(SystemExit):
            dave.buy(TOKEN, 655_360, "dave-1")
        self.revive(send)
        dave.close()
        erin = service(self.t, "erin", self.log, wait=1)
        with self.assertRaisesRegex(WalletError, "pool busy"):
            erin.buy(TOKEN, 655_360, "erin-1")
        self.assertEqual(erin.get("erin-1").state, "aborted")
        self.assertEqual(erin.planner.reserved(), {})
        self.assertEqual(len(self.t.sent), 1)
        self.assertTrue(lock_is_free(erin.queue))
        erin.close()


class TurnFailures(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.t = FakeTools(self.tmp.name)
        self.t.notes = {"p1 a": (2_000_000, "plain", "", 0)}
        self.log = []

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_node_error_while_entering_the_turn_aborts_and_releases_the_request(self):
        s = service(self.t, "dave", self.log)
        s.queue.db.execute("INSERT INTO pool_trades VALUES (?,?,?,?,?)", ("POOLLOCK", "tx-other", "other", "erin", 0))

        def unavailable(txid):
            raise ChainError("node unavailable")
        self.t.tx_status = unavailable
        with self.assertRaises(ChainError):
            s.buy(TOKEN, 655_360, "buy-1")
        self.assertEqual(s.get("buy-1").state, "aborted")
        self.assertEqual(s.planner.reserved(), {})
        self.assertEqual(self.t.sent, [])
        self.assertTrue(lock_is_free(s.queue))
        s.close()

    def test_a_refused_trade_owns_no_pool_and_the_lock_is_free(self):
        s = service(self.t, "dave", self.log)
        self.t.admit = False
        self.assertEqual(s.buy(TOKEN, 655_360, "buy-1").state, "refused")
        self.assertEqual(s.planner.reserved(), {})
        self.assertEqual(s.queue.db.execute("SELECT count(*) FROM pool_trades").fetchone()[0], 0)
        self.assertTrue(lock_is_free(s.queue))
        s.close()

    def test_a_lock_held_elsewhere_is_given_up_within_the_wait_and_the_request_released(self):
        s = service(self.t, "dave", self.log, wait=0.3)
        with open(s.queue.dir / "pool-POOLLOCK.lock", "w") as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            t0 = time.time()
            with self.assertRaisesRegex(WalletError, "holds the pool's turn"):
                s.buy(TOKEN, 655_360, "buy-1")
            self.assertLess(time.time() - t0, 2)
            fcntl.flock(held, fcntl.LOCK_UN)
        self.assertEqual(s.get("buy-1").state, "aborted")
        self.assertEqual(s.planner.reserved(), {})
        s.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
