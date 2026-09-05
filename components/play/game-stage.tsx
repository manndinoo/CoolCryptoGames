"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  enterFullscreen,
  exitFullscreen,
  fullscreenAvailable,
  fullscreenElement,
  onFullscreenChange,
} from "@/lib/play/fullscreen";

/**
 * Runs a game filling the whole screen.
 *
 * Built on a fixed, viewport-filling overlay rather than on the Fullscreen API
 * alone, because iOS Safari does not implement `requestFullscreen` for anything
 * but a video element — a native-only approach would silently do nothing on an
 * iPhone, which is where most of this will be played. The overlay works
 * everywhere; native fullscreen is requested on top of it where it is
 * supported, since that additionally hides the browser's own chrome. The
 * request itself is made back at the Play press, where the user gesture that
 * permits it is still live; see lib/play/fullscreen.ts.
 *
 * Height uses `100dvh`, not `100vh`. On mobile `vh` is fixed to the largest
 * viewport, so a `100vh` element sits partly behind the browser's toolbar and
 * the bottom of the game is unreachable; `dvh` tracks the visible area as that
 * chrome shows and hides.
 *
 * The overlay is rendered into `document.body` rather than where it sits in
 * the tree. `position: fixed` only means "against the viewport" while no
 * ancestor has a transform, a filter or containment — any one of those quietly
 * becomes the containing block instead, and the overlay ends up boxed inside
 * whatever column it was declared in. The page wrapper did exactly that, and
 * the symptom was invisible for as long as native fullscreen happened to be
 * granted, because the fullscreen element is promoted to the top layer and
 * escapes its ancestors. That is a coincidence, not a design. A portal makes
 * the guarantee unconditional, and immune to whatever CSS ends up above this
 * in the tree later.
 *
 * The game gets the whole overlay and keeps it. The bar is drawn over the top
 * of it rather than above it in the layout, which is what lets it come and go
 * without the game ever being resized — a canvas that reflows mid-round has to
 * rebuild its backing store, and some of these games lay out their level to the
 * viewport they were handed. One size for the whole session, every time.
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
  const [barShown, setBarShown] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const exit = useCallback(() => {
    exitFullscreen();
    onExit();
  }, [onExit]);

  /** Shows the bar and starts the clock on hiding it again. */
  const revealBar = useCallback(() => {
    setBarShown(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    // Long enough to read the title and find the exit, short enough that it is
    // out of the way before anyone has started playing.
    hideTimer.current = window.setTimeout(() => setBarShown(false), 4000);
  }, []);

  useEffect(() => {
    revealBar();
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [revealBar]);

  // Tracked so the toggle shows the right thing. The player may also have left
  // fullscreen with F11 or the browser's own control, and that is not taken as
  // wanting to leave the game — the overlay is still covering the screen, and
  // there is an exit right here for when they do.
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(fullscreenElement()));
    sync();
    return onFullscreenChange(sync);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // In fullscreen the browser eats the first Escape to leave it, so this
      // only ever sees the second one. That is the ordinary two-step players
      // already expect from every other fullscreen thing on the web.
      exit();
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

  const stage = (
    <div
      ref={stageRef}
      className="fixed inset-0 z-50 bg-carbon"
      style={{ height: "100dvh" }}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — playing`}
    >
      {/* The game, at the full size of the overlay, set once. `transform` is
          load-bearing, not decoration: a game is free to place its own HUD with
          `position: fixed` — Zero Signal puts a currency counter top-right that
          way — and a fixed element normally positions against the viewport,
          which would put it over the bar and make the exit unclickable. A
          transformed ancestor becomes the containing block for fixed
          descendants, so the game's own chrome stays inside the game. */}
      <div className="absolute inset-0" style={{ transform: "translateZ(0)" }}>
        {children}
      </div>

      {/* The handle. Small, dimmed, and the only thing that permanently sits on
          top of the game, because something has to: pointer events inside a
          sandboxed frame never reach this document, so there is no way to
          notice a player reaching for the top of the screen. Top centre is the
          least contested strip across the three games that ship — Zero Signal
          puts sound at the left and a counter at the right, Signal Brawl uses
          both upper corners for fighter health. */}
      <button
        onClick={revealBar}
        onPointerEnter={revealBar}
        onFocus={revealBar}
        aria-label="Show game controls"
        aria-expanded={barShown}
        className={`absolute top-0 left-1/2 z-10 flex h-8 w-20 -translate-x-1/2 items-end justify-center pb-1 transition-opacity duration-[var(--duration-normal)] ${
          barShown ? "pointer-events-none opacity-0" : "opacity-40 hover:opacity-100"
        }`}
      >
        <span className="h-1 w-10 rounded-full bg-bone/70 shadow-[0_1px_4px_rgba(0,0,0,0.8)]" />
      </button>

      {/* The bar, drawn over the game rather than beside it. */}
      <div
        onPointerEnter={revealBar}
        className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 border-b border-white/10 bg-carbon/95 px-3 backdrop-blur transition-transform duration-[var(--duration-normal)] ${
          barShown ? "translate-y-0" : "-translate-y-full"
        }`}
        style={{ height: 44, paddingTop: "env(safe-area-inset-top, 0px)" }}
        // Hidden from assistive technology as well as from sight, so the exit
        // is not read out as available while it is off the screen. The handle
        // that brings it back is labelled and is not hidden.
        aria-hidden={!barShown}
        inert={!barShown}
      >
        <span className="truncate font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
          {title}
        </span>

        <div className="flex shrink-0 items-center">
          {/* Only where the browser has it at all. On an iPhone this would be a
              button that does nothing, and a control that does nothing is worse
              than one that is not there. */}
          {fullscreenAvailable() && (
            <button
              onClick={() => {
                if (isFullscreen) exitFullscreen();
                else enterFullscreen();
                revealBar();
              }}
              aria-label={isFullscreen ? "Leave fullscreen" : "Fill the screen"}
              className="grid size-10 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-white/10 hover:text-bone"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
                <path
                  d={
                    isFullscreen
                      ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
                      : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                  }
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}

          <button
            onClick={exit}
            aria-label="Exit game"
            className="-mr-1 grid size-10 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-white/10 hover:text-bone"
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
      </div>
    </div>
  );

  // The chunk this lives in is client-only, so `document` is always there by
  // the time anything renders.
  return typeof document === "undefined" ? stage : createPortal(stage, document.body);
}
