# Measured environment limits

Recorded on the machine this work was done on. Numbers are measurements, not
estimates.

## The ceiling

```
$ cat /sys/fs/cgroup/memory/process_api/.../claude-code-bash/memory.limit_in_bytes
14327676928          # 13.34 GiB
$ grep MemTotal /proc/meminfo
MemTotal:       16461028 kB
$ grep SwapTotal /proc/meminfo
SwapTotal:             0 kB
$ nproc
4
```

## Node startup memory, by prover parallelism

The verifier-setup build is rayon-parallel and its peak RSS is dominated by
per-thread prover buffers.

| `RAYON_NUM_THREADS` | Peak RSS | % of ceiling | Outcome |
| --- | --- | --- | --- |
| 4 (default) | 13.24 GiB | 99% | **OOM-killed** before `%born`, ~21 min wall / ~80 min CPU |
| 1 | 13.29 GiB sampled, 13.93 GB at kill | 99% | **OOM-killed** before `%born`, 5371 s (89.5 min) on one core |

The full sample series is in `node-memory-1thread.tsv` (`elapsed_s`, `rss_kb`,
`pct_of_limit`, 350 samples at 15 s). It shows RSS oscillating between ~0.7 and
~6 GiB for the first hour, then climbing through the later buckets until the
ceiling. An earlier version of this document reported the 1-thread run as
fitting at 5.73 GiB. That was a mid-run reading taken before the climb, and it
was wrong. Single-threading only delayed exhaustion by about an hour.

The 1-thread kill, from `dmesg`:

```
Memory cgroup out of memory: Killed process 12641 (nockchain)
total-vm:27216352kB, anon-rss:13930064kB, file-rss:2408kB
```

Both kills were at the same place. The 4-thread kill, from `dmesg`:

```
Memory cgroup out of memory: Killed process 4372 (nockchain)
total-vm:27549392kB, anon-rss:13881708kB, file-rss:2292kB, shmem-rss:0kB
```

Note that the smoke script reports only `[fail ] node died before %born`, and
the node logs nothing on its way out. `dmesg` is the only place the OOM is
visible.

## Knobs used

Both are documented operator settings. Neither bypasses an environment
restriction.

| Setting | Effect | Source |
| --- | --- | --- |
| `RAYON_NUM_THREADS=1` | prover parallelism | cited as a tuning knob in `crates/ai-pow/src/zk_bridge.rs:3689` |
| `AI_POW_VERIFIER_CACHE_CAP=1` | resident-context LRU cap | `crates/ai-pow-jets/src/setup.rs:692`; `docs/VERIFIER_SETUP.md`: operators may "lower the cap to trade RSS for synchronous page-ins" |
| `vm.overcommit_memory=1` | lets the NockVM's 16 GB *reservation* succeed | required to build the kernels at all; reserves address space, not memory |

## On a cached verifier setup

`install_or_build_verifier_setup` (`ai-pow-jets/src/setup.rs:743`) takes a fast
path when a digest-matching seed cache is already present, skipping generation
entirely. The digest is committed in-source
(`AI_POW_V0_VERIFIER_SETUP_TABLE_DIGEST`), so a cache produced by any conforming
node validates against it.

**No such cache is published** in the repository or its `docker/` directory, and
none was found. So a first run on any machine pays the generation cost. Copying
the cache from a machine that has already paid it removes the wait for every
subsequent run, and is the right answer for repeated testing — it is not a way
to make the first run cheaper.

## Hardware requirement

- **Building** everything: fits in 13.34 GiB.
- **Running a node at default parallelism:** needs more than 13.9 GiB, and RSS
  was still climbing when killed, so that is a floor. Nockchain's own `Makefile`
  uses `DOCKER_MEM ?= 32g`. **Budget 32 GB.**
- **Running a node at `RAYON_NUM_THREADS=1`:** does **not** fit either. It
  reaches the same ~13.9 GB and dies, just an hour later. The setup's working
  set exceeds the ceiling regardless of parallelism, so thread count is not a
  lever here.
- **Conclusion:** the verifier-setup generation cannot complete under a
  13.34 GiB ceiling in any configuration found. The only shortcut is a
  seed cache produced on a larger machine and copied in; none is published.

## Off-site generation on a GitHub-hosted runner

