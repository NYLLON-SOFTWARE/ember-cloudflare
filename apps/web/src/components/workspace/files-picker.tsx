import { useEffect, useId, useRef, useState } from "react";
import type { Message, Room, RoomId, ShareWidening, StoredFile, UserId } from "@ember/protocol";
import { Lock, Page, Search, Xmark } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useNameOf } from "@/hooks/use-directory";
import { fetchSearch } from "@/lib/api";
import type { EmberFile } from "@/lib/uploads";
import { roomName } from "@/lib/directs";
import { cn } from "@/lib/utils";
import { shareWidening, ShareWarning, type SharePlace } from "./share-warning";
import { DIALOG, DIALOG_BACKDROP, DIALOG_CLOSE, DIALOG_TITLE } from "./unsaved-changes";
import { fileSize } from "./upload-card";

/** A file shared in a room, as the picker offers it. */
export interface SharedFile {
  file: StoredFile;
  /** The room it was shared in, from which the room it's picked in copies it. */
  roomId: RoomId;
  /** Where it was shared, as the sidebar names the room. */
  roomLabel: string;
  /** Whether that's a DM, or a private room, which shows a lock. */
  direct: boolean;
  closed: boolean;
  /** Who shared it, which tells two files of the same name apart. */
  uploader: string;
  sharedAt: string;
}

/** The files among `messages`, newest first as search lists them, each with where it was shared. */
export function sharedFiles(messages: Message[], rooms: Room[], meId: UserId, nameOf: Parameters<typeof roomName>[2]): SharedFile[] {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  return messages.flatMap(({ attachment, roomId, creator, createdAt }) => {
    const room = byId.get(roomId);
    if (!attachment) return [];
    const roomLabel = !room ? "" : room.kind === "direct" ? roomName(room, meId, nameOf) : `#${room.name}`;
    return [{ file: attachment, roomId, roomLabel, direct: room?.kind === "direct", closed: room?.kind === "closed", uploader: nameOf(creator), sharedAt: createdAt }];
  });
}

interface Props {
  meId: UserId;
  /** The room the file's picked for, and how the warning names it. */
  roomId: RoomId;
  room: SharePlace;
  /** Takes the file picked, to send as a file of its own, as one from the computer goes. */
  onPick: (shared: EmberFile) => void;
  onClose: () => void;
  /** Where focus goes once it closes, as the composer keeps it in the text. */
  onReturnFocus: () => void;
}

/**
 * Files in Ember: the files shared in the rooms you're in, newest first, which typing narrows to those
 * whose names have the words typed, as a search for files finds them. Picking one answers it, to send as
 * an upload goes, with its card and preview.
 */
