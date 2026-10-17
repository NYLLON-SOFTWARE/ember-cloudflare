import { isWebImage, MAX_PREVIEW_SIZE, PREVIEW_MAX_HEIGHT, PREVIEW_MAX_WIDTH, type StoredFile } from "@ember/protocol";
import { useState, type CSSProperties } from "react";
import { Lightbox } from "@/components/lightbox";
import type { Size } from "@/lib/previews";
import { cn } from "@/lib/utils";
import { FileCard } from "./file-card";

/**
 * A file message's file, as ember-rust's `attachment_presentation` shows it (crates/views/src/messages/presentation.rs):
 * a video plays in place, a picture shows its thumbnail, or without one, as a bot's has none, itself if it's
 * a picture every browser shows of up to 5 MiB, and every other file shows its card.
 */
export function Attachment({ file }: { file: StoredFile }) {
  if (file.contentType.startsWith("video")) return <VideoPreview file={file} />;
  const picture = file.previewUrl ?? (isWebImage(file.contentType) && file.byteSize <= MAX_PREVIEW_SIZE ? file.url : null);
  return picture ? <PicturePreview file={file} src={picture} /> : <FileCard file={file} />;
}

/** The size a message shows a file at, as ember-rust's `preview_dimensions` works it out: its own, scaled down to fit 1200×800. */
function shownSize({ width, height }: StoredFile): Size | null {
  if (!width || !height) return null;
  const scale = Math.min(1, PREVIEW_MAX_WIDTH / width, PREVIEW_MAX_HEIGHT / height);
  return { width: width * scale, height: height * scale };
}

/**
 * A picture, lazily loaded, which links to its file and opens it in the image viewer, as ember-rust's
 * `lightboxed_image_preview` does, with Download and Share taking the file's download address. A picture
 * not every browser shows, such as a HEIC or TIFF, opens as its thumbnail, where ember-rust's viewer shows
 * the original, which Chrome can't. ember-rust's box is half the picture's size, as its
 * `inline_media_dimension_constraints` sets it, but the picture is at most 480px wide and 640px or 70% of
 * the screen tall (zz-ember.css), so a picture shown more than 480px wide leaves the rest of its box blank
 * below it. Ember's box keeps to those limits instead, so it's always the picture's shape. The picture's
 * alt text is the file's name, where ember-rust's has none. The viewer is only there while it's open, so
 * a timeline of pictures holds no viewer for each.
 */
function PicturePreview({ file, src }: { file: StoredFile; src: string }) {
  const [viewing, setViewing] = useState(false);
  const size = shownSize(file);
  const box: CSSProperties | undefined = size
    ? { width: `min(${size.width / 2}px, 480px, ${size.width / size.height} * 70dvh)`, aspectRatio: `${size.width} / ${size.height}` }
    : undefined;
  return (
    <>
      <a
        href={file.url}
        onClick={(event) => {
          // A click with a modifier key or another button is the browser's, opening the file elsewhere, where ember-rust's opens the viewer.
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          setViewing(true);
        }}
        className={cn("block max-w-full", !size && "w-fit max-w-[min(480px,100%)]")}
        style={box}
      >
        <img
          src={src}
          alt={file.name}
          loading="lazy"
          className={cn("block cursor-zoom-in rounded-[10px] border object-contain object-left-top", size ? "size-full" : "max-h-[min(640px,70dvh)] max-w-full")}
        />
      </a>
      {viewing && (
        <Lightbox src={isWebImage(file.contentType) ? file.url : src} alt={file.name} downloadUrl={file.downloadUrl} onClose={() => setViewing(false)} />
      )}
    </>
  );
}

/**
 * A video, which plays in place in a box half its size, as ember-rust's does. Behind its poster it loads
 * nothing until it's played; without one, as when its uploader's browser couldn't play it, which ember-rust's
 * server makes regardless, it loads enough to draw its first frame. It's named for its file, where
 * ember-rust's has no name.
 */
function VideoPreview({ file }: { file: StoredFile }) {
  const size = shownSize(file);
  return (
    <div className="flex max-w-full overflow-clip" style={size ? { width: size.width / 2, aspectRatio: `${size.width} / ${size.height}` } : undefined}>
      <video
        src={file.url}
        poster={file.previewUrl}
        controls
        preload={file.previewUrl ? "none" : "metadata"}
        aria-label={file.name}
        className="size-full rounded-[10px] border"
      />
    </div>
  );
}
