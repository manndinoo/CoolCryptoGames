//! Tests for NMEME v0.
//!
//! These exercise the encoding against the real `OwnedBasedNoun` and the real
//! `Hash`/`Name` types from `nockchain-types`, not a stand-in. What they do not
//! do is prove anything about a live chain — that is the fakenet gate in
//! SPEC §12.

use nmeme_core::claim::MAX_DECIMALS;
use nmeme_core::indexer::{NoteView, Outcome, TxView};
use nmeme_core::ticker::MAX_TICKER_BYTES;
use nmeme_core::{Claim, Indexer, Ticker, TokenId};
use nockchain_types::tx_engine::common::{Hash as NockHash, Name};

fn hash(seed: u64) -> NockHash {
    NockHash::from_limbs(&[seed, seed + 1, seed + 2, seed + 3, seed + 4])
}

fn name(seed: u64) -> Name {
    Name::new(hash(seed), hash(seed + 100))
}

fn ticker() -> Ticker {
    Ticker::new("DOGE").expect("valid ticker")
}

// ---------------------------------------------------------------- ticker ---

#[test]
fn ticker_round_trips_through_limbs() {
    for raw in ["A", "DOGE", "PEPE2024", "ABCDEFG", "ABCDEFGH", "1234567890123456789012345678"] {
        let ticker = Ticker::new(raw).expect("valid");
        let limbs = ticker.limbs();
        assert_eq!(Ticker::from_limbs(&limbs).expect("round trip"), ticker, "{raw}");
    }
}

#[test]
fn every_ticker_limb_is_a_field_element() {
    // The whole reason tickers are limbed: an 8-byte cord can exceed the field
    // prime and be rejected by `based` at validation time (FINDINGS §5).
    let ticker = Ticker::new(&"Z".repeat(MAX_TICKER_BYTES)).expect("valid");
    for limb in ticker.limbs() {
        assert!(nockchain_math::belt::based_check(limb), "limb {limb} not based");
    }
    // And the payload as a whole must encode.
    ticker.to_noun().expect("ticker encodes");
}

#[test]
fn ticker_limbs_with_a_zero_byte_below_a_letter_are_refused() {
    // 0x41_00_42: bytes [0x42, 0x00, 0x41]. Consensus reads every
    // significant byte and refuses the zero; the decoder used to stop at
    // the zero and read "B", which would have made the two sides disagree.
    assert!(Ticker::from_limbs(&[0x41_00_42]).is_err());
    // a short limb that is not the last one
    assert!(Ticker::from_limbs(&[0x41, 0x42]).is_err());
    // a lowercase byte, an eight-byte limb, five limbs
    assert!(Ticker::from_limbs(&[0x61]).is_err());
    assert!(Ticker::from_limbs(&[0x4141414141414141]).is_err());
    assert!(Ticker::from_limbs(&[0x41414141414141; 5]).is_err());
    assert_eq!(Ticker::from_limbs(&[0x41414141414141, 0x42]).unwrap().as_str(), "AAAAAAAB");
}

#[test]
fn ticker_rejects_bad_input() {
    assert!(Ticker::new("").is_err());
    assert!(Ticker::new("doge").is_err(), "lowercase would render as a distinct token");
    assert!(Ticker::new("DO GE").is_err());
    assert!(Ticker::new(&"A".repeat(MAX_TICKER_BYTES + 1)).is_err());
}

// ----------------------------------------------------------------- claim ---

#[test]
fn genesis_claim_round_trips() {
    let claim = Claim::Genesis {
        ticker: ticker(),
        decimals: 6,
        amount: 1_000_000,
        token: TokenId(hash(7)),
    };
    let noun = claim.to_noun().expect("encodes");
    assert_eq!(Claim::from_noun(&noun).expect("decodes"), claim);
}

#[test]
fn transfer_claim_round_trips() {
    let token = TokenId(hash(42));
    let claim = Claim::Transfer {
        token: token.clone(),
        amount: 999_900,
    };
    let noun = claim.to_noun().expect("encodes");
    let decoded = Claim::from_noun(&noun).expect("decodes");
    assert_eq!(decoded, claim);
    match decoded {
        Claim::Transfer { token: t, .. } => assert_eq!(t, token),
        Claim::Genesis { .. } => panic!("wrong variant"),
    }
}

