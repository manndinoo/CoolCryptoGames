# Independent verification records

Kept verbatim. Nothing here was written by the author of this package.

| Round | Verified against | Outcome |
| --- | --- | --- |
| [`round-7/`](./round-7/) | nockmeme7 (SHA-256 `683f606b…`) | 81 tests + 9 shell checks confirmed; **two bugs found** (fee undercount for Merkle paths; mining timeout ignoring the required height), each with a reproduction |
| [`round-8/`](./round-8/) | nockmeme8 (SHA-256 `839bcb87…`) | 88 tests + 15 shell checks confirmed with zero source modifications; both round-7 bugs verified fixed; no new findings; resolved `Cargo.lock` included |

Both rounds state explicitly that no live node was started and no on-chain
creation, transfer, or balance rebuild was demonstrated. Both disabled LTO for
the test build (`CARGO_PROFILE_DEV_LTO=false CARGO_PROFILE_TEST_LTO=false`);
the default-LTO build was not tested by them, and the link failure that
prompted the setting in round 7 has no established cause.
