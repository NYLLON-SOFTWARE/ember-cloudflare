import type { StoredFile } from "@ember/protocol";
import { useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { PauseSolid, PlaySolid } from "@/components/icons/iconoir";
import { clipTime, isAudioClipName } from "@/lib/clip-recording";
import { cn } from "@/lib/utils";
import { barsOf } from "@/lib/waveform";
import { FileCard } from "./file-card";
import { HoverTime, SpeedButton, usePlayback, useScrubbing } from "./playback";

// A message's sound, which plays in place as Slack plays a clip: a round Play in ink, the sound's waveform,
// which fills in ink as it plays and moves it along where it's pressed, how long it is, then how far in, and
// its speed. It plays as a message's video does (playback.tsx): one at a time, at the speed last picked.

/** How wide a waveform's bars are, the least room between them, and how short one can be, as a silent stretch's is, in pixels. */
const BAR = 2.5;
const GAP = 2;
const SHORTEST = 3;

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
  const sound = usePlayback<HTMLAudioElement>(onFailed);
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
      <audio ref={sound.media} src={file.url} preload="metadata" />
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
      <SpeedButton />
    </div>
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
