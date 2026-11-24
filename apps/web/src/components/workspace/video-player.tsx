import type { StoredFile } from "@ember/protocol";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Expand, PauseSolid, PlaySolid, SoundHighSolid, SoundOffSolid, VideoCamera } from "@/components/icons/iconoir";
import { clipTime, videoClipRecordedAt } from "@/lib/clip-recording";
import { recordedLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { FileActions, FileCard } from "./file-card";
import { SpeedButton, usePlayback, useScrubbing } from "./playback";
import { uploadSize } from "./upload-card";

// A message's video, in a card as a file is: what it is, with Download and Share, then its picture, which plays
// or pauses where it's clicked, and along its foot a strip of its own: Play, a line that moves it along and shows
// a picture of the moment a mouse hovers over, how far in it is of how long, its speed, its sound and full
// screen. It plays as a message's sound does (playback.tsx): one at a time, at the speed last picked.

/**
 * A video's width over its height below which its picture leaves its sides to fill, in the most a card shows
 * of one: 440px wide by 320px tall. They're filled with its poster, blurred.
 */
const NARROW = 440 / 320;

/** How wide the picture of a hovered moment is, in pixels, or an upright video's. */
const FRAME_WIDTH = 160;
const UPRIGHT_FRAME_WIDTH = 90;

/** A strip's button, 28px round, or 44px for fingers. */
const STRIP_BUTTON =
  "grid size-7 flex-none cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground touch:size-11";

/**
 * A file message's video, in a card named for its file. A clip from the composer says when it was recorded
 * rather than its file's name, and any other video its type and size, both with how long it is, which its
 * uploader's browser read as it was sent (lib/video-length.ts). Behind its poster it loads nothing until it's
 * played or moved along; without one, as when its uploader's browser couldn't play it, it loads enough to show
 * its first picture. A video this browser can't play shows its file's card instead, to download it.
 */
export function VideoPlayer({ file }: { file: StoredFile }) {
  // The address of the video this browser couldn't play. A bot's edit can give its message another, which
  // gets a player of its own.
  const [unplayable, setUnplayable] = useState<string | null>(null);
  if (unplayable === file.url) return <FileCard file={file} />;
  return <Player key={file.url} file={file} onFailed={() => setUnplayable(file.url)} />;
}

/** `file`'s player, which tells `onFailed` if the browser can't play it. */
function Player({ file, onFailed }: { file: StoredFile; onFailed: () => void }) {
  const video = usePlayback<HTMLVideoElement>(onFailed, file.duration);
  const frames = useFrames(file.url);
  const scrubbing = useScrubbing(video, (along) => {
    if (video.duration) frames.show(along * video.duration);
  });
  const muted = useMuted(video.media);
  const recorded = videoClipRecordedAt(file.name);
  const ratio = file.width && file.height ? file.width / file.height : 16 / 9;
  const about = [recorded ? recordedLabel(recorded) : `${typeOf(file)} · ${uploadSize(file.byteSize)}`, video.duration > 0 && clipTime(video.duration)];
  return (
    <div role="group" aria-label={file.name} className="my-[5px] w-[440px] max-w-full overflow-hidden rounded-[12px] border bg-background">
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <VideoCamera className="size-9 flex-none rounded-[7px] bg-surface p-[7px]" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-medium">{recorded ? "Video clip" : file.name}</p>
          <p className="truncate text-[13px] text-muted-foreground">{about.filter(Boolean).join(" · ")}</p>
        </div>
        <FileActions file={file} />
      </div>
      {/* A click on the picture plays or pauses it, as the strip's Play does for the keys and screen readers. Its
          width is set, so its height alone stops at 320px, as an upright video's does, rather than its width with it. */}
      <div className="group relative max-h-[320px] w-full cursor-pointer overflow-hidden bg-black" style={{ aspectRatio: String(ratio) }} onClick={video.toggle}>
        {ratio < NARROW && file.previewUrl && (
          <>
            <img src={file.previewUrl} alt="" loading="lazy" className="absolute inset-0 size-full scale-125 object-cover blur-2xl" />
            <span className="absolute inset-0 bg-black/25" />
          </>
        )}
        <video
          ref={video.media}
          src={file.url}
          poster={file.previewUrl}
          preload={file.previewUrl ? "none" : "metadata"}
          playsInline
          aria-label={file.name}
          className="absolute inset-0 size-full object-contain"
        />
        {!video.playing && (
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 grid size-12 -translate-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors group-hover:bg-black/65"
          >
            <PlaySolid className="size-5 translate-x-px" />
          </span>
        )}
      </div>
      <div className="@container flex h-11 items-center gap-1.5 border-t bg-surface px-2 touch:h-14">
        <button
          type="button"
          onClick={video.toggle}
          aria-label={video.playing ? "Pause" : "Play"}
          className="grid size-7 flex-none cursor-pointer place-items-center rounded-full bg-foreground text-background transition-transform active:scale-95 touch:size-11"
        >
          {/* Play's triangle sits a hair right of its box's middle, where it looks centered in the circle. */}
          {video.playing ? <PauseSolid className="size-3.5 touch:size-4" /> : <PlaySolid className="size-3.5 translate-x-[0.5px] touch:size-4" />}
        </button>
        <div className="relative mx-1.5 flex h-6 min-w-0 flex-1 cursor-pointer touch-pan-y items-center rounded-sm touch:h-11" {...scrubbing.props}>
          <FramePreview at={scrubbing.hover} duration={video.duration} frames={frames} ratio={ratio} />
          <Track played={video.duration ? Math.min(1, video.time / video.duration) : 0} hover={scrubbing.hover} />
        </div>
        {/* The slider says how far in it is, of how long, to screen readers. A narrow strip says how long it is until it's played, then how far in. */}
        <span aria-hidden="true" className="flex-none px-0.5 text-[12px] font-medium text-muted-foreground tabular-nums">
          <span className="@max-[380px]:hidden">
            {clipTime(video.time)}
            {video.duration > 0 && ` / ${clipTime(video.duration)}`}
          </span>
          <span className="@min-[380px]:hidden">{clipTime(video.started ? video.time : video.duration)}</span>
        </span>
        <SpeedButton className="@max-[250px]:hidden" />
        <button
          type="button"
          onClick={() => (video.media.current!.muted = !muted)}
          aria-label="Mute"
          aria-pressed={muted}
          className={cn(STRIP_BUTTON, "@max-[340px]:hidden")}
        >
          {muted ? <SoundOffSolid className="size-[18px]" /> : <SoundHighSolid className="size-[18px]" />}
        </button>
        <button type="button" onClick={() => fullScreen(video.media.current!)} aria-label="Full screen" className={STRIP_BUTTON}>
          <Expand className="size-[17px]" />
        </button>
      </div>
    </div>
  );
}

/** A video's type, as its card says it: its file's extension, or its type's, as MP4 or WEBM. */
function typeOf(file: StoredFile): string {
  const extension = /\.(\w+)$/.exec(file.name)?.[1] ?? file.contentType.split("/")[1] ?? "video";
  return extension.toUpperCase();
}

/** A line along a video, in ink as far as it's played, with a dot where it is, and darker as far as a mouse hovers. */
function Track({ played, hover }: { played: number; hover: number | null }) {
  return (
    <span aria-hidden="true" className="relative block h-1 w-full rounded-full bg-foreground/15">
      {hover !== null && <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/30" style={{ width: `${hover * 100}%` }} />}
      <span className="absolute inset-y-0 left-0 rounded-full bg-foreground" style={{ width: `${played * 100}%` }} />
      <span className="absolute top-1/2 size-3 -translate-1/2 rounded-full bg-foreground" style={{ left: `${played * 100}%` }} />
    </span>
  );
}

/** What draws the pictures of a video's moments, and the canvas it draws them on. */
interface Frames {
  canvas: RefObject<HTMLCanvasElement | null>;
  /** Draws the picture `seconds` in, once it's found. */
  show: (seconds: number) => void;
}

/**
 * Pictures of a video's moments, for where a mouse hovers over its line: a silent copy of the video, made the
 * first time one is asked for, moves there and draws itself, one move at a time, then the last one asked for.
 * The copy goes with the player.
 */
function useFrames(url: string): Frames {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scout = useRef<{ video: HTMLVideoElement; moving: boolean; next: number | null } | null>(null);
  useEffect(
    () => () => {
      scout.current?.video.removeAttribute("src");
      scout.current?.video.load();
    },
    [],
  );
  const show = (seconds: number) => {
    if (!scout.current) {
      const video = document.createElement("video");
      const copy = (scout.current = { video, moving: false, next: null as number | null });
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.addEventListener("seeked", () => {
        const drawing = canvas.current;
        if (drawing) {
          drawing.getContext("2d")?.drawImage(video, 0, 0, drawing.width, drawing.height);
          drawing.dataset.drawn = "";
        }
        copy.moving = false;
        const next = copy.next;
        copy.next = null;
        if (next !== null) show(next);
      });
      video.src = url;
    }
    const copy = scout.current;
    if (copy.moving) {
      copy.next = seconds;
      return;
    }
    copy.moving = true;
    const move = () => (copy.video.currentTime = seconds);
    if (copy.video.readyState >= HTMLMediaElement.HAVE_METADATA) move();
    else copy.video.addEventListener("loadedmetadata", move, { once: true });
  };
  return { canvas, show };
}

interface FramePreviewProps {
  /** How far along a mouse hovers, from 0 to 1, or null. */
  at: number | null;
  duration: number;
  frames: Frames;
  /** The video's width over its height. */
  ratio: number;
}

/**
 * The picture of the moment a mouse hovers over, once it's drawn, and the time there, over the line, kept
 * within its ends.
 */
function FramePreview({ at, duration, frames, ratio }: FramePreviewProps) {
  if (at === null || !duration) return null;
  const width = ratio < 1 ? UPRIGHT_FRAME_WIDTH : FRAME_WIDTH;
  const height = Math.round(width / ratio);
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-full z-10 mb-2.5 grid -translate-x-1/2 justify-items-center gap-1"
      style={{ left: `clamp(${width / 2}px, ${at * 100}%, calc(100% - ${width / 2}px))` }}
    >
      <canvas
        ref={frames.canvas}
        width={width * 2}
        height={height * 2}
        className="hidden rounded-md border-2 border-white bg-black shadow-[0_4px_14px_#0006] data-drawn:block"
        style={{ width, height }}
      />
      <span className="rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">{clipTime(at * duration)}</span>
    </span>
  );
}

/** Whether `media` is muted, which changes as it is. */
function useMuted(media: RefObject<HTMLMediaElement | null>): boolean {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const element = media.current!;
    const heard = () => setMuted(element.muted);
    element.addEventListener("volumechange", heard);
    return () => element.removeEventListener("volumechange", heard);
  }, [media]);
  return muted;
}

/**
 * Plays `video` full screen, in the browser's own player with its controls, which it hides again as the video
 * leaves full screen. An iPhone, whose pages can't be full screen, plays it in its own player, once it's loaded
 * the video, so the first press there plays it in place.
 */
function fullScreen(video: HTMLVideoElement & { webkitEnterFullscreen?: () => void }) {
  if (!document.fullscreenEnabled) {
    try {
      video.webkitEnterFullscreen?.();
    } catch {
      video.play().catch(() => {});
    }
    return;
  }
  video.controls = true;
  const left = () => {
    if (document.fullscreenElement === video) return;
    video.controls = false;
    document.removeEventListener("fullscreenchange", left);
  };
  document.addEventListener("fullscreenchange", left);
  video.requestFullscreen().catch(left);
}
