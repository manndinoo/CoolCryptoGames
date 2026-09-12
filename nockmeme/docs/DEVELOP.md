# Building against Nockchain

`nmeme-core` compiles against Nockchain's own types. Getting a Nockchain
checkout to build is most of the work, and several of the failures are silent
or misleading, so they are recorded here.

Pinned revision: `2bcb0b9dfd190f17252205afd1c8a067048a1ad9`
Repository: `https://github.com/nockchain/nockchain`
(`zorp-corp/nockchain` redirects to the same repository.)

## Toolchain

The workspace pins `nightly-2026-04-03` in `rust-toolchain.toml`; `rustup` picks
it up automatically. Also required on the host: `clang`, `cmake`, `make`, `gcc`,
`g++`, `pkg-config`.

## Four things that will stop you

### 1. `protoc` is not optional

`nockapp-grpc-proto` fails its build script without it:

```
apt install protobuf-compiler       # Debian/Ubuntu
brew install protobuf               # macOS
```

The failure names the fix, but it appears part-way through a long build and is
easy to miss in the scrollback.

### 2. The kernel JAM assets are not in the repository

`crates/kernels/*` expect `assets/dumb.jam`, `assets/miner.jam`,
`assets/wal.jam` and `assets/peek.jam`. They are build products, not checked-in
files, and their absence fails as:

```
required jam asset is missing: .../assets/miner.jam (resolved from open/assets/miner.jam)
```

Build them with `honk`, the native Hoon compiler in the same workspace. The
cold-state asset it needs (`assets/honc-cold-138.jam`) *is* checked in.

```bash
cargo build --release -p honk --bin honk

for k in dumb:hoon/apps/dumbnet/outer.hoon \
         miner:hoon/apps/dumbnet/miner.hoon \
         wal:hoon/apps/wallet/wallet.hoon \
         peek:hoon/apps/peek/peek.hoon; do
  name="${k%%:*}"; src="${k##*:}"
  ./target/release/honk --new --output "assets/native/$name.jam" \
      --prelude hoon/common/hoon.hoon "$src" hoon
done

cp assets/native/*.jam assets/
```

Copying `assets/native/*.jam` over `assets/*.jam` is sound: the repository's own
CI asserts byte-parity between the honk-built and hoonc-built kernels
(`.github/workflows/parity.yml`, `bazel test //assets/native:kernel_parity_test`).
Each kernel takes roughly 1–2 minutes on four cores.

### 3. The NockVM wants a 16 GB arena

`honk` and the node map a 16 GB anonymous region (`NOCK_STACK_SIZE_MEDIUM`). On
a machine with less RAM than that, Linux's default heuristic overcommit refuses
the mapping, and the failure surfaces unhelpfully as:

```
thread 'honk' panicked at crates/nockvm/rust/nockvm/src/mem.rs:875
native hoon compile failed: native compiler worker thread panicked
```

The backtrace says `NewStackError`, which is an `mmap` failure, not a Hoon
compilation error. Allow overcommit:

```bash
echo 1 > /proc/sys/vm/overcommit_memory
```

The mapping is reserved, not resident — a 15 GB machine compiles the kernels
fine once overcommit is permitted. In a container this needs a writable
`/proc/sys`.

Note carefully what this does and does not buy. Allowing overcommit lets the
*reservation* succeed, which is enough to build the kernels and to boot the
node. It does not create memory. See §4.

## 4. Running a node needs real RAM, not just address space

Building everything works in 15 GB. **Running a fakenet node does not.**

On this machine `scripts/fakenet-zk-pow-smoke.sh` boots the node, which then
begins generating its recursive-verifier setup — real STARK proving, visible as
repeated `prove_all_tables` passes. Memory climbs steadily through those passes.
After about 21 minutes of wall time and 80 minutes of CPU across four cores, the
kernel killed it:

```
Memory cgroup out of memory: Killed process 4372 (nockchain)
total-vm:27549392kB, anon-rss:13881708kB
```

It never reached `%born`, so no block was ever mined. The smoke script reports
this as `[fail ] node died before %born`, which on its own reads like a crash —
check `dmesg` for the OOM line before assuming a bug, because the node itself
logs nothing on its way out.

13.9 GB resident is the floor observed here, and it was still climbing when the
process died, so the real requirement is higher. **Budget 32 GB for a node.**
The repository's own `Makefile` agrees: `DOCKER_MEM ?= 32g`.

The verifier setup is proof-independent and the smoke script caches it
(`AI_POW_VERIFIER_SETUP_CACHE_DIR`), so this cost is paid once per machine — but
it has to be paid somewhere with enough memory, and a cache produced elsewhere
would have to be copied in.

## A link failure seen elsewhere, not here

An independent verifier building the nmeme crates inside the pinned workspace
hit a link failure in the default dev/test profile (undefined `main` and Rust
runtime symbols) and succeeded with:

```bash
CARGO_PROFILE_DEV_LTO=false CARGO_PROFILE_TEST_LTO=false cargo test -p nmeme-core -p nmeme-tx -p nmeme-index
```

The independent rerun of pack 7 hit the same link failure in the default
*release* build (`undefined symbol: main`) and passed all 136 tests with

```bash
CARGO_PROFILE_RELEASE_LTO=false cargo test --release -p nmeme-core -p nmeme-tx -p nmeme-index
```

Neither failure was reproduced on the machine this work was done on, and the
cause has not been established (the workspace turns LTO on for release, and
the test harness's `main` is what goes missing at link time — a linker /
LTO interaction, not a source problem: the source was unchanged between the
failing and the passing build). If a profile fails to link, turn LTO off for
that profile with the matching `CARGO_PROFILE_<PROFILE>_LTO=false`; do not
report a build that needed it as a default-profile build.

## Building nmeme-core

`nmeme-core` uses `nockchain-types` and `nockchain-math` as workspace
dependencies. The fastest way to develop it is as a member of the Nockchain
workspace, so it shares the compiled dependency graph:

```bash
ln -s /path/to/nockmeme/crates/nmeme-core <nockchain>/crates/nmeme-core
# add "crates/nmeme-core" to the workspace `members` list
cargo test -p nmeme-core
```

Note that the Nockchain workspace sets `warnings = "deny"` and
`clippy::unwrap_used = "deny"` workspace-wide, so those apply to `nmeme-core`
too while it is built this way.
