# Independent verification of nockmeme7.zip

Verdict: the supplied offline suite passes with a build-setting workaround, but two additional checks expose bugs. This is not a full live-chain acceptance pass.

## Inputs and integrity
- Archive SHA-256: 683f606bfd0b9f2d6c9d29cf9f5370f8084e67602704d7b0c130baf4e326b908
- Nockchain revision: 2bcb0b9dfd190f17252205afd1c8a067048a1ad9
- Toolchain: nightly-2026-04-03, x86_64 Linux.
- All 27 uploaded Rust crate files were compared with the isolated test copy: zero modifications.
- Workspace membership and Cargo.lock were extended to include the three nmeme crates. One independent test was added separately.

## Executed results
| Check | Result |
|---|---|
| nmeme-core supplied tests | 26 passed |
| nmeme-index supplied tests | 22 passed |
| nmeme-tx supplied tests | 33 passed |
| Supplied Rust suite total | 81 passed, 0 failed |
| Signature decision shell checks | 9 passed |
| All six shell scripts, bash -n | Passed |
| Independent fee proof regression | FAILED: 56 words counted, 61 expected |
| Independent mining-height reproduction | BUG reproduced: proceeded at height 1 with minimum 3 |

The default workspace build failed at linking (including undefined main and Rust runtime symbols). Retrying with CARGO_PROFILE_DEV_LTO=false and CARGO_PROFILE_TEST_LTO=false succeeded. Optimization level 3 and the upstream disabled overflow checks remained in effect. Do not represent this as a successful default-profile build. The cause of the link failure has not been established.

The first successful build/test command stopped at the added failing regression. A second command skipped only that added test so every supplied test could run; it exited 0. The independently failing test is explicitly retained in this report.

## Fix 1: fee undercount for Merkle proofs
Location: crates/nmeme-tx/src/fee.rs, required_fee.

The code reads the actual witness but passes spend_condition_count: None to Nockchain's WordCountEstimator. None assumes a single-condition lock and therefore no sibling path. The package's own synthetic fee fixture carries one sibling. An independent comparison against the same upstream estimator, with the correct two-condition hint, reports 56 versus 61 witness words.

At the fakenet rate of 128/4 this difference is 160 nicks, when the minimum-fee floor is not binding. A transaction near the reported minimum can pass local enforcement while still being underfunded. A simple zero-sibling lock is outside this reproduced case.

Requested fix: account for the actual Merkle proof path and witness form, or reject unsupported shapes explicitly. Add an expected-value test independent of required_fee itself. Do not hard-code a two-condition count for every transaction.

Reproduce after copying independent_fee_path.rs into crates/nmeme-tx/tests:
    CARGO_PROFILE_DEV_LTO=false CARGO_PROFILE_TEST_LTO=false cargo test -p nmeme-tx --test independent_fee_path -- --nocapture

## Fix 2: mining timeout ignores the required height
Location: scripts/live-demo.sh, stage 2 after the mining loop.

The loop waits for MIN_HEIGHT, but its post-loop check only requires HEIGHT to be nonempty. The included reproduction uses the exact loop from the upload and mocks the wait; a node log containing height 1 proceeds successfully even when MIN_HEIGHT=3 and the deadline expires.

Requested fix: require both a parsed height and HEIGHT >= MIN_HEIGHT after the loop. Exit with a clear timeout error otherwise. Test no blocks, a below-threshold height, and a threshold-reaching height.

Run:
    bash independent-height-gate.sh
Current output:
    height=1
    BUG REPRODUCED: proceeded below MIN_HEIGHT=3

## Coverage limits
- No live node, mined token creation, signed transfer, or canonical on-chain balance rebuild was executed in this verification.
- The supplied fixture test explicitly reports zero signatures across five fixtures. Its pass is not wallet signature verification.
- No separate --release rerun was performed; the executed upstream test profile was already optimized with overflow checks disabled, with LTO disabled for the retry.
- CLI binaries were built by cargo test, but a separate end-to-end CLI transaction smoke was not run.
- This is not a mainnet readiness or performance certification.

## Supplied-suite command
Within the pinned Nockchain workspace with the nmeme crates linked:
    CARGO_PROFILE_DEV_LTO=false CARGO_PROFILE_TEST_LTO=false cargo test -p nmeme-core -p nmeme-tx -p nmeme-index -- --nocapture --skip fee_must_include_the_supplied_merkle_path

The --skip applies solely to the additional regression included here, not any original test. Logs include its separate failure.

