# Validation — 12 September 2026

## Passed in this workspace

- Built `honk` from the pinned workspace with Rust nightly 2026-04-03, release LTO disabled, two Cargo build jobs, and a local system-allocator workaround described below.
- The modified `tx-engine-1.hoon`, policy module, and assertion module compiled with honk's default vet checking enabled.
- All 24 assertions evaluated successfully. `--dynock` compilation emitted a 64-byte artifact whose executable formula, after its quoted source-location hint, is exactly `[1 24]`. The assertion entry checks the list length and requires every element to be true before returning 24.
- `verify_assertions.py --check-jam activation-result.jam` independently decodes and checks this result. It rejects deferred formulas and unexpected hints. Compilation success alone is not treated as a passing test.
- `git diff --check` passed.
- Both full and incremental patches applied in the appropriate disposable checkout and reproduced every intended changed file byte-for-byte. No compiler allocator change is included.

The assertion source received a comment-only correction after this run explaining that emitted-result verification is required. Its executable code is unchanged.

## Coverage

The 24 assertions cover activation disabled, H-1/H/H+1, origin cutoffs, future-origin credit rejection, arbitrary pre-activation metadata, malformed post-activation output claims, rejection of legacy token credit, spending legacy notes after stripping token metadata, conservation, inflation rejection, partial burn, fresh genesis, covenant activation, legacy pool rejection, reevaluation of earlier heights, and ordinary native NOCK spends.

These invoke the real `validate-at-phase:spends` implementation with synthetic notes and spends. They do not constitute a mined multi-node network demonstration. The distribution policy remains disabled; the tests explicitly supply height 100 as a test activation boundary.

## Build issues and resolution

The initial release build encountered invalid cached `syn` metadata. Cleaning that package resolved that stage. Subsequent links failed on missing `_rjem_je_*` symbols even after rebuilding jemalloc. For the validation compiler only, the `#[global_allocator]` Jemalloc declaration in `crates/honk/src/bin/honk.rs` was temporarily removed, selecting Rust's system allocator. The compiler then built successfully. That source file was restored before generating either patch.

The first assertion invocation used standard kernel output mode, which expects a different entry shape and failed while constructing its output trap. Arbitrary mode subsequently compiled, but stores a deferred output. The final validation uses dynock mode and checks the reduced formula directly. The included verifier uses this final command.

## Not established by this work

- No public Nockchain activation, node deployment, miner adoption, or maintainers' approval.
- No full node/wallet kernel build, historical chain replay, live pool trade, multi-node activation or reorganisation run for this candidate.
- No new run of pack 9's Rust/Python/shell suites. Prior pack results do not validate this patch automatically.
- No proof resource-limit audit or production capacity result.
- No updated wallet/indexer enforcement of the legacy cutoff. Those clients must be aligned before release.
- No Pump.fun bonding curve/graduation or finished browser trading product.

This is a tested transaction-engine upgrade candidate for further integration, not evidence that the public-network product is ready.
