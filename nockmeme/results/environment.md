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
| 1 | 5.73 GiB* | 43% | fits; ~4x slower (1 core at 100%) |

\* peak observed so far; the full sample series is in
`node-memory-1thread.tsv` (`elapsed_s`, `rss_kb`, `pct_of_limit`).

The 4-thread kill, from `dmesg`:

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
- **Running a node at `RAYON_NUM_THREADS=1`:** fits in well under 8 GB, at
  roughly 4x the setup time. Viable for testing; not a production configuration.