#[test]
fn claim_rejects_zero_and_oversized_values() {
    assert!(Claim::Transfer { token: TokenId(hash(1)), amount: 0 }.to_noun().is_err());
    assert!(Claim::Genesis { ticker: ticker(), decimals: MAX_DECIMALS + 1, amount: 1, token: TokenId(hash(1)) }
        .to_noun()
        .is_err());
    // Not a field element.
    assert!(Claim::Transfer { token: TokenId(hash(1)), amount: u64::MAX }.to_noun().is_err());
}

// -------------------------------------------------------------- token id ---

#[test]
fn token_id_is_independent_of_input_ordering() {
    let a = [name(1), name(2), name(3)];
    let b = [name(3), name(1), name(2)];
    assert_eq!(
        TokenId::derive(&a, &ticker(), 6).expect("derives"),
        TokenId::derive(&b, &ticker(), 6).expect("derives"),
    );
}

#[test]
fn token_id_separates_same_ticker_from_different_anchors() {
    // Anyone may reuse a ticker; it must not collide with, or inflate, the
    // original token (SPEC §4).
    let first = TokenId::derive(&[name(1)], &ticker(), 6).expect("derives");
    let second = TokenId::derive(&[name(2)], &ticker(), 6).expect("derives");
    assert_ne!(first, second);
}

#[test]
fn token_id_binds_ticker_and_decimals() {
    let base = TokenId::derive(&[name(1)], &ticker(), 6).expect("derives");
    let other_ticker =
        TokenId::derive(&[name(1)], &Ticker::new("SHIB").expect("valid"), 6).expect("derives");
    let other_decimals = TokenId::derive(&[name(1)], &ticker(), 8).expect("derives");
    assert_ne!(base, other_ticker);
    assert_ne!(base, other_decimals);
}

#[test]
fn token_id_noun_round_trips() {
    let token = TokenId::derive(&[name(7)], &ticker(), 6).expect("derives");
    assert_eq!(TokenId::from_noun(&token.to_noun()).expect("decodes"), token);
}

// --------------------------------------------------------------- indexer ---

const SUPPLY: u64 = 1_000_000;

/// Alice's lock-root, Bob's lock-root.
fn alice() -> NockHash {
    hash(1000)
}
fn bob() -> NockHash {
    hash(2000)
}

fn genesis_tx() -> (TxView, TokenId) {
    let inputs = vec![name(1)];
    let token = TokenId::derive(&inputs, &ticker(), 6).expect("derives");
    let tx = TxView {
        id: hash(500),
        inputs,
        outputs: vec![NoteView {
            name: name(10),
            lock_root: alice(),
            claim: Some(Claim::Genesis {
                ticker: ticker(),
                decimals: 6,
                amount: SUPPLY,
                token: token.clone(),
            }),
        }],
    };
    (tx, token)
}

#[test]
fn genesis_creates_fixed_supply() {
    let (tx, token) = genesis_tx();
    let mut indexer = Indexer::new();
    assert_eq!(indexer.apply(&tx), Outcome::Created(token.clone()));
    assert_eq!(indexer.circulating(&token), SUPPLY);
    assert_eq!(indexer.token(&token).expect("registered").supply, SUPPLY);
    assert_eq!(
        indexer.balances(&token).get(&alice().to_be_bytes().to_vec()).copied(),
        Some(SUPPLY)
    );
}

fn transfer_tx(token: &TokenId) -> TxView {
    TxView {
        id: hash(600),
        inputs: vec![name(10)],
        outputs: vec![
            NoteView {
                name: name(20),
                lock_root: alice(),
                claim: Some(Claim::Transfer { token: token.clone(), amount: SUPPLY - 100 }),
            },
            NoteView {
                name: name(30),
                lock_root: bob(),
                claim: Some(Claim::Transfer { token: token.clone(), amount: 100 }),
            },
        ],
    }
}

#[test]
fn transfer_splits_and_conserves() {
    let (genesis, token) = genesis_tx();
    let mut indexer = Indexer::new();
    indexer.apply(&genesis);
    assert_eq!(indexer.apply(&transfer_tx(&token)), Outcome::Transferred(token.clone()));

    let balances = indexer.balances(&token);
    assert_eq!(balances.get(&alice().to_be_bytes().to_vec()).copied(), Some(SUPPLY - 100));
    assert_eq!(balances.get(&bob().to_be_bytes().to_vec()).copied(), Some(100));
    assert_eq!(indexer.circulating(&token), SUPPLY);
}

