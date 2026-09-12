//! Decoding NMEME claims out of chain data.
//!
//! Split from the binary so the decode path can be tested. It is the seam
//! between what `nmeme-tx` writes into a transaction and what comes back from
//! the node: the node returns each note-data entry as a jammed noun blob
//! (`NoteDataEntry.blob` in `nockchain/common/v2/blockchain.proto`), which has
//! to cue, satisfy the based-atom rule, and parse as a claim.

use nmeme_core::{Claim, TokenId};
use nockapp::noun::slab::{NockJammer, NounSlab};
use nockchain_math::owned_based_noun::OwnedBasedNoun;
use nockvm::noun::NounAllocator;

/// Why a note-data blob did not yield a claim.
///
/// Every variant means the note carries no token weight (SPEC §7). None of them
/// is retryable, and none should be silently ignored: a note that fails here
/// after having been counted before would mean the indexer disagrees with
/// itself.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DecodeError {
    #[error("blob is not a valid jammed noun: {0}")]
    Cue(String),
    #[error("noun contains an atom outside the base field: {0}")]
    NotBased(String),
    #[error("payload is not an NMEME claim: {0}")]
    Claim(String),
}

/// Decodes one `meme` note-data blob as it arrives from the node.
pub fn decode_claim(blob: &[u8]) -> Result<Claim, DecodeError> {
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab
        .cue_into(bytes::Bytes::copy_from_slice(blob))
        .map_err(|err| DecodeError::Cue(err.to_string()))?;
    let space = slab.noun_space();
    let owned = OwnedBasedNoun::from_noun(noun, &space)
        .map_err(|err| DecodeError::NotBased(err.to_string()))?;
    Claim::from_noun(&owned).map_err(|err| DecodeError::Claim(err.to_string()))
}

/// Jams a claim the way `NoteDataValue::Noun` does, for tests and tooling.
pub fn encode_claim(claim: &Claim) -> Result<Vec<u8>, nmeme_core::Error> {
    use nockchain_types::tx_engine::v1::note::NoteDataValue;
    let value = NoteDataValue::Noun(claim.to_noun()?);
    Ok(value.raw_blob().to_vec())
}

// ---------------------------------------------------------------------------
// Reading claims back out of a signed transaction file.
// ---------------------------------------------------------------------------

use std::collections::{BTreeMap, BTreeSet};

use nockapp_grpc_proto::pb::common::v2::note::NoteVersion;
use nockapp_grpc_proto::pb::common::v2::BalanceEntry;

use nmeme_core::claim::NOTE_DATA_KEY;
use nockchain_types::tx_engine::common::{Hash, Name};
use nockchain_types::tx_engine::v1::note::NoteDataValue;
use nockchain_types::tx_engine::v1::tx::{Seed, Spend};

/// What one lock-root receives in a transaction: its merged gift, and the claim
/// attached to it if any.
#[derive(Debug, Clone)]
pub struct Destination {
    pub lock_root: Hash,
    /// Gifts are summed per lock-root because consensus merges seeds sharing
    /// one into a single note (FINDINGS §3).
    pub gift: u64,
    pub claim: Option<Claim>,
    /// Every seed paying this lock-root; the merged note's identity is a
    /// function of exactly this set.
    pub seeds: Vec<Seed>,
    /// The complete `Name` consensus assigns to the merged output, computed
    /// from `seeds` (`nmeme_tx::names::output_name`). This is what binds a
    /// claim to one specific note rather than to a recipient.
    pub name: Name,
}

/// The inputs a transaction spends and the destinations it pays.
#[derive(Debug, Clone)]
pub struct TxPlan {
    pub inputs: Vec<Name>,
    pub destinations: Vec<Destination>,
}

/// Recomputes a transaction file's id exactly as consensus does: the hash of
/// its version and its spliced spends (`RawTx::compute_id`, nockchain-types
/// `v1/tx.rs`). A file whose recomputed id equals the id the chain mined IS
/// the mined transaction, field for field: any change to an input, an output,
/// an amount, or a note-data claim changes the id.
pub fn read_tx_id(path: &std::path::Path) -> Result<String, String> {
    use nmeme_tx::txfile::ParsedTransaction;
    use nockchain_types::tx_engine::common::Version;
    use nockchain_types::tx_engine::v1::tx::RawTx;

    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).map_err(|e| format!("cue: {e}"))?;
    let space = slab.noun_space();
    let parsed =
        ParsedTransaction::from_noun(noun.in_space(&space)).map_err(|e| format!("decode: {e}"))?;
    let spends = parsed.spliced().map_err(|e| format!("splice: {e}"))?;
    // The id field does not enter the hash; a placeholder is fine.
    let raw = RawTx { version: Version::V1, id: Hash::from_be_bytes(&[0u8; 32]), spends };
    raw.compute_id_base58().map_err(|e| format!("compute tx id: {e}"))
}

