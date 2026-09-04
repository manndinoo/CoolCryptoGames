"use client";

/**
 * Where you are in getting into a game.
 *
 * Three steps, and the first is already done — you picked a game, which is
 * what got you here. That is not a trick: it is a real step that really
 * happened, shown rather than discarded.
 *
 * Showing it matters because of how people behave near the end of a sequence.
 * Kivetz, Urminsky and Zheng (2006) found café customers bought roughly 2.4
 * times more frequently as they neared a reward, and — the part that applies
 * here — a ten-stamp card handed over with two stamps already on it was
 * completed about 34% of the time against about 19% for a blank eight-stamp
 * card demanding identical effort. Progress that is already visible is
 * finished more often than progress that starts at nothing.
 *
 * The honest constraint: the steps are real and the count is real. A fake
 * fourth step, or a bar that moves without anything happening, would be the
 * version of this that regulators have a name for.
 */
export function PlaySteps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Game chosen", "Connect wallet", "Pick a name"];

  return (
    <ol className="mb-[var(--spacing-5)] flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const index = i + 1;
        const done = index < current;
        const active = index === current;

        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              aria-hidden
              className={`h-1 flex-1 rounded-full transition-colors duration-[var(--duration-normal)] ${
                done || active
                  ? "bg-accent"
                  : "bg-[var(--color-subtle-border)]"
              }`}
            />
            <span
              className={`shrink-0 text-[10px] font-bold tracking-[var(--tracking-label)] uppercase ${
                active
                  ? "text-bone"
                  : done
                    ? "text-accent"
                    : "text-[var(--color-muted)]"
              }`}
            >
              {done ? "✓ " : ""}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