The seed cache only has to be generated once, anywhere, so the job was moved to
a public-repository hosted runner (`.github/workflows/nmeme-seed-cache.yml`:
4 vCPU, 16 GB RAM, plus a 24 GB swapfile on the runner's `/mnt` disk).

| attempt | run | outcome |
|---|---|---|
| 1 | `34543165057` | builds fine (honk + kernels 9m44s, node 5m46s); generation started, then **exit 143 after 52 min** with "The runner has received a shutdown signal". No OOM line, no `%born`, nothing uploaded. |
| 2 | `34549887736` | node confined to a 13 GB cgroup with 27.6 GB of swap; runner stayed up and pushed progress every 5 min. The node logged "Generating the AI-PoW verifier-setup table (14 buckets)... about 15 minutes", then at 4 threads climbed to **11.6 GB resident + 26.6 GB swapped (38 GB) and was still rising when the swap ran out**, 69 min in. Killed; exit 1; no `%born`. |

Exit 143 is SIGTERM to the step, not an out-of-memory kill, and the job was at
68 minutes of a 350-minute budget. On a hosted runner this is the signature of
a VM starved of RAM: the node's working set exceeded physical memory, the
machine thrashed against swap, the runner agent stopped answering, and GitHub
reclaimed it. The 52 minutes (against a documented ~15) is consistent with
heavy swapping. Attempt 2 confines the node in its own cgroup
(`memory.max=13G`, swap unlimited) so that its excess goes to swap while the
runner keeps ~3 GB of real memory, and pushes RSS/swap samples plus the
node-log tail to a `seed-cache-progress` branch every five minutes so a
reclaimed VM still leaves evidence.

Attempt 2 is the first real measurement of the generation's working set, and
it is not 32 GB: past 38 GB at four proving threads. Attempt 3 (run
`34556716276`) sized swap from all the disk left after the build (77 GB) and
ran `RAYON_NUM_THREADS=1` and `=2` side by side. Both stayed alive for over
75 minutes at the 13 GB cap with 15 GB (one thread) and 35 GB (two threads)
swapped, and neither reached `%born` in that time: correct, but swap-bound.

## Generation one bucket per job

The node's generator is a plain loop over fourteen independent proofs
(`build_and_cache_verifier_setup_seeds`, `ai-pow-jets/src/setup.rs`), so
`nockmeme/seedgen/seedgen.rs`, built as an extra bin of `ai-pow-jets` against
the pinned checkout, proves ONE bucket per hosted-runner job and a merge job
concatenates the fourteen seed files in bucket order and checks the table
against `AI_POW_V0_VERIFIER_SETUP_TABLE_DIGEST` before publishing
(`.github/workflows/nmeme-seed-buckets.yml`). Measured, single-threaded:

| bucket | trace height | wall time | peak RSS | note |
|---|---|---|---|---|
| 0, 1 | 2^13 | 2.3 min | 3.5 GB | |
| 2, 3 | 2^14 | 3.5 min | 5.7 GB | |
| 4, 5 | 2^15 | 3.2 min | 4.0 GB | |
| 6, 7 | 2^16 | 4–5 min | 6.6 GB | |
| 8, 9 | 2^17 | 8 min | 12 GB + 1 GB swap | at the 12–13 GB cap |
| 10–13 | 2^18, 2^19 | — | >13.6 GB | see below |

Buckets 0–9 are cheap and reproducible: two runs, identical
`verifier_key_digest` per bucket, which is the proof-independence the table
digest relies on. The four largest buckets are the whole problem:

- Under a hard `memory.max=13G` they were **OOM-killed within a minute**: they
  allocate ~10 GB in the first fifteen seconds, faster than the kernel can
  swap out, so the cgroup killer fires with swap still free (run 1).
- Under `memory.high=12G` (throttle, never kill) they did not die, but sat at
  13.6 GB resident for forty minutes without logging a line. The progress
  branch showed 3 GB of swap, all used: that runner had the small-root
  layout (11 GB free on `/`, a separate 70 GB `/mnt`) and the job had sized
  swap from `/` alone (run 2). Run 4 takes swap from both disks and refuses
  to start with under 20 GB.

Runner sizes: a probe (`nmeme-runner-probe.yml`) asked for every documented
larger label. `macos-*-large` and `*-xlarge` are refused instantly for this
repository; `macos-latest` and `ubuntu-24.04-arm` are dispensed but are no
larger than the 16 GB standard runner. There is no bigger free machine, so
the four large buckets have to fit 16 GB of RAM plus swap.