/// Reads a signed transaction file.
///
/// The spend keys *are* the input note names, so inputs need no lookup. Output
/// note names are assigned by consensus and are not in the file; they come from
/// the node.
pub fn read_tx_plan(path: &std::path::Path) -> Result<TxPlan, String> {
    use nmeme_tx::txfile::ParsedTransaction;

    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).map_err(|e| format!("cue: {e}"))?;
    let space = slab.noun_space();
    let parsed =
        ParsedTransaction::from_noun(noun.in_space(&space)).map_err(|e| format!("decode: {e}"))?;
    let spends = parsed.spliced().map_err(|e| format!("splice: {e}"))?;

    let mut inputs = Vec::new();
    struct Partial { lock_root: Hash, gift: u64, claim: Option<Claim>, seeds: Vec<Seed> }
    let mut merged: BTreeMap<Vec<u8>, Partial> = BTreeMap::new();

    for (name, spend) in &spends.0 {
        inputs.push(name.clone());
        let Spend::Witness(spend1) = spend else {
            return Err(format!("spend {} is legacy v0", name.first.to_base58()));
        };
        for seed in &spend1.seeds.0 {
            let key = seed.lock_root.to_be_bytes().to_vec();
            let entry = merged.entry(key).or_insert_with(|| Partial {
                lock_root: seed.lock_root.clone(),
                gift: 0,
                claim: None,
                seeds: Vec::new(),
            });
            entry.gift = entry.gift.saturating_add(seed.gift.0 as u64);
            entry.seeds.push(seed.clone());

            for data in seed.note_data.iter() {
                if data.key != NOTE_DATA_KEY {
                    continue;
                }
                let NoteDataValue::Noun(value) = &data.value else {
                    return Err("meme entry is not a raw noun".to_string());
                };
                let claim = Claim::from_noun(value)
                    .map_err(|e| format!("claim on {}: {e}", seed.lock_root.to_base58()))?;
                if entry.claim.is_some() {
                    // Two claims on one lock-root. Consensus unions the seeds'
                    // note-data maps in its fold order (`build-outputs`:
                    // spends in z-map `tap` order, each spend's seeds in
                    // z-set `tap` order, `uni:by` letting the later map's
                    // entry win). Hoon's `tap` walks a tree right-to-left,
                    // the decoder here walks it left-to-right, so the seed
                    // that comes *first* in the decoded transaction is the
                    // one consensus folds last: its claim is the merged
                    // note's. Checked against the three mined or evaluated
                    // cases with two claims at one lock (the inflate-claim
                    // trades of phases two, three and four): the rule picks
                    // the chain's choice in each. A builder never does this
                    // on purpose (SPEC R1).
                    continue;
                }
                if false {
                    return Err(format!(
                        "two meme claims target lock-root {}",
                        seed.lock_root.to_base58()
                    ));
                }
                entry.claim = Some(claim);
            }
        }
    }

    let mut destinations = Vec::new();
    for partial in merged.into_values() {
        let name = nmeme_tx::output_name(&partial.lock_root, &partial.seeds)
            .map_err(|e| format!("output name for {}: {e}", partial.lock_root.to_base58()))?;
        destinations.push(Destination {
            lock_root: partial.lock_root,
            gift: partial.gift,
            claim: partial.claim,
            seeds: partial.seeds,
            name,
        });
    }
    Ok(TxPlan { inputs, destinations })
}

/// The first-name every note at `lock_root` carries — the lock, not the note.
pub fn first_name_of(lock_root: &Hash) -> Hash {
    nmeme_tx::first_name(lock_root)
}

