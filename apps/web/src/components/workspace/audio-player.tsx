import type { StoredFile } from "@ember/protocol";
import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { PauseSolid, PlaySolid } from "@/components/icons/iconoir";
import { clipTime, isAudioClipName } from "@/lib/clip-recording";
import { cn } from "@/lib/utils";
import { barsOf } from "@/lib/waveform";
import { FileCard } from "./file-card";

// A message's sound, which plays in place as Slack plays a clip: a round Play in ink, the sound's waveform,
// which fills in ink as it plays and moves it along where it's pressed, how long it is, then how far in, and
// its speed. One sound plays at a time, and every sound plays at the speed last picked, which the browser
// keeps.

/** The speeds a sound plays at, which its speed button goes through in turn. */
const RATES = [1, 1.5, 2];

/** Where the browser keeps the speed last picked. */
const RATE_KEY = "ember:playback-rate";

/** The keys that move a sound along, and by how many seconds. */
const STEPS: Partial<Record<string, number>> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 };

/** How far a finger moves sideways along a waveform, in pixels, before it's dragging the sound along rather than scrolling. */
const DRAG_SLOP = 4;

/** How wide a waveform's bars are, the least room between them, and how short one can be, as a silent stretch's is, in pixels. */
const BAR = 2.5;
const GAP = 2;
const SHORTEST = 3;

/** The sound playing, which the next to start pauses. */
let playing: HTMLAudioElement | null = null;

/**
 * A file message's sound, in a card named for its file, with its own Play, waveform, time and speed, loading
 * only how long it is until it's played. A sound that isn't one of the composer's clips shows its file's
 * name over its waveform. The waveform is the one its uploader's browser worked out (lib/waveform.ts), and
 * flat for one posted without it, as a bot's is. A sound this browser can't play shows its file's card
 * instead, to download it.
 */
export function AudioPlayer({ file }: { file: StoredFile }) {
  // The address of the sound this browser couldn't play. A bot's edit can give its message another, which
  // gets a player of its own.
  const [unplayable, setUnplayable] = useState<string | null>(null);
  if (unplayable === file.url) return <FileCard file={file} />;
  return <Player key={file.url} file={file} onFailed={() => setUnplayable(file.url)} />;
}

/** `file`'s player, which tells `onFailed` if the browser can't play it. */
function Player({ file, onFailed }: { file: StoredFile; onFailed: () => void }) {
  const rate = useSyncExternalStore(followRate, pickedRate);
  const sound = useSound(rate, onFailed);
  const scrubbing = useScrubbing(sound);
  const named = !isAudioClipName(file.name);
  return (
    <div
      role="group"
      aria-label={file.name}
      className={cn(
        "my-[3px] flex w-[380px] max-w-full items-center gap-3 rounded-[14px] border bg-background pr-3 pl-[9px]",
        named ? "h-16 touch:h-[68px]" : "h-[54px] touch:h-[60px]",
      )}
    >
      <audio ref={sound.audio} src={file.url} preload="metadata" />
      <button
        type="button"
        onClick={sound.toggle}
        aria-label={sound.playing ? "Pause" : "Play"}
        className="grid size-9 flex-none cursor-pointer place-items-center rounded-full bg-foreground text-background transition-transform active:scale-95 touch:size-11"
      >
        {/* Play's triangle sits a hair right of its box's middle, where it looks centered in the circle. */}
        {sound.playing ? <PauseSolid className="size-4" /> : <PlaySolid className="size-4 translate-x-[0.5px]" />}
      </button>
      <div className="min-w-0 flex-1">
        {named && <p className="truncate text-[13px] leading-4 font-medium">{file.name}</p>}
        <div className={cn("relative cursor-pointer touch-pan-y rounded-sm", named ? "mt-1 h-6" : "h-9")} {...scrubbing.props}>
          <HoverTime at={scrubbing.hover} duration={sound.duration} />
          <Waveform levels={file.waveform ?? null} played={sound.duration ? Math.min(1, sound.time / sound.duration) : 0} hover={scrubbing.hover} tallest={named ? 20 : 30} />
        </div>
      </div>
      {/* The slider says how far in it is, of how long, to screen readers. */}
      <span aria-hidden="true" className="min-w-[34px] flex-none text-right text-[13px] text-muted-foreground tabular-nums">
        {clipTime(sound.started ? sound.time : sound.duration)}
      </span>
      <button
        type="button"
        onClick={() => pickRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]!)}
        aria-label={`Playback speed, ${rate} times`}
        className="relative h-6 min-w-[34px] flex-none cursor-pointer rounded-full bg-hover px-2 text-[12px] font-semibold text-foreground tabular-nums hover:bg-border touch:h-8 touch:before:absolute touch:before:-inset-1.5"
      >
        {rate}×
      </button>
    </div>
  );
}

/** What a player knows of its sound, and does with it. */
interface Sound {
  audio: RefObject<HTMLAudioElement | null>;
  /** How long it is, in seconds, or 0 until the browser knows. */
  duration: number;
  /** How far in it is, in seconds. */
  time: number;
  playing: boolean;
  /** Whether it's been played or moved along since it last ended, when it shows how far in it is rather than how long it is. */
  started: boolean;
  toggle: () => void;
  seek: (seconds: number) => void;
}

