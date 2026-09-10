# nockmeme8 independent verification

## Result
88 Rust tests passed, 0 failed. Both previously reported bugs are fixed in this version. 15 shell checks passed (9 signature-gate checks and 6 mining-height checks). All eight shell scripts passed bash syntax validation.

## Scope and provenance
Reviewed nockmeme8.zip, SHA-256 839bcb872627ddc19d1a4e8368531be476c39d94ea7b35c1bcaf61f9bbbdb1a1.
Tested its three crates without modifying their source, inside an isolated worktree of Nockchain revision 2bcb0b9dfd190f17252205afd1c8a067048a1ad9. Byte comparisons of all three crate directories passed.
The prior nockmeme7 archive was unavailable locally; this verifies the previously identified defects and current package, rather than claiming a complete archive-to-archive diff.

## Fixes verified
1. Fee accounting now includes the supplied Merkle path for full and stub proofs, deriving the estimator condition count as 2^path_length. Unsupported depths greater than four are rejected. The original independent Rust regression was retained byte-for-byte and now passes. Six additional tests cover supported depths, unchanged zero-depth behavior, the five-word cost per sibling, the 160-nick fakenet difference, and unsupported-depth rejection.
2. The live demo now calls wait_for_height and aborts if the required height is not reached before timeout. The six shell regression checks cover no blocks, insufficient heights, sufficient heights, and selecting the latest log entry.

## Test environment
Linux x86_64; rustc 1.96.0-nightly (55e86c996 2026-04-02), toolchain nightly-2026-04-03.
Locally installed build dependencies: cmake 4.4.3, ninja 1.13.2, libclang 18.1.1, protoc-wheel 21.1.
CARGO_BUILD_JOBS=4
CARGO_PROFILE_TEST_LTO=false
CARGO_PROFILE_DEV_LTO=false
cargo test -p nmeme-core -p nmeme-tx -p nmeme-index -- --nocapture

The optimized test build completed in 6m 37s. LTO was disabled to use the configuration that worked in the previous independent verification. The default LTO build and a separate release-profile run were not tested this time. The resolved Cargo.lock is included for reproducibility.

## Remaining acceptance work
These are offline checks. No live node was started during this verification. A successful on-chain token creation or transfer has not been demonstrated by this run or by the uploaded results. The upload records prior node-setup failures under a 13.34 GiB memory limit.
The next acceptance test remains: complete node startup, validate the signing hash against the wallet, mine a creation and a transfer, and independently reconstruct the expected token balances from the chain, with transaction IDs and block heights as evidence.
This review does not establish mainnet readiness or constitute a comprehensive security audit. Trading remains a design in the uploaded package.
