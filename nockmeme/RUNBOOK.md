# Runbook: proving NMEME on a live chain

Everything in this package that can run without a chain has been run. What
remains is one thing, and it needs one resource this environment does not
have: memory.

## Hardware requirement — measured, not estimated

The node's first boot generates a 14-bucket recursive-verifier setup. That
generation was OOM-killed under a **13.34 GiB** cgroup ceiling in both
configurations tried, at the same point:

| `RAYON_NUM_THREADS` | Anon RSS at kill | Wall time | Reached `%born` |
| --- | --- | --- | --- |
| 4 (default) | 13.88 GB | ~21 min | no |
| 1 | 13.93 GB | ~89 min | no |

RSS was still climbing when killed, so ~14 GB is a floor, not the requirement.
Nockchain's own `Makefile` uses `DOCKER_MEM ?= 32g`.

**Provision 32 GB RAM, 4+ cores, ~25 GB free disk.** Setup is a one-time cost
per data directory (`ai-pow-jets/src/setup.rs:751`); the source comment says
about 15 minutes at default parallelism. That figure is unverified here because
it never completed.

Also required: a writable `/proc/sys` (for `vm.overcommit_memory=1`, without
which the NockVM's 16 GB reservation fails at build time), `protoc`, `clang`,
`cmake`, `make`, `pkg-config`, and Rust via `rustup` (the checkout pins its
nightly).

## Commands, in order

```bash
# 1. Nockchain at the pinned revision
git clone https://github.com/nockchain/nockchain.git
cd nockchain && git checkout 2bcb0b9dfd190f17252205afd1c8a067048a1ad9
apt install -y protobuf-compiler
echo 1 > /proc/sys/vm/overcommit_memory

# 2. Kernel assets (not in the repo; honk builds them from Hoon, ~1-2 min each)
cargo build --release -p honk --bin honk
for k in dumb:hoon/apps/dumbnet/outer.hoon miner:hoon/apps/dumbnet/miner.hoon \
         wal:hoon/apps/wallet/wallet.hoon  peek:hoon/apps/peek/peek.hoon; do
  ./target/release/honk --new --output "assets/native/${k%%:*}.jam" \
      --prelude hoon/common/hoon.hoon "${k##*:}" hoon
done
cp assets/native/*.jam assets/

# 3. Node, wallet, miner
cargo build --release -p nockchain --bin nockchain \
  -p nockchain-wallet --bin nockchain-wallet -p zk-pow-miner --bin zk-pow-mine

# 4. This package's crates, built inside the workspace
/path/to/nockmeme/scripts/link-into-workspace.sh "$PWD"
cargo build -p nmeme-tx -p nmeme-index --bins
cargo test  -p nmeme-core -p nmeme-tx -p nmeme-index     # 53 tests
bash /path/to/nockmeme/scripts/gate-selftest.sh          # 9 checks

# 5. Node. On 32 GB use default parallelism; the 1-thread setting only
#    slows things down and does not save enough to matter.
export REPO="$PWD" RUN=/var/tmp/nmeme-run
RAYON_NUM_THREADS=4 bash /path/to/nockmeme/scripts/node-lowmem.sh "$REPO" "$RUN"
until grep -aq "handle-command: born" "$RUN/node.log"; do sleep 30; done

# 6. The demonstration
bash /path/to/nockmeme/scripts/live-demo.sh 2>"$RUN/progress.log" | tee "$RUN/results.txt"
```

`node-lowmem.sh` already binds the public gRPC service, which `nmeme-index`
needs and which is off by default. If the node was started some other way,
`run-after-born.sh` restarts it correctly once the setup cache exists.

## What success looks like

`results.txt` (stdout only; progress is on stderr) should contain, in order:

```
GENESIS txid=<b58> height=<n>
TOKEN <b58>
TRANSFER txid=<b58> height=<n>
STEP <genesis-txid> Created(...)
STEP <transfer-txid> Transferred(...)
BALANCE <alice-lock-root> 999900
BALANCE <bob-lock-root>   100
TOTAL 1000000
SUPPLY 1000000
ASSERT-OK <alice-lock-root> 999900
ASSERT-OK <bob-lock-root> 100
ASSERT-OK total 1000000
```

The script exits non-zero at the first thing that is not as expected, and it
will not attach a claim until the Rust signing digest has been verified against
the wallet's own signature (stage 4). If stage 4 fails, that is the finding —
do not proceed past it.

## What a pass would and would not prove

It would prove: a real node accepts and mines NMEME creation and transfer; the
signing-hash transcription matches the wallet's; note-data merging behaves as
read from source; supply is conserved on chain.

It would not prove: `output-source` pinning (the swap design rests on it and
this demo does not exercise it), anything about adversarial inputs at the node
level, or anything about mainnet.