/** The sound a player plays through the `<audio>` it gives `audio`, at `rate`, telling `onFailed` if the browser can't play it. */
function useSound(rate: number, onFailed: () => void): Sound {
  const audio = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [isPlaying, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const failed = useEffectEvent(onFailed);

  useEffect(() => {
    const element = audio.current!;
    const known = () => setDuration(Number.isFinite(element.duration) ? element.duration : 0);
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
    const element = audio.current!;
    element.defaultPlaybackRate = rate;
    element.playbackRate = rate;
  }, [rate]);

  // While it plays, how far in it is follows it every frame, so its waveform fills smoothly.
  useEffect(() => {
    if (!isPlaying) return;
    const element = audio.current!;
    let frame = requestAnimationFrame(function follow() {
      setTime(element.currentTime);
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  return {
    audio,
    duration,
    time,
    playing: isPlaying,
    started,
    toggle() {
      const element = audio.current!;
      // One the browser can't play says so by its error.
      if (element.paused) element.play().catch(() => {});
      else element.pause();
    },
    seek(seconds) {
      const to = Math.min(Math.max(0, seconds), duration);
      audio.current!.currentTime = to;
      setTime(to);
      setStarted(true);
    },
  };
}

/**
 * A waveform's slider, which a mouse moves the sound along by at once, pressed or dragged, and shows the time
 * it hovers over. A finger moves it once it's lifted, or once it's dragging sideways, as one moving up or down
 * is scrolling the timeline. The arrows move it 5 seconds, Home and End to its ends, and Space plays or pauses it.
 */
function useScrubbing(sound: Sound) {
  const [hover, setHover] = useState<number | null>(null);
  const press = useRef<{ x: number; dragging: boolean } | null>(null);
  const along = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return box.width > 0 ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0;
  };
  const drag = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { x: event.clientX, dragging: true };
    sound.seek(along(event) * sound.duration);
  };
  return {
    hover,
    props: {
      role: "slider",
      tabIndex: 0,
      "aria-label": "Position",
      "aria-valuemin": 0,
      "aria-valuemax": Math.round(sound.duration),
      "aria-valuenow": Math.round(sound.time),
      "aria-valuetext": `${clipTime(sound.time)} of ${clipTime(sound.duration)}`,
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0) return;
        if (event.pointerType === "mouse") drag(event);
        else press.current = { x: event.clientX, dragging: false };
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        if (event.pointerType === "mouse") setHover(along(event));
        const pressed = press.current;
        if (pressed?.dragging) sound.seek(along(event) * sound.duration);
        else if (pressed && Math.abs(event.clientX - pressed.x) > DRAG_SLOP) drag(event);
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        if (press.current && !press.current.dragging) sound.seek(along(event) * sound.duration);
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
        if (step !== undefined) sound.seek(sound.time + step);
        else if (event.key === "Home") sound.seek(0);
        else if (event.key === "End") sound.seek(sound.duration);
        else if (event.key === " ") sound.toggle();
        else return;
        event.preventDefault();
      },
    },
  };
}

/** The time a mouse hovers over on a waveform, `at` its way along, over it. */
function HoverTime({ at, duration }: { at: number | null; duration: number }) {
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

interface WaveformProps {
  levels: readonly number[] | null;
  /** How far it's played, and how far along a mouse hovers, from 0 to 1. */
  played: number;
  hover: number | null;
  /** How tall its loudest bar is, in pixels. */
  tallest: number;
}

/**
 * A sound's waveform, as bars spread across its whole width, so that how far along a bar is is how far in
 * the sound its stretch is: faint, darker as far as a mouse hovers, and in ink as far as it's played.
 */
function Waveform({ levels, played, hover, tallest }: WaveformProps) {
  const box = useRef<SVGSVGElement>(null);
  const { width, height } = useSize(box);
  const count = width > 0 ? Math.max(6, Math.floor((width + GAP) / (BAR + GAP))) : 0;
  const bars = useMemo(() => barsOf(levels, count), [levels, count]);
  const step = (width - BAR) / (count - 1);
  const id = `${useId().replace(/[^\w-]/g, "")}-bars`;
  return (
    <svg ref={box} aria-hidden="true" focusable="false" className="block size-full overflow-visible">
      <defs>
        <clipPath id={id}>
          {bars.map((bar, index) => {
            const tall = Math.max(SHORTEST, bar * tallest);
            return <rect key={index} x={index * step} y={(height - tall) / 2} width={BAR} height={tall} rx={BAR / 2} />;
          })}
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect width="100%" height="100%" className="fill-foreground/20" />
        {hover !== null && <rect width={hover * width} height="100%" className="fill-foreground/40" />}
        <rect width={played * width} height="100%" className="fill-foreground" />
      </g>
    </svg>
  );
}

/** How wide and tall `element` is, measured before it's first painted, and again each time it changes. */
function useSize(element: RefObject<Element | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const measured = element.current!;
    const { width, height } = measured.getBoundingClientRect();
    setSize({ width, height });
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry!.contentRect.width, height: entry!.contentRect.height }));
    observer.observe(measured);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

/** The speed last picked on this page, where the browser couldn't keep it, as one whose storage is full can't, or null. */
let rateHere: number | null = null;

/** Each player, to tell when another speed is picked. */
const rateFollowers = new Set<() => void>();

/** The speed last picked: on this page, where the browser couldn't keep it, or as the browser keeps it, or 1×. */
function pickedRate(): number {
  if (rateHere !== null) return rateHere;
  try {
    const kept = Number(localStorage.getItem(RATE_KEY));
    return RATES.includes(kept) ? kept : 1;
  } catch {
    return 1;
  }
}

/** Plays every sound at `rate`, from now on. */
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
