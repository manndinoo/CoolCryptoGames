/**
 * Production feature flags.
 *
 * Everything here is off by default. These gate capabilities that need real
 * accounts, operations or legal review before they can exist in public, so the
 * safe state is disabled and enabling one is a deliberate act.
 */

function flag(name: string): boolean {
  return process.env[name] === 'true'
}

export const features = {
  realPrizes: flag('FEATURE_REAL_PRIZES'),
  payments: flag('FEATURE_PAYMENTS'),
  developerPayouts: flag('FEATURE_DEVELOPER_PAYOUTS'),
  externalStreamEmbeds: flag('FEATURE_EXTERNAL_STREAM_EMBEDS'),
  nativeStreaming: flag('FEATURE_NATIVE_STREAMING'),
  openGameSubmissions: flag('FEATURE_OPEN_GAME_SUBMISSIONS'),
  onchainCollectibles: flag('FEATURE_ONCHAIN_COLLECTIBLES'),

  /**
   * The development wallet simulator.
   *
   * Deliberately not a plain flag read. It carries a second, independent
   * condition on the runtime environment so that setting the environment
   * variable in production is not sufficient to switch it on — a misconfigured
   * deploy cannot silently accept simulated signatures. Both conditions must
   * hold, and NODE_ENV is not something a request can influence.
   */
  demoWallet: flag('FEATURE_DEMO_WALLET') && process.env.NODE_ENV !== 'production',
} as const

export type FeatureName = keyof typeof features

/** Throws rather than degrading quietly, for server paths that must not run when gated. */
export function assertEnabled(name: FeatureName): void {
  if (!features[name]) {
    throw new Error(`Feature "${name}" is disabled`)
  }
}
