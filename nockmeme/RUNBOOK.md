# Runbook: proving NMEME on a live chain

This ran to completion in a 15 GB / 4-core / ~35 GB-disk cloud container on
2026-09-11 (`results/RESULTS.md` §A11). What follows is the exact path.

## Hardware: 16 GB is enough, because the expensive step is done elsewhere

The node's first boot generates a 14-bucket recursive-verifier seed cache.
That generation does not fit 16 GB at any thread count — the two largest
buckets need a ~50 GB working set each (`results/environment.md`). But the
cache is a consensus-fixed file that any node validates against a committed
digest, so it can be produced anywhere, once:

- **Use the published one.** Branch `seed-cache` of this repository holds
  `nmeme-seed-cache.tar.gz` (sha256 of the extracted file
  `1dec7dfe51deb549c5a3dab9ddafdcee71f349dfc0c1179a25ec51c6ea74aca9`) from
  workflow run `34562677406`, digest-checked against
  `AI_POW_V0_VERIFIER_SETUP_TABLE_DIGEST` before publication.
- **Or regenerate it for free.** `.github/workflows/nmeme-seed-buckets.yml`
  proves one bucket per GitHub-hosted runner job (fourteen in parallel, each
  cgroup-throttled with swap from both runner disks), merges them in bucket
  order, checks the digest, and publishes. Five hours end to end, dominated
  by the two 2^19 buckets.

With the cache installed, the node's first boot here built the fourteen
on-disk verifier contexts (14.4 GB of disk, 2.9 GB peak RSS, 40 minutes) and
every later boot reaches `%born` in about 10 seconds at ~200 MB. **Budget
~20 GB of free disk** for the contexts plus the arena.

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
cargo test  -p nmeme-core -p nmeme-tx -p nmeme-index
# if that fails at LINK time (seen once, cause unknown), retry with:
#   CARGO_PROFILE_DEV_LTO=false CARGO_PROFILE_TEST_LTO=false cargo test ...
bash /path/to/nockmeme/scripts/gate-selftest.sh          # 9 checks

# 5. The seed cache, produced elsewhere (see above), installed into the
#    data dir the node will use. The node validates it on load.
export REPO="$PWD" RUN=/var/tmp/nmeme-run
git -C /path/to/CoolCryptoGames fetch origin seed-cache
git -C /path/to/CoolCryptoGames show origin/seed-cache:nmeme-seed-cache.tar.gz > /tmp/nmeme-seed-cache.tar.gz
bash /path/to/nockmeme/scripts/install-seed-cache.sh /tmp/nmeme-seed-cache.tar.gz "$RUN" \
  1dec7dfe51deb549c5a3dab9ddafdcee71f349dfc0c1179a25ec51c6ea74aca9

# 6. Node. First boot builds the on-disk contexts (~40 min, 2.9 GB peak);
#    later boots take seconds. node-lowmem.sh caps the PMA arena at 1 GiB
#    (the 32 GiB default filled the disk on its first persist here).
RAYON_NUM_THREADS=1 bash /path/to/nockmeme/scripts/node-lowmem.sh "$REPO" "$RUN"
until grep -aq "handle-command: born" "$RUN/node.log"; do sleep 30; done

# 7. The demonstration. FEE_NICKS=8192 covers the claim-bearing transactions
#    (measured minimums 5504 genesis / 7168 transfer; the default 4096 is refused).
FEE_NICKS=8192 bash /path/to/nockmeme/scripts/live-demo.sh 2>"$RUN/progress.log" | tee "$RUN/results.txt"
```

Fees: `create-tx` is given `--fee-nicks ${FEE_NICKS:-4096}`. `attach` then
recomputes the minimum for the transaction *with* the claim attached and
refuses if the fee is below it, printing a `FEE current=… required=…` line to
the progress log. If it refuses, raise `FEE_NICKS` to the number it names.

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
