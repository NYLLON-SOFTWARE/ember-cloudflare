import { roomTranscriptPath, workspaceTranscriptPath, type RoomId, type TranscriptFormat } from "@ember/protocol";
import { Download } from "@/components/icons/iconoir";

/** Campfire's outline `.btn` in a panel: 36px, 44px for fingers. */
const DOWNLOAD_LINK =
  "inline-flex min-h-9 max-w-full items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium touch:min-h-11 hover:bg-hover";

interface Props {
  /** The room to download, or every room and DM you're in when omitted. */
  roomId?: RoomId;
  heading: string;
  description: string;
}

/**
 * Markdown and JSON downloads of a room, a DM, or every conversation you're in. The Worker writes the
 * file; these are ordinary GET links, with the session cookie.
 */
export function TranscriptDownload({ roomId, heading, description }: Props) {
  const href = (format: TranscriptFormat) => (roomId === undefined ? workspaceTranscriptPath(format) : roomTranscriptPath(roomId, format));
  return (
    <section>
      <h2 className="mb-1.5 text-base font-semibold">{heading}</h2>
      <p className="mb-4 text-muted-foreground">{description}</p>
      <div className="flex flex-wrap gap-2">
        <a href={href("markdown")} download className={DOWNLOAD_LINK}>
          <Download className="size-[1.3em] shrink-0" />
          Markdown
        </a>
        <a href={href("json")} download className={DOWNLOAD_LINK}>
          <Download className="size-[1.3em] shrink-0" />
          JSON
        </a>
      </div>
    </section>
  );
}
