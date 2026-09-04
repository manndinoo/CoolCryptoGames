/**
 * Deciding whether a submitted signature actually paid for an intent.
 *
 * Pure, and separate from the RPC client, because this is the only thing
 * standing between "a client claimed it paid" and an entitlement being written.
 * Everything it needs arrives as data so that every refusal can be tested
 * without a network.
 *
 * What a caller controls, and therefore what this must not trust: the
 * signature string. Everything else — amount, recipient, payer, reference —
 * is read out of the chain's own record of that transaction and compared
 * against the intent the server issued.
 */

export type IntentToSettle = {
  id: string
  wallet: string
  lamports: number
  treasury: string
  reference: string
  expiresAt: number
}

/** The subset of a `getTransaction` response this needs. */
export type ChainTransaction = {
  slot: number
  blockTime: number | null
  meta: {
    err: unknown
    fee: number
    preBalances: number[]
    postBalances: number[]
  } | null
  transaction: {
    message: {
      /** Every account the transaction touched, in order. Index 0 is the payer. */
      accountKeys: string[]
    }
    signatures: string[]
  }
}

export type SettlementRejection =
  | 'not_found'
  | 'transaction_failed'
  | 'intent_expired'
  | 'signature_mismatch'
  | 'payer_mismatch'
  | 'reference_missing'
  | 'treasury_missing'
  | 'underpaid'
  | 'malformed'

export type SettlementResult =
  | { ok: true; lamportsPaid: number }
  | { ok: false; reason: SettlementRejection }

/**
 * @param now Milliseconds. An intent that expired before the transaction was
 * even submitted is refused: the quote is the server's promise about a price,
 * and an unbounded one is a price anyone can come back and claim later.
 */
export function settlePayment(args: {
  intent: IntentToSettle
  signature: string
  tx: ChainTransaction | null
  now: number
}): SettlementResult {
  const { intent, signature, tx, now } = args

  if (!tx) return fail('not_found')
  if (now > intent.expiresAt) return fail('intent_expired')
  if (!tx.meta) return fail('malformed')
  if (tx.meta.err !== null && tx.meta.err !== undefined) return fail('transaction_failed')

  const keys = tx.transaction.message.accountKeys
  const { preBalances, postBalances } = tx.meta
  if (!Array.isArray(keys) || keys.length === 0) return fail('malformed')
  if (preBalances.length !== keys.length || postBalances.length !== keys.length) {
    return fail('malformed')
  }

  // The chain's own record has to name this signature. Without the check, a
  // caller could hand back the signature of any transaction at all and have the
  // rest of the comparison run against something else entirely.
  if (!tx.transaction.signatures.includes(signature)) return fail('signature_mismatch')

  // Index 0 is the fee payer, and the fee payer is who paid. Requiring it to be
  // the session's own wallet stops a player pointing at somebody else's real
  // payment to the treasury and claiming the item from it.
  if (keys[0] !== intent.wallet) return fail('payer_mismatch')

  // The reference is a fresh key per intent, carried in the transfer's account
  // list. It is what makes one payment answer for exactly one purchase, so a
  // single transfer cannot be presented against several intents of equal value.
  if (!keys.includes(intent.reference)) return fail('reference_missing')

  const treasuryIndex = keys.indexOf(intent.treasury)
  if (treasuryIndex === -1) return fail('treasury_missing')

  // Balance delta rather than instruction parsing. It is what actually
  // happened: whatever shape the transaction took, the treasury either ended
  // up with the money or it did not.
  const received = postBalances[treasuryIndex] - preBalances[treasuryIndex]
  if (received < intent.lamports) return fail('underpaid')

  return { ok: true, lamportsPaid: received }
}

const COPY: Record<SettlementRejection, string> = {
  not_found:
    'That transaction has not appeared on chain yet. If your wallet says it succeeded, wait a moment and try again.',
  transaction_failed: 'That transaction failed on chain, so nothing was charged.',
  intent_expired: 'This quote expired before the payment landed. Start the purchase again.',
  signature_mismatch: 'That signature does not match the transaction it refers to.',
  payer_mismatch: 'That payment came from a different wallet than the one signed in here.',
  reference_missing: 'That payment is not the one this purchase asked for.',
  treasury_missing: 'That payment did not reach the platform wallet.',
  underpaid: 'That payment was for less than the quoted price.',
  malformed: 'That transaction could not be read.',
}

export function settlementMessage(reason: SettlementRejection): string {
  return COPY[reason]
}

function fail(reason: SettlementRejection): SettlementResult {
  return { ok: false, reason }
}
