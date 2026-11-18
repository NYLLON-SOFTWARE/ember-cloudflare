import { roomTranscriptPath, workspaceTranscriptPath, type RoomId, type TranscriptFormat } from "@ember/protocol";
import { Download, ShareAndroid } from "@/components/icons/iconoir";
import { ShareButton } from "@/components/share-button";
import { canShare } from "@/lib/share";
import { cn } from "@/lib/utils";

/** Campfire's outline `.btn` in a panel: 36px, 44px for fingers. */
const DOWNLOAD_LINK =
  "inline-flex min-h-9 max-w-full items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium touch:min-h-11 hover:bg-hover";

/** Each format, as its controls name it. */
const FORMATS: [TranscriptFormat, string][] = [
  ["markdown", "Markdown"],
  ["json", "JSON"],
];

interface Props {
  /** The room to download, or every room and DM you're in when omitted. */
  roomId?: RoomId;
  heading: string;
  description: string;
}

/**
 * Markdown and JSON downloads of a room, a DM, or every conversation you're in. The Worker writes the
 * file; these are ordinary GET links, with the session cookie. Ember added to an iPhone's or iPad's home
 * screen hides them, as a file's card does, since it can't download, and offers Share instead, where
 * the browser can share.
 */
export function TranscriptDownload({ roomId, heading, description }: Props) {
  const href = (format: TranscriptFormat) => (roomId === undefined ? workspaceTranscriptPath(format) : roomTranscriptPath(roomId, format));
  return (
    <section>
      <h2 className="mb-1.5 text-base font-semibold">{heading}</h2>
      <p className="mb-4 text-muted-foreground">{description}</p>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map(([format, name]) => (
          <a key={format} href={href(format)} download className={cn(DOWNLOAD_LINK, "ios-pwa:hidden")}>
            <Download className="size-[1.3em] shrink-0" />
            {name}
          </a>
        ))}
        {canShare() &&
          FORMATS.map(([format, name]) => (
            <ShareButton key={format} url={href(format)} sharedTitle={heading} className={cn(DOWNLOAD_LINK, "cursor-pointer")}>
              <ShareAndroid className="size-[1.3em] shrink-0" />
              Share {name}
            </ShareButton>
          ))}
      </div>
    </section>
  );
}
