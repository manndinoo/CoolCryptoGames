/**
 * The shell-to-game message protocol.
 *
 * Every message crossing the frame boundary is validated here before anything
 * acts on it. The frame runs untrusted third-party code, so a message from it
 * is exactly as trustworthy as a request from the open internet.
 *
 * The identity check is the part worth understanding. The game frame is
 * sandboxed WITHOUT `allow-same-origin`, which gives it an opaque origin — so
 * `event.origin` arrives as the string "null" and is useless for deciding
 * whether a message came from our own frame. Comparing `event.source` against
 * the iframe's `contentWindow` is what actually establishes that, and it is
 * the check that cannot be forged by another page on the same tab.
 */

export const PROTOCOL_VERSION = '1'

export type GameToShellType =
  | 'GAME_READY'
  | 'TELEMETRY_BATCH'
  | 'SCORE_SUBMIT'
  | 'REPORT_ERROR'
  | 'SESSION_END'

export type ShellToGameType = 'SHELL_INIT' | 'SESSION_START' | 'PAUSE' | 'RESUME' | 'SCORE_RESULT'

export type InputEvent = { t: number; k: string }

export type GameToShellMessage =
  | { type: 'GAME_READY'; protocolVersion: string; requestId: string }
  | {
      type: 'SCORE_SUBMIT'
      protocolVersion: string
      requestId: string
      playSessionId: string
      inputs: InputEvent[]
      claimedScore?: number
    }
  | { type: 'TELEMETRY_BATCH'; protocolVersion: string; requestId: string; events: unknown[] }
  | { type: 'REPORT_ERROR'; protocolVersion: string; requestId: string; message: string }
  | { type: 'SESSION_END'; protocolVersion: string; requestId: string }

const GAME_TO_SHELL: readonly GameToShellType[] = [
  'GAME_READY',
  'TELEMETRY_BATCH',
  'SCORE_SUBMIT',
  'REPORT_ERROR',
  'SESSION_END',
]

/** Caps that stop a frame exhausting the shell with one message. */
const MAX_INPUTS = 50_000
const MAX_TELEMETRY_EVENTS = 500
const MAX_ERROR_LENGTH = 500
const MAX_REQUEST_ID_LENGTH = 128

export type ParseResult =
  | { ok: true; message: GameToShellMessage }
  | { ok: false; reason: ParseRejection }

export type ParseRejection =
  | 'not_an_object'
  | 'unknown_type'
  | 'protocol_mismatch'
  | 'bad_request_id'
  | 'session_mismatch'
  | 'inputs_invalid'
  | 'inputs_too_large'
  | 'telemetry_too_large'
  | 'error_too_long'

/**
 * Validates a message the game frame sent.
 *
 * Anything not recognised is rejected rather than passed through. An
 * allow-list of message types is the point: a protocol that forwards unknown
 * types is a protocol whose surface grows every time a game invents a message.
 */
export function parseGameMessage(raw: unknown, expected: { playSessionId: string }): ParseResult {
  if (typeof raw !== 'object' || raw === null) return fail('not_an_object')
  const msg = raw as Record<string, unknown>

  if (typeof msg.type !== 'string' || !GAME_TO_SHELL.includes(msg.type as GameToShellType)) {
    return fail('unknown_type')
  }
  if (msg.protocolVersion !== PROTOCOL_VERSION) return fail('protocol_mismatch')

  if (
    typeof msg.requestId !== 'string' ||
    msg.requestId.length === 0 ||
    msg.requestId.length > MAX_REQUEST_ID_LENGTH
  ) {
    return fail('bad_request_id')
  }

  const base = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: msg.requestId,
  }

  switch (msg.type as GameToShellType) {
    case 'GAME_READY':
      return { ok: true, message: { type: 'GAME_READY', ...base } }

    case 'SESSION_END':
      return { ok: true, message: { type: 'SESSION_END', ...base } }

    case 'REPORT_ERROR': {
      const message = typeof msg.message === 'string' ? msg.message : ''
      if (message.length > MAX_ERROR_LENGTH) return fail('error_too_long')
      return { ok: true, message: { type: 'REPORT_ERROR', ...base, message } }
    }

    case 'TELEMETRY_BATCH': {
      if (!Array.isArray(msg.events)) return fail('telemetry_too_large')
      if (msg.events.length > MAX_TELEMETRY_EVENTS) return fail('telemetry_too_large')
      return { ok: true, message: { type: 'TELEMETRY_BATCH', ...base, events: msg.events } }
    }

    case 'SCORE_SUBMIT': {
      // A frame must not be able to submit against a session other than the one
      // it was launched for, even if it learns another session's id.
      if (msg.playSessionId !== expected.playSessionId) return fail('session_mismatch')

      if (!Array.isArray(msg.inputs)) return fail('inputs_invalid')
      if (msg.inputs.length > MAX_INPUTS) return fail('inputs_too_large')

      const inputs: InputEvent[] = []
      for (const ev of msg.inputs) {
        if (typeof ev !== 'object' || ev === null) return fail('inputs_invalid')
        const { t, k } = ev as Record<string, unknown>
        if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return fail('inputs_invalid')
        if (typeof k !== 'string' || k.length > 32) return fail('inputs_invalid')
        inputs.push({ t, k })
      }

      return {
        ok: true,
        message: {
          type: 'SCORE_SUBMIT',
          ...base,
          playSessionId: msg.playSessionId,
          inputs,
          claimedScore: typeof msg.claimedScore === 'number' ? msg.claimedScore : undefined,
        },
      }
    }
  }
}

function fail(reason: ParseRejection): ParseResult {
  return { ok: false, reason }
}

/**
 * Whether a message event genuinely came from the game frame.
 *
 * `event.origin` is "null" for a sandboxed frame without `allow-same-origin`,
 * so it cannot distinguish our frame from any other opaque-origin sender.
 * Window identity can.
 */
export function isFromFrame(
  eventSource: MessageEventSource | null,
  frameWindow: Window | null | undefined,
): boolean {
  return Boolean(frameWindow) && eventSource === frameWindow
}
