"""Command line over the wallet service, for the fakenet suites.

    python3 cli.py create   <who>
    python3 cli.py balances <who>
    python3 cli.py pay      <who> <to-address> <nicks>
    python3 cli.py buy      <who> <nicks> [--min-out N]
    python3 cli.py sell     <who> <units>
    python3 cli.py quote    <who> buy|sell <amount>   (the pool as it stands; no reservation, nothing built)
    python3 cli.py transfer <who> <units> <to-address>
    python3 cli.py reconcile <who>          (every open request against the node, by transaction id)
    python3 cli.py wait     <who> <request-id> [--timeout S]
    python3 cli.py status   <who>           (every request recorded)

Options: --request-id ID (default: a timestamped id), --min-out N (a buy's least
tokens out, a sell's least nicks out), --slippage-bps N (the floor is a quote made
now less this allowance; the build re-checks it against the pool as it stands
when the request's turn on the pool comes), --no-wait (return after the
broadcast), --crash-after reserved|built|broadcast (test hook: exit without
cleanup at that point), --json (balances as JSON).

Configuration from the environment, the names the shell suites use:
REPO RUN PORT PUBLIC_ADDR TOKEN_B (the token) FEE_BPS LORE_BPS LORE_LOCK
PLACEHOLDER_ADDR (the address a trade's base transaction pays; its lock is
rewritten into the pool's seed) FEE_NICKS DUST.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from chain import Tools, ChainError  # noqa: E402
from service import WalletService  # noqa: E402
from wallet_backend import WalletError  # noqa: E402


def out(line):
    print(line, flush=True)


def env(name, default=None):
    v = os.environ.get(name, default)
    if v is None:
        sys.exit(f"missing environment variable {name}")
    return v


def build(args):
    tools = Tools(Path(env("REPO")), Path(env("RUN")), int(env("PORT", "25655")), env("PUBLIC_ADDR", "127.0.0.1:5556"),
                  log=lambda s: out(f"  ({s})"))
    placeholder = os.environ.get("PLACEHOLDER_ADDR", "")
    placeholder_lock = tools.key_lock(placeholder)[0] if placeholder else ""
    svc = WalletService(tools, args.who, placeholder_address=placeholder, placeholder_lock=placeholder_lock,
                        lore_bps=int(env("LORE_BPS", "50")), lore_lock=os.environ.get("LORE_LOCK", ""),
                        fee_bps=int(env("FEE_BPS", "100")), network_fee=int(env("FEE_NICKS", "16384")),
                        dust=int(env("DUST", "1000")), log=out, crash_after=args.crash_after)
    return tools, svc


def print_balances(b, as_json):
    if as_json:
        out(json.dumps(b, indent=1))
        return
    toks = " ".join(f"{t[:8]}…:total={v['total']}/available={v['available']}/reserved={v['reserved']}/notes={v['notes']}"
                    for t, v in b["tokens"].items()) or "-"
    out(f"BALANCES\t{b['wallet']}\theight={b['height']}\tnock_total={b['nock_total']}\tnock_available={b['nock_available']}"
        f"\tnock_pending={b['nock_pending']}\tnock_attached={b['nock_attached']}"
        f"\tnock_attached_pending={b['nock_attached_pending']}\tnock_unknown={b['nock_unknown']}\ttokens={toks}"
        f"\topen_requests={len(b['pending_requests'])}")
    for n in b["notes"]:
        out(f"  NOTE\t[{n['name']}]\t{n['kind']}\tnicks={n['nicks']}\ttoken={n['token'][:8] + '…' if n['token'] else '-'}"
            f"\tunits={n['units']}\t{'reserved_by=' + n['reserved_by'] if n['reserved_by'] else 'free'}")
    for r in b["pending_requests"]:
        out(f"  OPEN\t{r['request']}\t{r['side']}\t{r['state']}\ttxid={r['txid']}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("command")
    ap.add_argument("who")
    ap.add_argument("rest", nargs="*")
    ap.add_argument("--request-id")
    ap.add_argument("--min-out", type=int, default=None, help="buy: least tokens out; sell: least nicks out")
    ap.add_argument("--slippage-bps", type=int, default=None, help="floor = a quote now, less this allowance")
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--no-wait", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--crash-after", choices=["reserved", "built", "broadcast"])
    args = ap.parse_args(argv)
    tools, svc = build(args)
    token = os.environ.get("TOKEN_B", "")
    rid = args.request_id or f"{args.command}-{time.strftime('%H%M%S')}-{os.getpid()}"
    try:
        if args.command == "create":
            tools.keygen(args.who)
            svc.open()
            out(f"WALLET\t{args.who}\taddress={svc.address}\tlock={svc.lock}\tkeys={tools.keys / (args.who + '.export')}")
            print_balances(svc.balances(), args.json)
            return 0
        svc.open()
        if args.command == "balances":
            print_balances(svc.balances(), args.json)
            return 0
        if args.command == "status":
            for s in svc.submissions():
                out(f"REQUEST\t{s.request}\t{s.side}\t{s.state}\ttxid={s.txid}\tsent_height={s.sent_height}"
                    f"\tmined_height={s.mined_height}\tblock={s.mined_block}\tattempts={s.attempts}\tinputs={s.input_names()}")
            return 0
        if args.command == "reconcile":
            subs = svc.reconcile()
            out(f"RECONCILED\t{args.who}\t{len(subs)} open request(s) checked\t"
                + " ".join(f"{s.request}={s.state}" for s in subs))
            return 0
        if args.command == "wait":
            s = svc.wait(args.rest[0], args.timeout)
            out(f"SETTLED\t{s.request}\t{s.state}\ttxid={s.txid}\theight={s.mined_height}\tblock={s.mined_block}")
            return 0 if s.state == "mined" else 1
        before = svc.balances()
        if args.command == "pay":
            sub = svc.pay(args.rest[0], int(args.rest[1]), rid)
        elif args.command == "buy":
            sub = svc.buy(token, int(args.rest[0]), rid, args.min_out or 1, args.slippage_bps)
        elif args.command == "sell":
            sub = svc.sell(token, int(args.rest[0]), rid, args.min_out or 0, args.slippage_bps)
        elif args.command == "quote":
            q = svc.quote_now(token, args.rest[0], int(args.rest[1]))
            out("QUOTE\t" + "\t".join(f"{k}={v}" for k, v in q.items()))
            return 0
        elif args.command == "transfer":
            sub = svc.transfer(token, int(args.rest[0]), args.rest[1], rid)
        else:
            sys.exit(f"unknown command {args.command}")
        if sub.state == "sent" and not args.no_wait:
            sub = svc.wait(rid, args.timeout)
        info = json.loads(sub.detail) if sub.detail.startswith("{") else {}
        quote = info.get("quote", {})
        q = "\t".join(f"{k}={v}" for k, v in quote.items() if k != "pool_after")
        out(f"RESULT\t{rid}\t{sub.side}\t{sub.state}\ttxid={sub.txid}\theight={sub.mined_height}\tblock={sub.mined_block}\t{q}")
        after = svc.balances()
        out(f"DELTA\t{rid}\tnock_total: {before['nock_total']} -> {after['nock_total']}\tnock_available: {before['nock_available']} -> {after['nock_available']}"
            f"\tnock_attached: {before['nock_attached']} -> {after['nock_attached']}\ttokens: "
            + " ".join(f"{t[:8]}…: {before['tokens'].get(t, {}).get('total', 0)} -> {v['total']}"
                       for t, v in {**before['tokens'], **after['tokens']}.items()))
        print_balances(after, args.json)
        return 0 if sub.state in ("mined", "sent") else 1
    except (WalletError, ChainError) as e:
        out(f"ERROR\t{args.command}\t{args.who}\t{e}")
        return 2
    finally:
        svc.close()


if __name__ == "__main__":
    sys.exit(main())
