"""Synthetic planning example: does not connect, create keys, or send funds."""
from dataclasses import asdict
import json
from wallet_backend import Note, Snapshot, Request, Planner

planner = Planner(":memory:", "synthetic-fakenet", "demo-alice")
try:
    snapshot = Snapshot("synthetic-fakenet", "synthetic-block", 100, "demo-alice", (
        Note("plain/full-name", 200_000, "plain"),
        Note("token/full-name", 1000, "token", "DEMO", 100),
    ))
    # Arbitrary illustration amounts; this is NOT a live fee estimate.
    request = Request("demo-sell", "sell", "DEMO", 25, 0, 100)
    result = planner.reserve(snapshot, request, current_block="synthetic-block", now=100)
    print(json.dumps({"synthetic_only": True, "plan": asdict(result)}, indent=2))
finally:
    planner.close()
