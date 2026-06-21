"use client";

import { useEffect, useRef, useState } from "react";
import {
  rollIdleBehavior,
  nextIdleRollDelayMs,
  nextWorkingQuipDelayMs,
  pickRandom,
  WORKING_MESSAGES,
  actionDurationMs,
  MESSAGE_DISPLAY_MS,
  WORKING_MESSAGE_DISPLAY_MS,
  type PetAction,
} from "./quips";

/**
 * Desktop pet page — rendered inside its own frameless / transparent
 * BrowserWindow opened by main.ts createPetWindow().
 *
 * Two engines live here:
 *  1) "State" — pushed every 2s by main via IPC (idle / working / waiting / done).
 *     Drives which PNG is shown and the "core" CSS animation.
 *  2) "Liveliness" — fully client-side timers that decide WHEN to bubble a
 *     quip or play a small action (stretch, lookLeft, hop, snore, etc.).
 *     Conditions on the state (working pool vs idle pool).
 *
 * Why client-side: liveliness is purely cosmetic — main process shouldn't
 * waste IPC bandwidth telling the renderer "now wink". Renderer is the
 * place to roll its own dice.
 */

type PetState = "idle" | "working" | "waiting" | "done";

interface PetPayload {
  state: PetState;
  themeId: string | null;
  assetUrl: { idle: string; working: string; waiting: string; done: string } | null;
  muted: boolean;
}