/// Binds each destination's computed output name to a note the chain knows.
///
/// `candidates` is every note that could be an output of this step: the inputs
/// of any later step (full names, from their transaction files) plus the notes
/// still unspent at the end (full names, from the node). A destination's
/// computed name must appear there **exactly** — first and last. Matching on
/// first-name alone would identify the recipient and nothing more: successive
/// change outputs to the same lock share it.
///
/// Every failure is an error. A destination whose computed name is absent
/// means either the transaction file does not describe what was mined, or the
/// note was spent by something not in the replay; both invalidate the rebuild.
///
/// `token`: the token being rebuilt. An output absent from the candidates
/// is fatal when it carries a claim of that token (its history would be
/// incomplete). One carrying no claim, or a claim of another token, is
/// accepted and reported (`present == false`): the step is canonical — the
/// caller has bound its id to a block, and the id commits to its outputs —
/// so the output existed; that it was spent by a transaction outside the
/// replay changes nothing about this token's accounting. Without `token`
/// every output must be found, as before.
pub fn bind_outputs(
    destinations: &[Destination],
    candidates: &[Name],
    taken: &mut Vec<Vec<u8>>,
    token: Option<&TokenId>,
) -> Result<Vec<(Name, Destination, bool)>, String> {
    let mut out = Vec::new();
    for dest in destinations {
        let key = name_key(&dest.name);
        if taken.contains(&key) {
            return Err(format!(
                "note {} computed for lock-root {} was already produced by an earlier step",
                dest.name.first.to_base58(),
                dest.lock_root.to_base58()
            ));
        }
        let present = candidates.iter().any(|c| name_key(c) == key);
        let carries_token = match (&dest.claim, token) {
            (Some(Claim::Transfer { token: t, .. }), Some(want)) | (Some(Claim::Genesis { token: t, .. }), Some(want)) => t == want,
            (Some(_), None) => true,
            (None, _) => false,
        };
        if !present && (carries_token || token.is_none()) {
            return Err(format!(
                "no chain note has the identity computed for lock-root {}: first {} last {}. \
                 The transaction file does not describe a mined output, or the note was \
                 consumed outside the replay.",
                dest.lock_root.to_base58(),
                dest.name.first.to_base58(),
                dest.name.last.to_base58()
            ));
        }
        taken.push(key);
        out.push((dest.name.clone(), dest.clone(), present));
    }
    Ok(out)
}

pub fn name_key(name: &Name) -> Vec<u8> {
    let mut key = name.first.to_be_bytes().to_vec();
    key.extend_from_slice(&name.last.to_be_bytes());
    key
}

// ---------------------------------------------------------------------------
// One canonical snapshot, read completely.
// ---------------------------------------------------------------------------

/// One page of a balance read, as the node returned it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Page {
    pub height: Option<u64>,
    pub block_id: Option<String>,
    pub notes: Vec<NoteRow>,
    pub next_page_token: String,
}

/// Every unspent note the queried addresses hold, at exactly one block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub height: u64,
    pub block_id: String,
    pub notes: Vec<NoteRow>,
}

/// Upper bound on pages per address. A node that never returns an empty
/// `next_page_token` would otherwise loop forever.
pub const MAX_PAGES: usize = 10_000;

/// Drives a page loop to completion.
///
/// `fetch` is called with the page token to request (empty for the first
/// page) and returns that page. The loop follows `next_page_token` until the
/// node returns an empty one. A read that stops after the first page silently
/// drops every note beyond the server's page size, and a balance rebuilt from
/// a partial note set is simply wrong — so the loop is here, separated from
/// the transport, and tested.
pub fn collect_pages<F>(mut fetch: F) -> Result<Vec<Page>, String>
where
    F: FnMut(&str) -> Result<Page, String>,
{
    let mut pages = Vec::new();
    let mut token = String::new();
    loop {
        let page = fetch(&token)?;
        let next = page.next_page_token.clone();
        pages.push(page);
        if next.is_empty() {
            return Ok(pages);
        }
        if pages.len() >= MAX_PAGES {
            return Err(format!("more than {MAX_PAGES} pages; refusing to loop forever"));
        }
        if next == token {
            return Err("node returned the same page token twice".to_string());
        }
        token = next;
    }
}

