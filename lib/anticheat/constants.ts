/** How often a running client must check in. */
export const HEARTBEAT_INTERVAL_MS = 5_000

/**
 * Missing this much heartbeat time means the client was not connected for part
 * of the run. Three intervals, so ordinary jitter and a dropped packet do not
 * fail an honest player.
 */
export const MAX_HEARTBEAT_GAP_MS = 16_000

/** Absolute slack when comparing simulated run length to wall-clock. */
export const CLOCK_TOLERANCE_MS = 3_000

/** Proportional slack on top, for long runs. */
export const CLOCK_TOLERANCE_RATIO = 0.05

/** Window used for the sustained input-rate check. */
export const RATE_WINDOW_MS = 1_000

/**
 * Below this coefficient of variation, inter-input timing is too regular to be
 * a human hand — a metronome, not a player. Only applied once there are enough
 * events for the statistic to mean anything.
 */
export const MIN_TIMING_VARIATION = 0.02
export const TIMING_VARIATION_MIN_EVENTS = 25
