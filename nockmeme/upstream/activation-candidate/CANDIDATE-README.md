# NMEME consensus upgrade candidate

This package extends review pack 9's consensus fork with explicit activation and a legacy-claim cutoff. It does not activate an upgrade on public Nockchain. The normal node validation path defaults to **disabled**. No public activation height is assigned.

## Implemented changes

- A compile-time optional activation height in `hoon/common/nmeme-policy.hoon`. Both the AMM and token-claim enforcement switch at the same height. `~` means disabled, not height zero.
- Before activation, ordinary transactions retain the prior handling of arbitrary `meme` metadata. AMM covenant spends are refused.
- At and after activation, the existing covenant and token-conservation checks apply. Token input credit requires the note's origin to be at or after activation. Older claims cannot become pool funding merely by surviving the upgrade.
- Legacy claims may be discarded when spending their native NOCK. There is no automatic migration or grandfathering of old overlay token balances. Any migration needs a separately specified, verified issuance mechanism.
- The original five-field lock-check context is restored. Transaction context is passed through a separate `check-with-amm` entry point, preserving ordinary wallet/test callers.
- A Hoon assertion suite exercises disabled, H-1, H, H+1, historical reevaluation, legacy-claim rejection, partial burn, fresh genesis, and covenant activation.

## Contents and application

`consensus-upgrade.patch` is the complete patch against Nockchain revision `2bcb0b9dfd190f17252205afd1c8a067048a1ad9`, including pack 9's AMM changes.

`activation-on-pack9.patch` contains only this turn's additional changes. Apply this to a checkout that already has pack 9's `amm-covenant.patch`.

Use exactly one patch, according to the checkout's starting state. Do not apply both.

```bash
git checkout 2bcb0b9dfd190f17252205afd1c8a067048a1ad9
git apply --check /path/to/consensus-upgrade.patch
git apply /path/to/consensus-upgrade.patch
```

## Validation

See `VALIDATION.md` for actual executed checks and limitations. An added test is not a passed test until it has run. This package is a candidate, not a production release.

To compile and verify the Hoon assertions using the pinned workspace's honk compiler:

```bash
cargo build --release -p honk --bin honk
python3 /path/to/verify_assertions.py /path/to/nockchain
```

The verifier compiles in `--dynock` mode and requires the emitted formula to be exactly `[1 24]` after its quoted source-location hint. This establishes that all 24 assertions evaluated successfully. It refuses a deferred or different result; successful compilation alone is insufficient. Production validation additionally requires compiling the complete node/wallet kernels, running the native suites, historical-chain replay, and multi-node activation/reorganisation tests.

## What must happen before public activation

1. Network maintainers review the new rules, activation policy, legacy handling, and transaction/proof resource limits against the then-current node source.
2. Indexers and wallets adopt the same activation cutoff. Pack 9's indexer must not present legacy overlay claims as consensus-enforced tokens.
3. A network-specific test release pins a test activation height in `nmeme-policy.hoon`, builds the node, and demonstrates pre/post activation blocks and competing branches on multiple nodes.
4. A coordinated public release pins an agreed activation height. Node operators and miners adopt compatible software before that height. Old nodes will reject new covenant spends; this is a consensus upgrade, not a website deployment.
5. Only after activation and verification are native public-network pools opened.

Editing this file or running a modified node does not cause other network participants to adopt these rules. No maintainers were contacted, no public node was changed, and no public activation was scheduled by this work.

## Product scope

The existing AMM is a real-reserve constant-product pool requiring initial NOCK and tokens. The activation work does not implement a Pump.fun-style virtual-reserve launch curve, graduation, a browser wallet, a public API, a UI, or batching. One pool spend per block remains the current throughput constraint. Those features are separate from the consensus activation code.