/// Merges pages — possibly from several addresses — into one snapshot,
/// requiring every page to report the **same** height and block id.
///
/// Reads that span a block boundary describe two different chains. A balance
/// assembled from Alice's notes at height N and Bob's at height N+1 can show
/// weight that was spent, or miss weight that was received, and no later
/// check would notice. Disagreement is therefore an error; the caller
/// re-reads rather than proceeding.
pub fn fold_pages(pages: &[Page]) -> Result<Snapshot, String> {
    let mut height: Option<u64> = None;
    let mut block_id: Option<String> = None;
    let mut notes = Vec::new();
    for (i, page) in pages.iter().enumerate() {
        let h = page.height.ok_or_else(|| format!("page {i} carries no height"))?;
        let b = page
            .block_id
            .clone()
            .ok_or_else(|| format!("page {i} carries no block id"))?;
        match (&height, &block_id) {
            (None, None) => {
                height = Some(h);
                block_id = Some(b);
            }
            (Some(h0), Some(b0)) => {
                if *h0 != h || *b0 != b {
                    return Err(format!(
                        "pages disagree on the chain snapshot: page 0 at height {h0} block {b0}, \
                         page {i} at height {h} block {b}. The chain advanced mid-read; re-read."
                    ));
                }
            }
            _ => unreachable!("height and block id are set together"),
        }
        notes.extend(page.notes.iter().cloned());
    }
    Ok(Snapshot {
        height: height.ok_or("no pages")?,
        block_id: block_id.ok_or("no pages")?,
        notes,
    })
}

