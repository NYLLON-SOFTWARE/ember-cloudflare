import { useEffect, useId, useState } from "react";
import type { Message, Room, StoredFile, UserId } from "@ember/protocol";
import { Page, Xmark } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useNameOf } from "@/hooks/use-directory";
import { fetchSearch } from "@/lib/api";
import { roomName } from "@/lib/directs";
import { cn } from "@/lib/utils";
import { DIALOG, DIALOG_BACKDROP, DIALOG_CLOSE, DIALOG_TITLE } from "./unsaved-changes";

/** A file shared in a room, as the picker offers it. */
export interface SharedFile {
  file: StoredFile;
  /** Where it was shared, as the sidebar names the room. */
  roomLabel: string;
  sharedAt: string;
}

/** The files among `messages`, newest first as search lists them, each with where it was shared. */
export function sharedFiles(messages: Message[], rooms: Room[], meId: UserId, nameOf: Parameters<typeof roomName>[2]): SharedFile[] {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  return messages.flatMap(({ attachment, roomId, createdAt }) => {
    const room = byId.get(roomId);
    if (!attachment) return [];
    const roomLabel = !room ? "" : room.kind === "direct" ? roomName(room, meId, nameOf) : `#${room.name}`;
    return [{ file: attachment, roomLabel, sharedAt: createdAt }];
  });
}

interface Props {
  meId: UserId;
  /** Takes the markup that links the file picked. */
  onPick: (markup: string) => void;
  onClose: () => void;
}

/**
 * Files in Ember: the files shared in the rooms you're in, newest first, which typing narrows to those
 * whose names have the words typed, as a search for files finds them. Picking one answers the markup
 * that links it in what's written.
 */
export function FilesPicker({ meId, onPick, onClose }: Props) {
  const nameOf = useNameOf();
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [failed, setFailed] = useState(false);
  const fieldId = useId();

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
      <DialogContent showCloseButton={false} overlayClassName={DIALOG_BACKDROP} className={cn(DIALOG, "w-[520px]")}>
        <button type="button" aria-label="Close" onClick={onClose} className={DIALOG_CLOSE}>
          <Xmark className="size-[18px]" />
        </button>
        <DialogTitle className={cn(DIALOG_TITLE, "pe-10")}>Files in Ember</DialogTitle>
        <DialogDescription className="mb-3 text-sm text-muted-foreground">Link a file shared in one of your conversations.</DialogDescription>
        <label htmlFor={fieldId} className="sr-only">
          Search files
        </label>
        <input
          id={fieldId}
          type="search"
          autoComplete="off"
          placeholder="Search files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mb-2 h-10 w-full rounded-[9px] border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-selected-dark touch:h-11 touch:text-base"
        />
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
          <ul aria-label="Files" className="-mx-2 max-h-[50dvh] overflow-y-auto">
            {files.map((shared) => (
              <li key={shared.file.id}>
                <button
                  type="button"
                  onClick={() => onPick(fileLink(shared.file))}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-2 py-2 text-start hover:bg-hover touch:min-h-11"
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
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {[shared.roomLabel, new Date(shared.sharedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The markup that links `file` in what's written: its name, linked to its address on this server. */
export function fileLink(file: StoredFile, origin = location.origin): string {
  const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return `<a href="${escape(new URL(file.url, origin).href)}">${escape(file.name)}</a>`;
}
