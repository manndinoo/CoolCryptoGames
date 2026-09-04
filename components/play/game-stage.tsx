"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs a game filling the whole screen.
 *
 * Built on a fixed, viewport-filling overlay rather than the Fullscreen API,
 * because iOS Safari does not implement `requestFullscreen` for anything but a
 * video element — a native-only approach would silently do nothing on an
 * iPhone, which is where most of this will be played. The overlay works
 * everywhere; native fullscreen is then requested on top of it where it is
 * supported, since that additionally hides the browser's own chrome.
 *
 * Height uses `100dvh`, not `100vh`. On mobile `vh` is fixed to the largest
 * viewport, so a `100vh` element sits partly behind the browser's toolbar and
 * the bottom of the game is unreachable; `dvh` tracks the visible area as that
 * chrome shows and hides.
 */
export function GameStage({
  title,
  onExit,
  children,
}: {
  title: string;
  onExit: () => void;
  /** What fills the screen: a sandboxed iframe, or a mounted game component. */
  children: React.ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);

  const exit = useCallback(() => {
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    onExit();
  }, [onExit]);

  // Ask for native fullscreen once, on mount. It is a progressive enhancement:
  // a rejection is expected on iOS and on any browser that requires a fresh
  // user gesture, and the overlay is already covering the screen either way.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof el.requestFullscreen !== "function") return;

    el.requestFullscreen()
      .then(() => setNativeFullscreen(true))
      .catch(() => setNativeFullscreen(false));
  }, []);

  // Leaving native fullscreen by the browser's own control should leave the
  // game too, rather than stranding the player in an overlay with no chrome.
  useEffect(() => {
    function onChange() {
      if (!document.fullscreenElement && nativeFullscreen) exit();
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [nativeFullscreen, exit]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Escape already exits native fullscreen; this covers the overlay-only
      // case where the browser has nothing to close.
      if (e.key === "Escape" && !document.fullscreenElement) exit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exit]);

  // Stop the page behind the overlay from scrolling or rubber-banding while a
  // game has the screen. Both are restored on unmount, including the exact
  // scroll position, so leaving a game returns you to where you were.
  useEffect(() => {
    const { body, documentElement: html } = document;
    const scrollY = window.scrollY;
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      htmlOverscroll: html.style.overscrollBehavior,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    html.style.overscrollBehavior = "none";

    return () => {
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      html.style.overscrollBehavior = previous.htmlOverscroll;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-50 flex flex-col bg-carbon"
      style={{ height: "100dvh" }}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — playing`}
    >
      {/* A slim bar rather than a floating button.
          A control overlaid on the game will always cover something: Road to
          Bonded puts its pause top-left, Zero Signal puts sound top-left and a
          currency counter top-right. There is no corner free across every game,
          and a game cannot lay itself out around a button it does not know
          about. Giving the bar its own strip costs ~44px of height and makes
          the collision impossible instead of merely unlikely. */}
      <div
        className="flex items-center justify-between gap-3 border-b border-white/10 bg-carbon px-3"
        style={{ height: 44, paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <span className="truncate font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
          {title}
        </span>
        <button
          onClick={exit}
          aria-label="Exit game"
          className="-mr-1 grid size-10 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-white/10 hover:text-bone"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* `transform` is load-bearing, not decoration. A game is free to place
          its own HUD with `position: fixed` — Zero Signal puts a currency
          counter top-right that way — and a fixed element normally positions
          against the viewport, which put it on top of the exit bar and made
          the exit unclickable. A transformed ancestor becomes the containing
          block for fixed descendants, so the game's own chrome is confined to
          the game's own area. */}
      <div className="min-h-0 flex-1" style={{ transform: "translateZ(0)" }}>
        {children}
      </div>
    </div>
  );
}
