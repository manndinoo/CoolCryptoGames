# Fakenet state bundle (2026-09-11, chain at height 737)

PRIVATE: wallet-keys/ holds the exported private keys of the two fakenet
wallets (Alice, who holds every token; Bob). The chain is a private
single-node fakenet; the keys control nothing on mainnet.

- node-state-h737.tar.gz   the node's data/pma, data/checkpoints and event
                           log at height 737. Restore: extract into the node's
                           data dir next to an installed ai-pow/ seed cache
                           (RUNBOOK.md step 5), start with node-lowmem.sh.
- wallet-keys/             nockchain-wallet `export-keys` output for both
                           wallets; restore with `import-keys --file`.
- txs/                     all twelve signed token transactions, as broadcast,
                           named h<height>-<kind>-<token>-<txid>.jam, with an
                           index (README.md).
- alice-txs/               the wallet's own unsigned/pre-attachment .tx files.

Token balances at height 737 (rebuilt with provenance proven):
  A 8wcgLgFg… (DOGE): Alice 999,900 / Bob 100     B 2vJT5B5j… (PEPE): Alice 999,900 / Bob 100
Earlier tokens: 4Fkt… (999,900 / 100, pre-guard), CP2A… (genesis only),
9MZ3… (999,900 / 100, gated partial run), Bto3… (burned), 3rVL… (never created).

Reassemble: cat node-state-h737.tar.gz.part* > node-state-h737.tar.gz && sha256sum -c SHA256SUMS