#[test]
fn non_conserving_transfer_burns_everything() {
    let (genesis, token) = genesis_tx();
    let mut indexer = Indexer::new();
    indexer.apply(&genesis);

    let mut tx = transfer_tx(&token);
    tx.outputs[0].claim = Some(Claim::Transfer { token: token.clone(), amount: SUPPLY });
    // SUPPLY + 100 claimed against SUPPLY consumed.
    assert!(matches!(indexer.apply(&tx), Outcome::Burned { units, .. } if units == SUPPLY));
    assert_eq!(indexer.circulating(&token), 0);
}

#[test]
fn spending_with_a_token_unaware_wallet_burns() {
    // The single most important user-facing consequence of SPEC §7: an ordinary
    // wallet that spends a coloured note without reattaching a claim destroys
    // the tokens. This test exists so that behaviour is pinned, not discovered.
    let (genesis, token) = genesis_tx();
    let mut indexer = Indexer::new();
    indexer.apply(&genesis);

    let plain_spend = TxView {
        id: hash(700),
        inputs: vec![name(10)],
        outputs: vec![NoteView { name: name(40), lock_root: bob(), claim: None }],
    };
    assert!(matches!(indexer.apply(&plain_spend), Outcome::Burned { units, .. } if units == SUPPLY));
    assert_eq!(indexer.circulating(&token), 0);
}

#[test]
fn genesis_cannot_consume_existing_token_weight() {
    let (genesis, token) = genesis_tx();
    let mut indexer = Indexer::new();
    indexer.apply(&genesis);

    // Try to "re-create" while spending the existing coloured note.
    let inputs = vec![name(10)];
    let regenesis = TxView {
        id: hash(800),
        inputs,
        outputs: vec![NoteView {
            name: name(50),
            lock_root: bob(),
            claim: Some(Claim::Genesis { ticker: ticker(), decimals: 6, amount: SUPPLY * 2, token: TokenId::derive(&[name(10)], &ticker(), 6).expect("derives") }),
        }],
    };
    assert!(matches!(indexer.apply(&regenesis), Outcome::Burned { .. }));
    assert_eq!(indexer.circulating(&token), 0, "no inflation");
}

#[test]
fn omitting_history_turns_a_burn_into_a_creation() {
    // The same genesis, judged with and without the history that coloured
    // its input. Seen live on the fakenet chain (height 44): the two-step
    // rebuild said Created, the full replay said Burned. The indexer cannot
    // know what it was not shown, so the rebuild tool proves each input's
    // provenance first (nmeme-index `require_provenance`).
    let (genesis, _token) = genesis_tx();
    let regenesis = TxView {
        id: hash(801),
        inputs: vec![name(10)],
        outputs: vec![NoteView {
            name: name(51),
            lock_root: bob(),
            claim: Some(Claim::Genesis { ticker: ticker(), decimals: 6, amount: SUPPLY, token: TokenId::derive(&[name(10)], &ticker(), 6).expect("derives") }),
        }],
    };

    let mut full = Indexer::new();
    full.apply(&genesis);
    assert!(matches!(full.apply(&regenesis), Outcome::Burned { .. }), "with history: a burn");

    let mut partial = Indexer::new();
    assert!(
        matches!(partial.apply(&regenesis), Outcome::Created(_)),
        "without history: the same transaction looks like a valid creation"
    );
}

#[test]
fn claiming_a_token_never_consumed_mints_nothing() {
    let mut indexer = Indexer::new();
    let forged = TxView {
        id: hash(900),
        inputs: vec![name(1)],
        outputs: vec![NoteView {
            name: name(60),
            lock_root: bob(),
            claim: Some(Claim::Transfer { token: TokenId(hash(12345)), amount: 5_000 }),
        }],
    };
    assert_eq!(indexer.apply(&forged), Outcome::Untouched);
    assert_eq!(indexer.circulating(&TokenId(hash(12345))), 0);
}