/// Requires two snapshots to be the same block. Used to bracket the
/// transaction-detail reads: if the tip moved between the balance read and the
/// transaction reads, the two describe different states and the rebuild is
/// discarded.
pub fn require_same_snapshot(before: &Snapshot, after: &Snapshot) -> Result<(), String> {
    if before.block_id != after.block_id || before.height != after.height {
        return Err(format!(
            "chain advanced during the read: began at height {} block {}, ended at height {} \
             block {}. Rebuild discarded; re-run to read a single snapshot.",
            before.height, before.block_id, after.height, after.block_id
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Provenance: a replay is only as good as the history it was given.
// ---------------------------------------------------------------------------
//
// `Indexer` learns which notes carry token weight only from transactions it
// has replayed. A genesis that spends a token-bearing note is a burn under
// SPEC G1 — but replayed WITHOUT the transaction that put the weight there,
// the same genesis looks like a valid creation (seen live: the height-44
// genesis on the fakenet chain, reported Created by a two-transaction rebuild
// and Burned by the full one). So a rebuild must prove, for every input of
// every step, that its token status is known:
//
//   * it is an output of an earlier supplied step — the replay computed its
//     weight; or
//   * a FUNDING proof, read from the chain while the note was unspent, shows
//     it carried no `meme` entry at all. Weight only ever comes from a claim
//     under that key, so a note without one has zero weight in every history;
//     no transaction list is needed to know that.
//
// Anything else — in particular a note that carries a claim but whose creating
// transaction was not supplied — is refused rather than guessed.

/// Does raw note-data carry a `meme` entry?
pub fn has_claim(data: &[(String, Vec<u8>)]) -> bool {
    data.iter().any(|(key, _)| key == NOTE_DATA_KEY)
}

/// What the chain shows about an unspent note's token status, and whether
/// that can be re-checked after the note is spent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FundingStatus {
    /// A coinbase reward: its last name recomputes from the parent id of its
    /// origin block (`coinbase_last_name`), and consensus builds coinbase
    /// notes with empty note-data. Verified at read time and again by every
    /// consumer; the only status a rebuild admits.
    Coinbase,
    /// No `meme` entry in the body the node returned, but not a coinbase
    /// note: token-free *now*, which a pre-broadcast gate may use live, but
    /// unverifiable once spent. A rebuild admits it only as the output of a
    /// supplied step.
    Plain,
    /// Carries a `meme` entry.
    Claim,
}

impl FundingStatus {
    pub fn label(self) -> &'static str {
        match self {
            FundingStatus::Coinbase => "coinbase",
            FundingStatus::Plain => "plain",
            FundingStatus::Claim => "claim",
        }
    }
}

/// One `FUNDING` line: `FUNDING <first> <last> <status> <assets> <origin>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FundingRecord {
    pub name: Name,
    pub status: FundingStatus,
    pub assets: u64,
    /// The height whose block created the note. Older files lack it.
    pub origin_page: Option<u64>,
}

/// The header lines of a funding file.
pub fn funding_header(snapshot: &Snapshot) -> Vec<String> {
    vec![format!("HEIGHT\t{}", snapshot.height), format!("BLOCK\t{}", snapshot.block_id)]
}

/// One `FUNDING` line for a note whose status the caller has established.
pub fn funding_line(row: &NoteRow, status: FundingStatus) -> String {
    format!(
        "FUNDING\t{}\t{}\t{}\t{}\t{}",
        row.name.first.to_base58(),
        row.name.last.to_base58(),
        status.label(),
        row.assets,
        row.origin_page
    )
}

/// Is this note the coinbase note of its origin block? `parent_of(height)`
/// returns the parent block id of the block at that height, from the node.
pub fn is_coinbase_note<F>(name: &Name, origin_page: u64, parent_of: &mut F) -> Result<bool, String>
where
    F: FnMut(u64) -> Result<Hash, String>,
{
    let parent = parent_of(origin_page)?;
    Ok(name.last == nmeme_tx::names::coinbase_last_name(&parent))
}

/// Parses `FUNDING` lines. Lines of other kinds are ignored; a malformed
/// line is an error, never skipped; two lines about the same note that do
/// not say the same thing are a conflict and the whole file is refused —
/// a later line never overrides an earlier one, in either direction.
pub fn parse_funding(text: &str) -> Result<Vec<FundingRecord>, String> {
    let mut out: Vec<FundingRecord> = Vec::new();
    let mut seen: BTreeMap<Vec<u8>, (usize, FundingRecord)> = BTreeMap::new();
    for (i, line) in text.lines().enumerate() {
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() != Some(&"FUNDING") {
            continue;
        }
        if fields.len() < 5 {
            return Err(format!("funding line {}: expected 5+ fields, got {}", i + 1, fields.len()));
        }
        let first = Hash::from_base58(fields[1]).map_err(|e| format!("funding line {}: first: {e}", i + 1))?;
        let last = Hash::from_base58(fields[2]).map_err(|e| format!("funding line {}: last: {e}", i + 1))?;
        let status = match fields[3] {
            "coinbase" => FundingStatus::Coinbase,
            "plain" | "tokenfree" => FundingStatus::Plain,
            "claim" => FundingStatus::Claim,
            other => return Err(format!("funding line {}: unknown status {other:?}", i + 1)),
        };
        let assets: u64 = fields[4].parse().map_err(|e| format!("funding line {}: assets: {e}", i + 1))?;
        let origin_page = match fields.get(5) {
            Some(h) => Some(h.parse::<u64>().map_err(|e| format!("funding line {}: origin: {e}", i + 1))?),
            None => None,
        };
        let rec = FundingRecord { name: Name::new(first, last), status, assets, origin_page };
        let key = name_key(&rec.name);
        if let Some((j, earlier)) = seen.get(&key) {
            if *earlier != rec {
                return Err(format!(
                    "funding lines {} and {} conflict about note [{} {}]: {} vs {}. The file is \
                     refused whole; a later line never overrides an earlier one.",
                    j + 1,
                    i + 1,
                    rec.name.first.to_base58(),
                    rec.name.last.to_base58(),
                    earlier.status.label(),
                    rec.status.label()
                ));
            }
        } else {
            seen.insert(key, (i, rec.clone()));
        }
        out.push(rec);
    }
    Ok(out)
}

/// Refuses a set of records — from any number of files — in which two records
/// say different things about one note (full identity, first and last).
/// Identical duplicates are the same fact twice and pass. `parse_funding`
/// applies this within a file; every consumer that combines files must apply
/// it to the combination, which `admitted_token_free` does.
pub fn check_funding_consistency(records: &[FundingRecord]) -> Result<(), String> {
    let mut seen: BTreeMap<Vec<u8>, &FundingRecord> = BTreeMap::new();
    for rec in records {
        match seen.get(&name_key(&rec.name)) {
            None => {
                seen.insert(name_key(&rec.name), rec);
            }
            Some(earlier) if *earlier == rec => {}
            Some(earlier) => {
                return Err(format!(
                    "funding records conflict about note [{} {}]: {} {} nicks origin {:?} vs {} {} nicks origin {:?}. \
                     The combined evidence is refused; no record overrides another, in any order.",
                    rec.name.first.to_base58(),
                    rec.name.last.to_base58(),
                    earlier.status.label(),
                    earlier.assets,
                    earlier.origin_page,
                    rec.status.label(),
                    rec.assets,
                    rec.origin_page
                ))
            }
        }
    }
    Ok(())
}

/// The notes a rebuild may treat as token-free: exactly the records that say
/// `coinbase` **and** recompute as such from the chain. The label is a hint
/// about which check to run, never evidence: a `coinbase` record whose name
/// does not recompute is an error (a forged or corrupted file), and `plain`
/// or legacy `tokenfree` records admit nothing — once spent, nothing can
/// re-verify them, so the step that created them must be supplied instead.
pub fn admitted_token_free<F>(records: &[FundingRecord], parent_of: F) -> Result<BTreeSet<Vec<u8>>, String>
where
    F: FnMut(u64) -> Result<Hash, String>,
{
    admitted_token_free_at(records, Some(0), parent_of)
}

/// `admitted_token_free` under an activation policy (`upstream/activation.patch`):
/// a `claim` record whose origin is before the activation height is also
/// token-free — after activation its claim is legacy metadata, never
/// credit (`nmeme_core::consensus::creditable`), so the note is plain NOCK
/// to the rule and nothing about it needs a step to be supplied. A `claim`
/// record at or after activation admits nothing, as before. With activation
/// disabled (`None`) every claim is legacy.
pub fn admitted_token_free_at<F>(
    records: &[FundingRecord],
    activation: Option<u64>,
    mut parent_of: F,
) -> Result<BTreeSet<Vec<u8>>, String>
where
    F: FnMut(u64) -> Result<Hash, String>,
{
    check_funding_consistency(records)?;
    let mut out = BTreeSet::new();
    for rec in records {
        if rec.status == FundingStatus::Claim {
            let legacy = match (activation, rec.origin_page) {
                (None, _) => true,
                (Some(h), Some(origin)) => origin < h,
                (Some(_), None) => false, // no origin known: not shown to be legacy
            };
            if legacy {
                out.insert(name_key(&rec.name));
            }
            continue;
        }
        if rec.status != FundingStatus::Coinbase {
            continue;
        }
        let label = format!("[{} {}]", rec.name.first.to_base58(), rec.name.last.to_base58());
        let origin = rec
            .origin_page
            .ok_or_else(|| format!("funding record {label} says coinbase but carries no origin height"))?;
        if !is_coinbase_note(&rec.name, origin, &mut parent_of)? {
            return Err(format!(
                "funding record {label} says coinbase, but its last name is not the coinbase name \
                 for the block at height {origin}. The record is not evidence; refusing."
            ));
        }
        out.insert(name_key(&rec.name));
    }
    Ok(out)
}

/// One note as the node's balance response describes it, read completely.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteRow {
    pub name: Name,
    pub address: String,
    /// Raw note-data entries as (key, blob).
    pub data: Vec<(String, Vec<u8>)>,
    pub assets: u64,
    pub origin_page: u64,
}