export default function PetPage() {
  const [payload, setPayload] = useState<PetPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<PetAction>("none");
  const downAtRef = useRef<number>(0);
  // Track the most recent message id so the cleanup timer doesn't clobber
  // a later replacement message. (See plan §3 — original Swift pet uses
  // the same guard with `if self?.message == m`.)
  const messageIdRef = useRef<number>(0);

  // ── Subscribe to main's state pushes ────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI?.pet;
    if (!api) return;
    const off = api.onState((p) => setPayload(p));
    return off;
  }, []);

  const state = payload?.state ?? "idle";
  const muted = !!payload?.muted;

  // ── Liveliness engine ───────────────────────────────────────────────
  // Reset timers whenever the state changes — switching from working to
  // idle should immediately start the idle dice roll, not finish the
  // working schedule first.
  useEffect(() => {
    if (muted) {
      // Mute kills quips + actions. The pet still bobs / pulses / etc
      // (those are pure CSS on the state-class), so it never looks dead.
      setMessage(null);
      setAction("none");
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function showMessage(m: string, displayMs: number) {
      if (cancelled) return;
      const myId = ++messageIdRef.current;
      setMessage(m);
      timers.push(
        setTimeout(() => {
          if (!cancelled && messageIdRef.current === myId) setMessage(null);
        }, displayMs),
      );
    }

    function showAction(a: PetAction) {
      if (cancelled || a === "none") return;
      setAction(a);
      timers.push(
        setTimeout(() => {
          if (!cancelled) setAction("none");
        }, actionDurationMs(a)),
      );
    }

    if (state === "working") {
      // working: every 15-30s, drop a working quip. No actions here —
      // the pet is "busy", quips only.
      const tick = () => {
        if (cancelled) return;
        showMessage(pickRandom(WORKING_MESSAGES), WORKING_MESSAGE_DISPLAY_MS);
        timers.push(setTimeout(tick, nextWorkingQuipDelayMs()));
      };
      // First quip lands 4-8s after entering working state — fast enough
      // to feel responsive, slow enough to not look spammy.
      timers.push(setTimeout(tick, 4000 + Math.random() * 4000));
    } else if (state === "idle") {
      // idle: every 12-25s roll dice. 40% action only, 35% msg only, 25% both.
      const tick = () => {
        if (cancelled) return;
        const roll = rollIdleBehavior();
        if (roll.message) showMessage(roll.message, MESSAGE_DISPLAY_MS);
        if (roll.action !== "none") showAction(roll.action);
        timers.push(setTimeout(tick, nextIdleRollDelayMs()));
      };
      // First roll lands 5-12s after going idle (mirroring Swift pet line 109).
      timers.push(setTimeout(tick, 5000 + Math.random() * 7000));
    }
    // waiting / done are short-lived — no auto-quips. Pure visual.

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [state, muted]);

  // ── Click / drag disambiguation ─────────────────────────────────────
  // (Drag is OS-level via WebkitAppRegion. A "click" is just a quick
  // mousedown→mouseup with no significant time gap.)
  const handleMouseDown = () => { downAtRef.current = Date.now(); };
  const handleMouseUp = () => {
    const elapsed = Date.now() - downAtRef.current;
    if (elapsed > 0 && elapsed < 180) {
      window.electronAPI?.pet?.toggleMute().catch(() => {});
    }
  };

  const src = payload?.assetUrl?.[state] ?? null;

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; background: transparent !important; overflow: hidden; }
        #pet-root {
          width: 100vw; height: 100vh;
          display: flex; align-items: flex-end; justify-content: center;
          padding-bottom: 8px;
          -webkit-app-region: drag;
          user-select: none;
          background: transparent;
          position: relative;
        }
        /* Speech bubble sits ABOVE the pet, follows it horizontally.
           Tail at bottom-center pointing down at the pet's head. */
        #pet-bubble {
          position: absolute;
          top: 8px; left: 50%;
          transform: translateX(-50%);
          max-width: 200px;
          padding: 8px 12px;
          background: rgba(255,255,255,.96);
          color: #222;
          font-size: 13px;
          line-height: 1.35;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,.18);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          -webkit-app-region: no-drag;
          animation: pet-bubble-in 220ms ease-out;
          pointer-events: none;
        }
        #pet-bubble::after {
          content: '';
          position: absolute;
          top: 100%; left: 50%;
          transform: translateX(-50%);
          border: 6px solid transparent;
          border-top-color: rgba(255,255,255,.96);
          border-bottom: 0;
          width: 0; height: 0;
        }
        @keyframes pet-bubble-in {
          from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @media (prefers-color-scheme: dark) {
          #pet-bubble { background: rgba(40,40,46,.96); color: #eee; }
          #pet-bubble::after { border-top-color: rgba(40,40,46,.96); }
        }

        #pet-img-wrap {
          -webkit-app-region: drag;
          cursor: grab;
          width: 160px; height: 160px;
          display: flex; align-items: center; justify-content: center;
          position: relative;
        }
        #pet-img-wrap:active { cursor: grabbing; }
        #pet-img {
          width: 100%; height: 100%;
          object-fit: contain;
          pointer-events: none;
          /* "Core" state animations layered on top of any action animation. */
          animation: pet-bob 3s ease-in-out infinite;
          transform-origin: 50% 70%;
        }
        @keyframes pet-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }

        /* State aura — overlays behind pet. */
        .pet-state-working::before {
          content: ''; position: absolute; inset: -10px;
          border-radius: 50%;
          /* 2026-06-21 Magic Glass: aura now uses the magic dual-stop
             gradient instead of hardcoded orange — shares DNA with the
             new sidebar/topbar accent. */
          background: radial-gradient(circle,
            var(--mg-accent-from) 0%,
            color-mix(in oklab, var(--mg-accent-to) 60%, transparent) 40%,
            transparent 75%);
          opacity: 0.55;
          animation: pet-pulse 1.6s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes pet-pulse {
          0%, 100% { transform: scale(1); opacity: .6; }
          50%      { transform: scale(1.2); opacity: 1; }
        }
        .pet-state-waiting::after {
          content: '⋯'; position: absolute; top: -10px; right: 4px;
          font-size: 26px; color: rgba(120, 120, 200, .9);
          animation: pet-think 1.4s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes pet-think {
          0%, 100% { opacity: .3; transform: translateY(2px); }
          50%      { opacity: 1;  transform: translateY(-2px); }
        }
        .pet-state-done #pet-img {
          animation: pet-celebrate .9s ease-out 1, pet-bob 3s ease-in-out infinite .9s;
        }
        @keyframes pet-celebrate {
          0%   { transform: scale(1) rotate(0deg); }
          30%  { transform: scale(1.15) rotate(-6deg); }
          60%  { transform: scale(1.05) rotate(4deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        .pet-state-done::before {
          content: '✨'; position: absolute; top: 4px; left: 8px;
          font-size: 22px; animation: pet-sparkle 1.4s ease-out 1;
          pointer-events: none;
        }
        @keyframes pet-sparkle {
          0%   { opacity: 0; transform: translate(0, 0) scale(.5); }
          50%  { opacity: 1; transform: translate(-6px, -8px) scale(1.2); }
          100% { opacity: 0; transform: translate(-12px, -16px) scale(.8); }
        }

        /* ── Action overlays — applied as a class on #pet-img-wrap.
             Each is a transform animation on #pet-img; we drop the
             default pet-bob during the action so they don't compound. */
        .pet-action-stretch #pet-img { animation: pet-stretch 1.8s ease-in-out 1; }
        @keyframes pet-stretch {
          0%, 100% { transform: scale(1, 1); }
          50%      { transform: scale(1.12, 0.92); }
        }
        .pet-action-lookLeft #pet-img { animation: pet-look-left 1.8s ease-in-out 1; }
        @keyframes pet-look-left {
          0%, 100% { transform: rotate(0deg); }
          30%, 70% { transform: rotate(-9deg); }
        }
        .pet-action-lookRight #pet-img { animation: pet-look-right 1.8s ease-in-out 1; }
        @keyframes pet-look-right {
          0%, 100% { transform: rotate(0deg); }
          30%, 70% { transform: rotate(9deg); }
        }
        .pet-action-hop #pet-img { animation: pet-hop 1.8s ease-in-out 1; }
        @keyframes pet-hop {
          0%, 100% { transform: translateY(0); }
          15%      { transform: translateY(-18px); }
          30%      { transform: translateY(0); }
          45%      { transform: translateY(-10px); }
          60%      { transform: translateY(0); }
        }
        .pet-action-sneeze #pet-img { animation: pet-sneeze 1.8s ease-in-out 1; }
        @keyframes pet-sneeze {
          0%, 100%        { transform: translateY(0) scale(1); }
          40%             { transform: translateY(-2px) scale(0.94); }
          60%             { transform: translateY(0) scale(1.12); }
        }
        .pet-action-peek #pet-img { animation: pet-peek 1.8s ease-in-out 1; }
        @keyframes pet-peek {
          0%, 100% { transform: translateX(0); }
          30%      { transform: translateX(8px); }
          60%      { transform: translateX(-4px); }
        }
        .pet-action-snore #pet-img { animation: pet-snore 4.5s ease-in-out 1; }
        @keyframes pet-snore {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          20%      { transform: translateY(3px) rotate(-2deg); }
          50%      { transform: translateY(4px) rotate(-3deg); }
          80%      { transform: translateY(3px) rotate(-2deg); }
        }
        /* Z's drifting up when snoring */
        .pet-action-snore::after {
          content: 'z z z';
          position: absolute;
          top: -4px; right: -2px;
          font-size: 14px;
          letter-spacing: 4px;
          color: rgba(150,180,220,.8);
          font-style: italic;
          font-weight: bold;
          animation: pet-snore-z 4.5s ease-out 1;
          pointer-events: none;
        }
        @keyframes pet-snore-z {
          0%   { opacity: 0; transform: translateY(0); }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { opacity: 0; transform: translateY(-18px); }
        }

        /* placeholder when no theme is configured */
        #pet-placeholder {
          width: 110px; height: 110px;
          border-radius: 50%;
          background: rgba(120, 120, 140, .25);
          display: flex; align-items: center; justify-content: center;
          font-size: 44px; opacity: .7;
        }
        #pet-mute {
          position: absolute; bottom: -2px; right: 2px;
          font-size: 15px; opacity: .85;
          background: rgba(0,0,0,.45); border-radius: 50%;
          width: 22px; height: 22px;
          display: flex; align-items: center; justify-content: center;
          color: #fff;
          -webkit-app-region: no-drag;
          cursor: pointer;
        }
      `}</style>
      <div id="pet-root">
        {message ? <div id="pet-bubble">{message}</div> : null}
        <div
          id="pet-img-wrap"
          className={`pet-state-${state} ${action !== "none" ? `pet-action-${action}` : ""}`}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        >
          {src ? (
            <img id="pet-img" src={src} alt={`pet ${state}`} draggable={false} />
          ) : (
            <div id="pet-placeholder">🐾</div>
          )}
          {muted ? (
            <div
              id="pet-mute"
              title="unmute"
              onClick={(e) => {
                e.stopPropagation();
                window.electronAPI?.pet?.toggleMute().catch(() => {});
              }}
            >
              🔇
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