#[test]
fn one_claim_per_lock_root_after_merging() {
    // Consensus merges seeds sharing a lock-root into a single note and unions
    // their note-data (FINDINGS §3). A builder that emitted two claims for the
    // same recipient would have one silently overwrite the other, so by the
    // time the indexer sees the transaction there is exactly one note and one
    // claim for that recipient. The correct build is a single summed claim.
    let (genesis, token) = genesis_tx();
    let mut indexer = Indexer::new();
    indexer.apply(&genesis);

    let merged = TxView {
        id: hash(1100),
        inputs: vec![name(10)],
        outputs: vec![
            NoteView {
                name: name(70),
                lock_root: bob(),
                // 400 + 600 summed into one claim on one merged note.
                claim: Some(Claim::Transfer { token: token.clone(), amount: 1_000 }),
            },
            NoteView {
                name: name(71),
                lock_root: alice(),
                claim: Some(Claim::Transfer { token: token.clone(), amount: SUPPLY - 1_000 }),
            },
        ],
    };
    assert_eq!(indexer.apply(&merged), Outcome::Transferred(token.clone()));
    assert_eq!(indexer.balances(&token).get(&bob().to_be_bytes().to_vec()).copied(), Some(1_000));
    assert_eq!(indexer.circulating(&token), SUPPLY);
}

#[test]
fn a_transaction_may_carry_several_tokens_each_accounted_on_its_own() {
    // The consensus rule is per token id: a transaction consuming A and B
    // and claiming both carries both on; claiming more of A than went in is
    // refused by a node carrying the rule, and burns A on a chain without it.
    let (genesis_a, token_a) = genesis_tx();
    let mut indexer = Indexer::new();
    indexer.apply(&genesis_a);

    let inputs_b = vec![name(2)];
    let token_b = TokenId::derive(&inputs_b, &Ticker::new("SHIB").expect("valid"), 6)
        .expect("derives");
    indexer.apply(&TxView {
        id: hash(1200),
        inputs: inputs_b,
        outputs: vec![NoteView {
            name: name(80),
            lock_root: alice(),
            claim: Some(Claim::Genesis {
                ticker: Ticker::new("SHIB").expect("valid"),
                decimals: 6,
                amount: 500,
                token: token_b.clone(),
            }),
        }],
    });

    // both tokens spent, both carried on: A to bob, B stays with alice
    let both = TxView {
        id: hash(1300),
        inputs: vec![name(10), name(80)],
        outputs: vec![
            NoteView {
                name: name(90),
                lock_root: bob(),
                claim: Some(Claim::Transfer { token: token_a.clone(), amount: SUPPLY }),
            },
            NoteView {
                name: name(91),
                lock_root: alice(),
                claim: Some(Claim::Transfer { token: token_b.clone(), amount: 500 }),
            },
        ],
    };
    let outcome = indexer.apply(&both);
    let Outcome::Settled(effects) = outcome else { panic!("expected per-token effects, got {outcome:?}") };
    assert_eq!(effects.len(), 2);
    assert!(effects.iter().all(|e| e.burned == 0));
    assert_eq!(indexer.circulating(&token_a), SUPPLY);
    assert_eq!(indexer.circulating(&token_b), 500);
    assert_eq!(indexer.balances(&token_a).get(&bob().to_be_bytes().to_vec()).copied(), Some(SUPPLY));

    // more of A claimed than went in: A is destroyed, B (no claim) too
    let over = TxView {
        id: hash(1301),
        inputs: vec![name(90), name(91)],
        outputs: vec![NoteView {
            name: name(92),
            lock_root: bob(),
            claim: Some(Claim::Transfer { token: token_a.clone(), amount: SUPPLY + 500 }),
        }],
    };
    assert!(matches!(indexer.apply(&over), Outcome::Burned { .. }));
    assert_eq!(indexer.circulating(&token_a), 0);
    assert_eq!(indexer.circulating(&token_b), 0);
}

