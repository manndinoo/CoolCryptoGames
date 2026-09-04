"use client";

/**
 * What you last played, on this device.
 *
 * Kept in localStorage rather than on the server. It is a convenience, not a
 * record: it needs no account, it works before anyone signs in, and it never
 * leaves the browser, so surfacing it costs a player nothing in privacy.
 *
 * The reason it exists is that resuming is the cheapest return visit there is.
 * A catalogue that opens on "here is everything, choose again" asks a returning
 * player to redo a decision they already made; every large catalogue — Steam,
 * Netflix, YouTube — puts what you were last doing at the top instead. This is
 * that, built from the player's own history rather than from a guess.
 */

const KEY = "ccg:recent";
const LIMIT = 4;

export type RecentPlay = { slug: string; at: number };

export function recordPlay(slug: string): void {
  try {
    const existing = readRecent().filter((entry) => entry.slug !== slug);
    const next = [{ slug, at: Date.now() }, ...existing].slice(0, LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full. Losing a convenience is not worth failing a
    // game launch over.
  }
}

export function readRecent(): RecentPlay[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentPlay =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as RecentPlay).slug === "string" &&
          typeof (entry as RecentPlay).at === "number",
      )
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}
