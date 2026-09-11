//! Pagination and snapshot consistency, without a node.

use nmeme_index::{collect_pages, fold_pages, require_same_snapshot, Page, MAX_PAGES};
use nockchain_types::tx_engine::common::{Hash, Name};

fn hash(n: u64) -> Hash {
    Hash::from_limbs(&[n, n + 1, n + 2, n + 3, n + 4])
}
fn note(n: u64) -> (Name, String, Vec<(String, Vec<u8>)>, u64) {
    (Name::new(hash(n), hash(n + 100)), "alice".to_string(), vec![], 0)
}
fn page(h: u64, b: &str, notes: Vec<u64>, next: &str) -> Page {
    Page {
        height: Some(h),
        block_id: Some(b.to_string()),
        notes: notes.into_iter().map(note).collect(),
        next_page_token: next.to_string(),
    }
}

#[test]
fn the_loop_follows_tokens_until_the_node_returns_an_empty_one() {
    let mut requested = Vec::new();
    let pages = collect_pages(|token| {
        requested.push(token.to_string());
        Ok(match token {
            "" => page(7, "B", vec![1, 2], "t1"),
            "t1" => page(7, "B", vec![3], "t2"),
            "t2" => page(7, "B", vec![4, 5], ""),
            other => return Err(format!("unexpected token {other}")),
        })
    })
    .expect("pages");
    assert_eq!(requested, vec!["", "t1", "t2"]);
    let snap = fold_pages(&pages).expect("snapshot");
    assert_eq!(snap.notes.len(), 5, "every page's notes are kept, not just the first");
}

#[test]
fn a_single_page_read_is_the_degenerate_case_not_a_shortcut() {
    let pages = collect_pages(|_| Ok(page(1, "A", vec![9], ""))).expect("pages");
    assert_eq!(pages.len(), 1);
}

#[test]
fn a_repeated_token_is_an_error_not_an_infinite_loop() {
    let err = collect_pages(|_| Ok(page(1, "A", vec![], "same"))).expect_err("must stop");
    assert!(err.contains("same page token") || err.contains("refusing"), "{err}");
}

#[test]
fn a_runaway_pager_is_bounded() {
    let mut n = 0usize;
    let err = collect_pages(|_| {
        n += 1;
        Ok(page(1, "A", vec![], &format!("t{n}")))
    })
    .expect_err("must stop");
    assert!(err.contains("refusing to loop forever"), "{err}");
    assert!(n <= MAX_PAGES + 1);
}

#[test]
fn pages_at_different_blocks_are_refused() {
    // Alice's page at height 7, Bob's at height 8: two different chains.
    let pages = vec![page(7, "B7", vec![1], ""), page(8, "B8", vec![2], "")];
    let err = fold_pages(&pages).expect_err("must refuse");
    assert!(err.contains("advanced mid-read"), "{err}");
}

#[test]
fn same_height_different_block_is_still_refused() {
    // A reorg at the tip keeps the height and changes the block.
    let pages = vec![page(7, "B7a", vec![1], ""), page(7, "B7b", vec![2], "")];
    assert!(fold_pages(&pages).is_err());
}

#[test]
fn a_page_without_a_block_id_cannot_anchor_a_snapshot() {
    let mut p = page(7, "B", vec![1], "");
    p.block_id = None;
    assert!(fold_pages(&[p]).is_err());
}

#[test]
fn bracketing_detects_a_tip_that_moved_during_transaction_reads() {
    let before = fold_pages(&[page(7, "B7", vec![1], "")]).expect("s");
    let same = fold_pages(&[page(7, "B7", vec![1], "")]).expect("s");
    let moved = fold_pages(&[page(8, "B8", vec![1], "")]).expect("s");
    require_same_snapshot(&before, &same).expect("unchanged is fine");
    let err = require_same_snapshot(&before, &moved).expect_err("moved must fail");
    assert!(err.contains("Rebuild discarded"), "{err}");
}