#[test]
fn a_shortfall_is_a_partial_burn_and_the_rest_carries_on() {
    // Spending 100 and claiming 99 passes the rule (outputs <= inputs): the
    // 99 are a holding, the 1 is destroyed. Node and indexer agree; before
    // this the indexer wrote off all 100 (review of pack 5).
    let (genesis, token) = genesis_tx();
    let mut indexer = Indexer::new();
    indexer.apply(&genesis);
    indexer.apply(&transfer_tx(&token)); // bob holds 100 at name(30)

    let short = TxView {
        id: hash(1400),
        inputs: vec![name(30)],
        outputs: vec![NoteView {
            name: name(95),
            lock_root: bob(),
            claim: Some(Claim::Transfer { token: token.clone(), amount: 99 }),
        }],
    };
    let outcome = indexer.apply(&short);
    assert_eq!(
        outcome,
        Outcome::Settled(vec![nmeme_core::Effect { token: token.clone(), transferred: 99, burned: 1 }])
    );
    assert_eq!(indexer.balances(&token).get(&bob().to_be_bytes().to_vec()).copied(), Some(99));
    assert_eq!(indexer.circulating(&token), SUPPLY - 1);

    // and the 99 spend on as an ordinary, exactly conserving transfer
    let on = TxView {
        id: hash(1401),
        inputs: vec![name(95)],
        outputs: vec![NoteView {
            name: name(96),
            lock_root: alice(),
            claim: Some(Claim::Transfer { token: token.clone(), amount: 99 }),
        }],
    };
    assert_eq!(indexer.apply(&on), Outcome::Transferred(token.clone()));
    assert_eq!(indexer.circulating(&token), SUPPLY - 1);
}

#[test]
fn reorg_rebuilds_from_replacement_history() {
    let (genesis, token) = genesis_tx();
    let transfer = transfer_tx(&token);

    let with_transfer = Indexer::replay(&[genesis.clone(), transfer]);
    assert_eq!(
        with_transfer.balances(&token).get(&bob().to_be_bytes().to_vec()).copied(),
        Some(100)
    );

    // The replacement history drops the transfer entirely.
    let without_transfer = Indexer::replay(&[genesis]);
    assert_eq!(without_transfer.balances(&token).get(&bob().to_be_bytes().to_vec()), None);
    assert_eq!(
        without_transfer.balances(&token).get(&alice().to_be_bytes().to_vec()).copied(),
        Some(SUPPLY)
    );
}

#[test]
fn replay_is_deterministic() {
    // Note what this does and does not show: the same implementation run twice
    // agrees. That is determinism, not independent verification (SPEC §8).
    let (genesis, token) = genesis_tx();
    let history = [genesis, transfer_tx(&token)];
    let first = Indexer::replay(&history);
    let second = Indexer::replay(&history);
    assert_eq!(first.balances(&token), second.balances(&token));
    assert_eq!(first.audit(), second.audit());
}

#[test]
fn supply_is_conserved_across_a_long_chain_of_transfers() {
    let (genesis, token) = genesis_tx();
    let mut indexer = Indexer::new();
    indexer.apply(&genesis);

    let mut held = name(10);
    let mut remaining = SUPPLY;
    for round in 0..200u64 {
        let send = 7 + (round % 13);
        remaining -= send;
        let change = name(10_000 + round * 2);
        let out = name(10_001 + round * 2);
        let tx = TxView {
            id: hash(20_000 + round),
            inputs: vec![held.clone()],
            outputs: vec![
                NoteView {
                    name: change.clone(),
                    lock_root: alice(),
                    claim: Some(Claim::Transfer { token: token.clone(), amount: remaining }),
                },
                NoteView {
                    name: out,
                    lock_root: hash(30_000 + round),
                    claim: Some(Claim::Transfer { token: token.clone(), amount: send }),
                },
            ],
        };
        assert_eq!(indexer.apply(&tx), Outcome::Transferred(token.clone()));
        assert_eq!(indexer.circulating(&token), SUPPLY, "conservation broke at round {round}");
        held = change;
    }
}

// ------------------------------------------------------------- overflow ---
//
// Amounts are bounded by the field prime (~1.845e19), which sits just below
// u64::MAX (~1.845e19). Two valid amounts can therefore sum past u64::MAX.
// Unchecked accumulation would wrap, and a wrapped sum can be made to satisfy
// the conservation check while handing out arbitrary weight. These tests pin
// that it cannot.