/// Reads one balance entry into a row, or refuses it.
///
/// The node's own decoder (`nockapp-grpc-proto` `TryFrom<PbNote>`) treats a
/// missing field as an error, and so does this. An entry with no body, no
/// version, an unsupported version, or no note-data field is **not** a note
/// with an empty claim list — it is data this reader did not get, and a
/// guard fed "no claims" for it would call a token note token-free.
pub fn note_from_entry(entry: &BalanceEntry, address: &str) -> Result<NoteRow, String> {
    let name = decode_pb_name(entry.name.as_ref().ok_or("balance entry has no name")?)?;
    let label = format!("[{} {}]", name.first.to_base58(), name.last.to_base58());
    let note = entry.note.as_ref().ok_or_else(|| format!("{label}: balance entry has no note body"))?;
    let v1 = match note.note_version.as_ref() {
        Some(NoteVersion::V1(v1)) => v1,
        Some(NoteVersion::Legacy(_)) => {
            return Err(format!(
                "{label}: v0 (legacy) note. Only v1 notes carry note-data; this reader does not \
                 read v0 notes and will not call one token-free."
            ))
        }
        None => return Err(format!("{label}: note body carries no version")),
    };
    match v1.version.as_ref().map(|v| v.value) {
        Some(1) => {}
        Some(other) => return Err(format!("{label}: unsupported note version {other}; only version 1 is read")),
        None => return Err(format!("{label}: note body carries no version field")),
    }
    let origin_page = v1.origin_page.as_ref().ok_or_else(|| format!("{label}: note body has no origin page"))?.value;
    let body_name = decode_pb_name(v1.name.as_ref().ok_or_else(|| format!("{label}: note body has no name"))?)?;
    if name_key(&body_name) != name_key(&name) {
        return Err(format!(
            "{label}: the note body names a different note [{} {}]",
            body_name.first.to_base58(),
            body_name.last.to_base58()
        ));
    }
    let nd = v1.note_data.as_ref().ok_or_else(|| format!("{label}: note body has no note-data field"))?;
    let data: Vec<(String, Vec<u8>)> = nd.entries.iter().map(|e| (e.key.clone(), e.blob.clone())).collect();
    let assets = v1.assets.as_ref().ok_or_else(|| format!("{label}: note body has no assets"))?.value;
    Ok(NoteRow { name, address: address.to_string(), data, assets, origin_page })
}

