import Link from "next/link";

export function SectionHeader({
  title,
  href,
  linkLabel = "View all",
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-[var(--spacing-4)] flex items-end justify-between gap-4">
      <h2 className="font-display text-lg font-bold tracking-[var(--tracking-label)] uppercase lg:text-xl">
        {title}
      </h2>
      {href && (
        <Link
          href={href}
          className="shrink-0 rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-4 py-1.5 text-xs font-semibold text-[var(--color-muted)] transition-colors hover:text-bone"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

export function Section({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-[var(--spacing-7)] ${className}`}>
      {children}
    </section>
  );
}