export function FilesPicker({ meId, roomId, room, onPick, onClose, onReturnFocus }: Props) {
  const nameOf = useNameOf();
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [unchecked, setUnchecked] = useState(false);
  // A file that would reach people who can't see where it was shared, while the warning asks about it.
  const [warning, setWarning] = useState<{ shared: SharedFile; widening: ShareWidening } | null>(null);
  const picking = useRef<SharedFile | null>(null);
  // The file's button, which focus goes back to when the warning shares nothing.
  const picked = useRef<HTMLElement | null>(null);
  const fieldId = useId();

  const send = ({ roomId, file, roomLabel, direct, closed }: SharedFile, accepted = 0) =>
    onPick({ roomId, file, source: { label: roomLabel, direct, closed }, accepted });
  // Asked again as Attach is pressed, as who's in the room may have changed while the warning was open: a new
  // count shows in the warning, to attach on, and none at all, or the same, attaches.
  const share = async ({ shared, widening }: { shared: SharedFile; widening: ShareWidening }) => {
    const now = await shareWidening(shared.roomId, roomId).catch(() => undefined);
    if (now?.widens && now.newViewers !== widening.newViewers) return setWarning({ shared, widening: now });
    setWarning(null);
    send(shared, now?.newViewers ?? widening.newViewers);
  };
  // Warns first, as Slack does, where the file would reach anyone who can't see the room it was shared in.
  const pick = async (shared: SharedFile) => {
    picking.current = shared;
    setUnchecked(false);
    const widening = await shareWidening(shared.roomId, roomId).catch(() => undefined);
    if (picking.current !== shared) return;
    if (widening === undefined) return setUnchecked(true);
    if (widening?.widens) setWarning({ shared, widening });
    else send(shared);
  };

  useEffect(() => {
    let current = true;
    // A pause between keys before asking, so each key doesn't send a search.
    const timer = setTimeout(
      () =>
        void fetchSearch({ q: query, hasFile: true }).then(
          ({ matches, rooms }) => {
            if (!current) return;
            setFiles(sharedFiles(matches.map(({ message }) => message), rooms, meId, nameOf));
            setFailed(false);
          },
          () => current && setFailed(true),
        ),
      query === "" ? 0 : 250,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, meId, nameOf]);

  return (
    <Dialog open onOpenChange={(open) => open || onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        overlayClassName={DIALOG_BACKDROP}
        // A sheet the height of the screen on phones, over which the warning comes up from the bottom.
        className={cn(
          DIALOG,
          "w-[520px] max-md:inset-0 max-md:h-dvh max-md:max-h-none max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:pt-[max(24px,env(safe-area-inset-top))] max-md:sm:max-w-none",
        )}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <button type="button" aria-label="Close" onClick={onClose} className={DIALOG_CLOSE}>
          <Xmark className="size-[18px]" />
        </button>
        <DialogTitle className={cn(DIALOG_TITLE, "mb-3 pe-10")}>Files in Ember</DialogTitle>
        <label htmlFor={fieldId} className="sr-only">
          Search files
        </label>
        <div className="relative mb-2">
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id={fieldId}
            type="search"
            autoComplete="off"
            placeholder="Search files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 w-full rounded-[9px] border bg-background ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-selected-dark touch:h-11 touch:text-base"
          />
        </div>
        {failed ? (
          <p role="alert" className="py-3 text-sm text-negative">
            Files couldn't be listed. Try again in a moment.
          </p>
        ) : files === null ? (
          <p role="status" className="py-3 text-sm text-muted-foreground">
            Listing files…
          </p>
        ) : files.length === 0 ? (
          <p role="status" className="py-3 text-sm text-muted-foreground">
            {query ? "No files match." : "No files have been shared yet."}
          </p>
        ) : (
          <ul aria-label="Files" className="-mx-2 max-h-[50dvh] overflow-y-auto max-md:max-h-[calc(100dvh-10rem)]">
            {files.map((shared) => (
              <li key={shared.file.id}>
                <button
                  type="button"
                  onClick={(event) => {
                    picked.current = event.currentTarget;
                    void pick(shared);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-2 py-2 text-start hover:bg-hover touch:min-h-11",
                    warning?.shared === shared && "bg-hover",
                  )}
                >
                  {shared.file.previewUrl ? (
                    <img src={shared.file.previewUrl} alt="" className="size-9 shrink-0 rounded-[6px] border object-cover" />
                  ) : (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[6px] border">
                      <Page className="size-[18px]" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{shared.file.name}</span>
                    <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
                      {shared.closed && <Lock aria-label="Private" className="size-3 shrink-0" />}
                      <span className="truncate">
                        {[
                          shared.roomLabel,
                          shared.uploader,
                          fileSize(shared.file.byteSize),
                          new Date(shared.sharedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {unchecked && (
          <p role="alert" className="pt-2 text-sm text-negative">
            Couldn't check who can see that file. Try again.
          </p>
        )}
        {warning && (
          <ShareWarning
            source={{ label: warning.shared.roomLabel, direct: warning.shared.direct, closed: warning.shared.closed }}
            target={room}
            widening={warning.widening}
            confirm="Attach"
            // Over the picker, whose own backdrop is there already, so the file picked stays readable.
            overlayClassName="bg-transparent"
            onCancel={() => setWarning(null)}
            onReturnFocus={() => picked.current?.focus()}
            onShare={() => void share(warning)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
