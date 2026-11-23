import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { clipTime } from "@/lib/clip-recording";
import { cn } from "@/lib/utils";

// What a message's sound and video players share (audio-player.tsx, video-player.tsx): one sound or video plays
// at a time, every one at the speed last picked, which the browser keeps, and each has a slider along its length
// that moves it along where it's pressed, and by the keys.

/** The speeds a sound or video plays at, which its speed button goes through in turn. */
const RATES = [1, 1.5, 2];

/** Whether `rate` is a speed to keep: one of the button's, or one a browser's own player offers, as Chrome's full-screen one does from 0.25× to 2×. */
const isRate = (rate: number) => rate >= 0.25 && rate <= 2;

/** Where the browser keeps the speed last picked. */
const RATE_KEY = "ember:playback-rate";

/** The keys that move a sound or video along, and by how many seconds. */
const STEPS: Partial<Record<string, number>> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 };

/** How far a finger moves sideways along a slider, in pixels, before it's dragging the sound or video along rather than scrolling. */
const DRAG_SLOP = 4;

/** The sound or video playing, which the next to start pauses. */
let playing: HTMLMediaElement | null = null;

/** What a player knows of its sound or video, and does with it. */
export interface Playback<Media extends HTMLMediaElement = HTMLMediaElement> {
  media: RefObject<Media | null>;
  /** How long it is, in seconds, or 0 until the browser knows, unless its uploader's browser said. */
  duration: number;
  /** How far in it is, in seconds. */
  time: number;
  playing: boolean;
  /** Whether it's been played or moved along since it last ended, when it shows how far in it is rather than how long it is. */
  started: boolean;
  toggle: () => void;
  seek: (seconds: number) => void;
}

/**
 * The playing of the `<audio>` or `<video>` a player gives `media`, at the speed last picked, telling `onFailed`
 * if the browser can't play it. Until the browser knows how long it is, it's `known` seconds long, as its
 * uploader's browser read it. Moving it along before it's loaded, as a video that loads nothing until it's
 * played is, has the browser load it there.
 */
export function usePlayback<Media extends HTMLMediaElement>(onFailed: () => void, known = 0): Playback<Media> {
  const media = useRef<Media>(null);
  const rate = usePickedRate();
  const [duration, setDuration] = useState(known);
  const [time, setTime] = useState(0);
  const [isPlaying, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const failed = useEffectEvent(onFailed);

  useEffect(() => {
    const element = media.current!;
    const known = () => {
      if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
    };
    const listeners: Record<string, () => void> = {
      loadedmetadata: known,
      durationchange: known,
      play() {
        if (playing !== element) playing?.pause();
        playing = element;
        setPlaying(true);
        setStarted(true);
      },
      pause() {
        if (playing === element) playing = null;
        setPlaying(false);
        setTime(element.currentTime);
      },
      // At its end, it's ready to play again from the start, showing how long it is.
      ended() {
        element.currentTime = 0;
        setTime(0);
        setStarted(false);
      },
      seeked: () => setTime(element.currentTime),
      // A speed picked in the browser's own player, as full screen shows it, is every sound's and video's from then on.
      ratechange() {
        if (element.playbackRate !== pickedRate() && isRate(element.playbackRate)) pickRate(element.playbackRate);
      },
      error: () => failed(),
    };
    for (const [type, listener] of Object.entries(listeners)) element.addEventListener(type, listener);
    // What the browser knew before it was listened to.
    known();
    if (element.error) failed();
    return () => {
      for (const [type, listener] of Object.entries(listeners)) element.removeEventListener(type, listener);
      if (playing === element) playing = null;
    };
  }, []);

  useEffect(() => {
    const element = media.current!;
    element.defaultPlaybackRate = rate;
    element.playbackRate = rate;
  }, [rate]);

  // While it plays, how far in it is follows it every frame, so what's played fills smoothly.
  useEffect(() => {
    if (!isPlaying) return;
    const element = media.current!;
    let frame = requestAnimationFrame(function follow() {
      setTime(element.currentTime);
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  return {
    media,
    duration,
    time,
    playing: isPlaying,
    started,
    toggle() {
      const element = media.current!;
      // One the browser can't play says so by its error.
      if (element.paused) element.play().catch(() => {});
      else element.pause();
    },
    seek(seconds) {
      const element = media.current!;
      const to = Math.min(Math.max(0, seconds), duration);
      // The browser moves one it hasn't loaded once it has, and shows its picture there.
      if (element.readyState === HTMLMediaElement.HAVE_NOTHING && element.preload === "none") element.preload = "auto";
      element.currentTime = to;
      setTime(to);
      setStarted(true);
    },
  };
}

/**
 * A slider along a sound or video, which a mouse moves it along by at once, pressed or dragged, and which says
 * where a mouse hovers over it, telling `onHover` too. A finger moves it once it's lifted, or once it's dragging
 * sideways, as one moving up or down is scrolling the timeline. The arrows move it 5 seconds, Home and End to its
 * ends, and Space plays or pauses it.
 */
export function useScrubbing(playback: Playback, onHover?: (along: number) => void) {
  const [hover, setHover] = useState<number | null>(null);
  const press = useRef<{ x: number; dragging: boolean } | null>(null);
  const along = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return box.width > 0 ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0;
  };
  const drag = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { x: event.clientX, dragging: true };
    playback.seek(along(event) * playback.duration);
  };
  return {
    /** How far along a mouse hovers, from 0 to 1, or null. */
    hover,
    props: {
      role: "slider",
      tabIndex: 0,
      "aria-label": "Position",
      "aria-valuemin": 0,
      "aria-valuemax": Math.round(playback.duration),
      "aria-valuenow": Math.round(playback.time),
      "aria-valuetext": `${clipTime(playback.time)} of ${clipTime(playback.duration)}`,
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0) return;
        if (event.pointerType === "mouse") drag(event);
        else press.current = { x: event.clientX, dragging: false };
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        if (event.pointerType === "mouse") {
          setHover(along(event));
          onHover?.(along(event));
        }
        const pressed = press.current;
        if (pressed?.dragging) playback.seek(along(event) * playback.duration);
        else if (pressed && Math.abs(event.clientX - pressed.x) > DRAG_SLOP) drag(event);
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        if (press.current && !press.current.dragging) playback.seek(along(event) * playback.duration);
        press.current = null;
      },
      // The browser took a finger for scrolling.
      onPointerCancel() {
        press.current = null;
      },
      onPointerLeave() {
        setHover(null);
      },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const step = STEPS[event.key];
        if (step !== undefined) playback.seek(playback.time + step);
        else if (event.key === "Home") playback.seek(0);
        else if (event.key === "End") playback.seek(playback.duration);
        else if (event.key === " ") playback.toggle();
        else return;
        event.preventDefault();
      },
    },
  };
}

