import dataclasses as d
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from wallet_backend import Note, Snapshot, Request, Planner, WalletError, MAX, create_test_wallet


class WalletTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / "wallet.sqlite")
        self.p = Planner(self.path, "test-genesis", "alice")
        self.s = Snapshot("test-genesis", "block-1", 100, "alice", (
            Note("a/full", 200, "plain"), Note("b/full", 900, "token", "MEME", 50),
            Note("c/full", 5000, "unknown"), Note("d/full", 5000, "token", "OTHER", 100)))
        self.r = Request("trade-1", "buy", "MEME", 10, 100, 20)

    def tearDown(self):
        self.p.close()
        self.tmp.cleanup()

    def plan(self, snapshot=None, request=None, **kwargs):
        return self.p.reserve(snapshot or self.s, request or self.r, current_block="block-1", now=100, **kwargs)

    def test_buy_includes_network_fee_without_double_counting_trading_fees(self):
        p = self.plan()
        self.assertEqual((p.required_plain_nicks, p.plain_change_nicks), (120, 80))
        self.assertEqual(p.plain_inputs, ("a/full",))
        self.assertEqual(p.token_inputs, ())

    def test_sell_preserves_token_change_and_attached_nock(self):
        # adapted to the live finding (docs/WALLET.md): the token note a sell
        # spends anyway pays the fee from the NOCK it carries; no plain note
        # is added (its change would only merge into the token note)
        p = self.plan(request=d.replace(self.r, side="sell", buy_debit_nicks=0))
        self.assertEqual((p.required_plain_nicks, p.token_change_units, p.token_backing_nicks), (0, 40, 900))
        self.assertEqual((p.token_inputs, p.plain_inputs, p.backing_spent_nicks, p.token_change_nicks), (("b/full",), (), 20, 880))

    def test_no_plain_nock_refuses_when_token_backing_cannot_pay(self):
        # a token note holding 15 nicks can pay at most 14 of a 20-nick fee
        # (one nick must remain for its seed); with no plain note the sell is refused
        thin = (Note("b/full", 15, "token", "MEME", 50),) + self.s.notes[2:]
        with self.assertRaisesRegex(WalletError, "ordinary NOCK"):
            self.plan(snapshot=d.replace(self.s, notes=thin), request=d.replace(self.r, side="sell", buy_debit_nicks=0))
        # with a plain note the fee is split evenly (10 each): the token note pays its share, the plain note the rest
        p = self.plan(snapshot=d.replace(self.s, notes=thin + self.s.notes[:1]), request=d.replace(self.r, side="sell", buy_debit_nicks=0))
        self.assertEqual((p.token_inputs, p.plain_inputs, p.fee_per_note_nicks, p.backing_spent_nicks, p.plain_change_nicks), (("b/full",), ("a/full",), 10, 10, 190))

    def test_failed_plan_does_not_reserve(self):
        with self.assertRaises(WalletError):
            self.plan(request=d.replace(self.r, buy_debit_nicks=201))
        self.plan()

    def test_reservations_survive_restart(self):
        self.plan()
        self.p.close()
        self.p = Planner(self.path, "test-genesis", "alice")
        with self.assertRaisesRegex(WalletError, "ordinary NOCK"):
            self.plan(request=d.replace(self.r, request_id="trade-2"))

    def test_independent_connection_cannot_double_select(self):
        other = Planner(self.path, "test-genesis", "alice")
        try:
            self.plan()
            with self.assertRaises(WalletError):
                other.reserve(self.s, d.replace(self.r, request_id="other"), current_block="block-1", now=100)
        finally:
            other.close()

    def test_duplicate_request_rejected(self):
        self.plan()
        with self.assertRaisesRegex(WalletError, "already planned"):
            self.plan()

    def test_chain_wallet_tip_and_age_checks(self):
        for change in ({"genesis": "mainnet"}, {"owner": "bob"}, {"block": "fork"}, {"observed_at": 69}, {"observed_at": 101}):
            with self.subTest(change=change), self.assertRaises(WalletError):
                self.plan(snapshot=d.replace(self.s, **change))

    def test_database_binding(self):
        with self.assertRaises(WalletError):
            Planner(self.path, "other-genesis", "alice")

    def test_duplicate_notes_and_malformed_classification(self):
        bad = (self.s.notes + self.s.notes[:1], (Note("a", 1000, "plain", "MEME", 10),),
               (Note("a", 1000, "token"),), (Note("a", 1000, "unknown", spendable="true"),))
        for notes in bad:
            with self.subTest(notes=notes), self.assertRaises(WalletError):
                self.plan(snapshot=d.replace(self.s, notes=notes))

    def test_other_tokens_never_substitute(self):
        with self.assertRaisesRegex(WalletError, "verified"):
            self.plan(request=d.replace(self.r, side="sell", buy_debit_nicks=0, token_units=51))

    def test_locked_notes_not_spendable(self):
        with self.assertRaises(WalletError):
            self.plan(snapshot=d.replace(self.s, notes=(Note("a", 9999, "plain", spendable=False),)))

    def test_integer_bounds_and_missing_fee(self):
        for fee in (True, 0, -1, 1.5, "20", MAX):
            with self.subTest(fee=fee), self.assertRaises(WalletError):
                self.plan(request=d.replace(self.r, network_fee_nicks=fee))

    def test_native_creation_command_and_no_overwrite(self):
        with patch("wallet_backend.subprocess.run") as run:
            folder = create_test_wallet("/bin/true", self.tmp.name, "new-wallet", 5555)
            args = run.call_args.args[0]
            self.assertIn("--fakenet", args)
            self.assertEqual(args[-1], "keygen")
            self.assertEqual(run.call_args.kwargs["env"]["NOCKAPP_HOME"], str(folder))
            with self.assertRaises(FileExistsError):
                create_test_wallet("/bin/true", self.tmp.name, "new-wallet", 5555)

    def test_wallet_name_traversal_rejected(self):
        with self.assertRaises(WalletError):
            create_test_wallet("/bin/true", self.tmp.name, "../outside", 5555)


if __name__ == "__main__":
    unittest.main()