#[test]
fn wrapped_claim_sum_cannot_mint() {
    // The attack: consume one unit, then claim two outputs whose amounts sum to
    // 2^64 + 1. Under wrapping arithmetic that totals 1, matching the single
    // consumed unit, and the transfer would be accepted — turning 1 unit into
    // roughly 1.8e19.
    let inputs = vec![name(1)];
    let token = TokenId::derive(&inputs, &ticker(), 6).expect("derives");
    let mut indexer = Indexer::new();
    indexer.apply(&TxView {
        id: hash(500),
        inputs,
        outputs: vec![NoteView {
            name: name(10),
            lock_root: alice(),
            claim: Some(Claim::Genesis { ticker: ticker(), decimals: 6, amount: 1, token: token.clone() }),
        }],
    });
    assert_eq!(indexer.circulating(&token), 1);

    let attack = TxView {
        id: hash(600),
        inputs: vec![name(10)],
        outputs: vec![
            NoteView {
                name: name(20),
                lock_root: bob(),
                claim: Some(Claim::Transfer { token: token.clone(), amount: 1u64 << 63 }),
            },
            NoteView {
                name: name(21),
                lock_root: bob(),
                claim: Some(Claim::Transfer { token: token.clone(), amount: (1u64 << 63) + 1 }),
            },
        ],
    };
    // Must not mint, and must not panic.
    assert!(matches!(indexer.apply(&attack), Outcome::Burned { .. }));
    assert_eq!(indexer.circulating(&token), 0, "overflow must never mint");
}

#[test]
fn wrapped_genesis_supply_cannot_understate_holdings() {
    // Two genesis claims of 2^63 sum to exactly 2^64, which wraps to 0. A
    // wrapped supply would register a token whose recorded supply is unrelated
    // to the weight actually handed out.
    let inputs = vec![name(1)];
    let token = TokenId::derive(&inputs, &ticker(), 6).expect("derives");
    let mut indexer = Indexer::new();
    let outcome = indexer.apply(&TxView {
        id: hash(700),
        inputs,
        outputs: vec![
            NoteView {
                name: name(30),
                lock_root: alice(),
                claim: Some(Claim::Genesis { ticker: ticker(), decimals: 6, amount: 1u64 << 63, token: token.clone() }),
            },
            NoteView {
                name: name(31),
                lock_root: bob(),
                claim: Some(Claim::Genesis { ticker: ticker(), decimals: 6, amount: 1u64 << 63, token: token.clone() }),
            },
        ],
    });
    assert_eq!(outcome, Outcome::Untouched, "genesis over the supply cap is rejected");
    assert!(indexer.token(&token).is_none());
    assert_eq!(indexer.circulating(&token), 0);
}

#[test]
fn amounts_above_the_supply_cap_are_rejected_at_the_codec() {
    use nmeme_core::claim::MAX_SUPPLY;
    let over = Claim::Transfer { token: TokenId(hash(1)), amount: MAX_SUPPLY + 1 };
    assert!(over.to_noun().is_err(), "amount above MAX_SUPPLY must not encode");

    let at_cap = Claim::Transfer { token: TokenId(hash(1)), amount: MAX_SUPPLY };
    let noun = at_cap.to_noun().expect("cap itself is valid");
    assert_eq!(Claim::from_noun(&noun).expect("decodes"), at_cap);
}

#[test]
fn two_capped_amounts_cannot_overflow_a_u64() {
    // The cap is chosen so any pair of valid amounts sums without wrapping;
    // checked arithmetic covers sums of more than two.
    use nmeme_core::claim::MAX_SUPPLY;
    assert!(MAX_SUPPLY.checked_add(MAX_SUPPLY).is_some());
}

#[test]
fn many_capped_claims_cannot_overflow_the_indexer() {
    // Sixteen outputs each at the cap sum far past u64::MAX. The transfer must
    // be rejected rather than wrapping or panicking.
    use nmeme_core::claim::MAX_SUPPLY;
    let inputs = vec![name(1)];
    let token = TokenId::derive(&inputs, &ticker(), 6).expect("derives");
    let mut indexer = Indexer::new();
    indexer.apply(&TxView {
        id: hash(800),
        inputs,
        outputs: vec![NoteView {
            name: name(40),
            lock_root: alice(),
            claim: Some(Claim::Genesis { ticker: ticker(), decimals: 6, amount: 1_000, token: token.clone() }),
        }],
    });

    let outputs = (0..16u64)
        .map(|i| NoteView {
            name: name(50_000 + i),
            lock_root: hash(60_000 + i),
            claim: Some(Claim::Transfer { token: token.clone(), amount: MAX_SUPPLY }),
        })
        .collect();
    let attack = TxView { id: hash(900), inputs: vec![name(40)], outputs };
    assert!(matches!(indexer.apply(&attack), Outcome::Burned { .. }));
    assert_eq!(indexer.circulating(&token), 0);
}