/// The pre-broadcast verdict on one input, from the notes the node shows
/// unspent right now — not from any file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputVerdict {
    /// The node shows the note unspent with no `meme` entry.
    TokenFree,
    /// The node shows a claim, and the caller named this note as the one to move.
    NamedTokenNote,
    Refused(String),
}

pub fn classify_input(input: &Name, live: &[NoteRow], allowed_token_notes: &[Name]) -> InputVerdict {
    let key = name_key(input);
    let Some(row) = live.iter().find(|r| name_key(&r.name) == key) else {
        return InputVerdict::Refused(
            "not an unspent note at this node: token status unknown".to_string(),
        );
    };
    if !has_claim(&row.data) {
        return InputVerdict::TokenFree;
    }
    if allowed_token_notes.iter().any(|n| name_key(n) == key) {
        return InputVerdict::NamedTokenNote;
    }
    InputVerdict::Refused(
        "carries a claim and was not named: spending it here would burn it".to_string(),
    )
}

pub fn decode_pb_name(name: &nockapp_grpc_proto::pb::common::v1::Name) -> Result<Name, String> {
    let first = name.first.as_ref().ok_or("name has no first")?;
    let last = name.last.as_ref().ok_or("name has no last")?;
    Ok(Name::new(decode_pb_hash(first)?, decode_pb_hash(last)?))
}

/// The proto carries a tip5 hash as five field elements.
pub fn decode_pb_hash(hash: &nockapp_grpc_proto::pb::common::v1::Hash) -> Result<Hash, String> {
    let limb = |b: &Option<nockapp_grpc_proto::pb::common::v1::Belt>, which: &str| -> Result<u64, String> {
        b.as_ref().map(|b| b.value).ok_or_else(|| format!("hash missing {which}"))
    };
    Ok(Hash::from_limbs(&[
        limb(&hash.belt_1, "belt_1")?,
        limb(&hash.belt_2, "belt_2")?,
        limb(&hash.belt_3, "belt_3")?,
        limb(&hash.belt_4, "belt_4")?,
        limb(&hash.belt_5, "belt_5")?,
    ]))
}

/// Refuses a step unless every input's token status is known: an output of
/// an earlier supplied step, or proven token-free. The error names the first
/// input that is neither, so the operator knows which history is missing.
pub fn require_provenance(
    txid: &str,
    inputs: &[Name],
    known_outputs: &BTreeSet<Vec<u8>>,
    token_free: &BTreeSet<Vec<u8>>,
    coinbase_lasts: &BTreeSet<Vec<u8>>,
) -> Result<(), String> {
    for input in inputs {
        let key = name_key(input);
        if known_outputs.contains(&key) || token_free.contains(&key) {
            continue;
        }
        if coinbase_lasts.contains(&input.last.to_base58().into_bytes()) {
            continue;
        }
        return Err(format!(
            "{txid}: input [{} {}] is neither an output of an earlier supplied step nor \
             proven token-free by a FUNDING file. If it carries a claim, the transaction \
             that created it must be replayed too; a genesis that consumed it would \
             otherwise be reported as a valid creation instead of a burn (SPEC G1).",
            input.first.to_base58(),
            input.last.to_base58()
        ));
    }
    Ok(())
}
