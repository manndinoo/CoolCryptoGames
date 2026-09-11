# Mined token transactions on the fakenet chain (all of them)

Signed transaction files exactly as broadcast, named `h<height>-<kind>-<token
prefix>-<txid prefix>.jam`. These twelve are the complete token history of the
chain; `nmeme-index rebuild` binds each to its mined transaction by
recomputing the consensus transaction id.

| height | txid | kind | token |
|---|---|---|---|
| 21 | 6zQpdW5HmJpitmzaKH8fFAWpcG32jqCizpwD4AZ1dmaNgA3VkwCQUpt | genesis | Bto3jEqZW5tHcpNejJ752foBD5R4BnP3xzoRdaBy8CBXX5g1FSCo49d |
| 44 | CqnUQ22o7oxrKsx8NfcwHBv1GBbAtxbji4EAcvxEkAt6aPL8aLXP4qM | genesis | 3rVLmJh24HWy7NxusxAxHkHTCETJMCannDzpB7LkrULd4bt8j2qVnrj |
| 55 | 7dFCSs6EmbcK4w8n8Jv44JB1WBa76JBFtAQbD7vt6D72G1degNuvUuG | transfer | 3rVL… |
| 75 | CxfcXk3W3dAHAhZXGJjKKZ2FnZBW4JhgfU61Y2ju2RGB4duWipZfhBh | genesis | 4Fkt8tEVF5AfozYrCdF5F48vd7VNVektAwz5jLHkdq5eTY4XNzubkRU |
| 91 | Z8tvhDFP4SkuxcfCzkLpjorxryUF7jocdZB3HCPEeqjmokVqsC5Gi | transfer | 4Fkt… |
| 541 | 5JvtVdf28JmXm2EwSH6iHtHNHdFxAp5wWTe9bqXfrm4hcMANvt3Bueq | genesis (gated) | 9MZ3Bkv43bMEPY61vFTvhsCzaV2tz7vsqPAextmS7NY9QMoUe3aUhA6 |
| 571 | DTLxzKyj1Ak7Vn7i4aNM8EhavJMWkCr189HfCaE3UEtUg3Jzb4Tz2W8 | transfer (gated) | 9MZ3… |
| 600 | 2ZNQchM5FRvh3aZrmtQTqFyhWnxQrjwmzFD2GAF6W1sszbitwX86qbF | genesis (gated; its transfer was never sent, the run died on a full disk) | CP2ALNVoMbuxiEQSU7SmYoYZgVcGpcDWjZ1MSnHAaJoMmW92h8QcZyk |
| 640 | AzC1fW8YDgcd2J4w18RCKs1De83R5Ecj9WH4mk3LqAmK9Sq5wgv8EGC | genesis A (gated) | 8wcgLgFgaaMav68GtNzqqC2xinvFnDgwoB5cCYKEsyahee6ocwuKxh9 |
| 650 | 2XeMY77jqRUdWrt9ivRrmuAvm3UvCJ53hbNL5cpXRUSZocpG71Lb5mw | transfer A (gated) | 8wcg… |
| 685 | BojtQp3XEqAxXcb3vL7ZKBoX2xd4mSWjGT5MMjabnxLHE8CWHPYkCua | genesis B (gated) | 2vJT5B5jExdnWYhnuNfG7iFStTSLfj3KQkNSdqvaxXHEvgCxT3msShL |
| 712 | sQkkababRKDj3TuMbPJUraDVCYTpLy7iySstw5XQ8TLCPkZtTGH5dS | transfer B (gated) | 2vJT… |

"(gated)": every input chosen by name from a FUNDING proof and checked by
`nmeme-index check-inputs` before broadcast; the proofs are in
`../attempt6/`. The first five transactions predate the gate; their inputs'
provenance cannot be proven after the fact, so the guarded rebuild refuses
them (that refusal is the point).

Lock-roots: Alice `6Gn3zaAVYhto5qpVL84CpBQNGGokBxssUtZmw5879BESZVMdTmpEhfw`,
Bob `CyjTA9Bz6oiepyYL4L4kyk3KPAtJRipnxkNZ7oDZSeygrevcLocA7wV`.