/** The time a mouse hovers over on a slider, `at` its way along, over it. */
export function HoverTime({ at, duration }: { at: number | null; duration: number }) {
  if (at === null || !duration) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-[11px] font-semibold text-background tabular-nums shadow-[0_2px_6px_var(--tooltip-shadow)]"
      style={{ left: `${at * 100}%` }}
    >
      {clipTime(at * duration)}
    </span>
  );
}

/**
 * The button that plays every sound and video at the next speed, 1×, 1.5× or 2× in turn, saying the speed now. From
 * one picked in the browser's own player, as 1.25×, it goes to 1×.
 */
export function SpeedButton({ className }: { className?: string }) {
  const rate = usePickedRate();
  return (
    <button
      type="button"
      onClick={() => pickRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]!)}
      aria-label={`Playback speed, ${rate} times`}
      className={cn(
        "relative h-6 min-w-[34px] flex-none cursor-pointer rounded-full bg-hover px-2 text-[12px] font-semibold text-foreground tabular-nums hover:bg-border touch:h-8 touch:before:absolute touch:before:-inset-1.5",
        className,
      )}
    >
      {rate}×
    </button>
  );
}

/** The speed last picked, which changes as another is. */
const usePickedRate = () => useSyncExternalStore(followRate, pickedRate);

/** The speed last picked on this page, where the browser couldn't keep it, as one whose storage is full can't, or null. */
let rateHere: number | null = null;

/** Each player, to tell when another speed is picked. */
const rateFollowers = new Set<() => void>();

/** The speed last picked: on this page, where the browser couldn't keep it, or as the browser keeps it, or 1×. */
function pickedRate(): number {
  if (rateHere !== null) return rateHere;
  try {
    const kept = Number(localStorage.getItem(RATE_KEY));
    return isRate(kept) ? kept : 1;
  } catch {
    return 1;
  }
}

/** Plays every sound and video at `rate`, from now on. */
function pickRate(rate: number) {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
    rateHere = null;
  } catch {
    rateHere = rate;
  }
  for (const follower of rateFollowers) follower();
}

/** Tells `follower` each time another speed is picked, here or in another of the browser's tabs. */
function followRate(follower: () => void) {
  rateFollowers.add(follower);
  addEventListener("storage", follower);
  return () => {
    rateFollowers.delete(follower);
    removeEventListener("storage", follower);
  };
}
