import { useEffect, useId, useState } from "react";
import { subRoomName, type SharedRoom } from "@ember/protocol";
import { Trash } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { deleteRoom, fetchRoomsElsewhere } from "@/lib/api";
import { useConfirm } from "./confirm-dialog";
import { SLOT_CONTROL } from "./room-order";
import { confirmDelete, roomLabel } from "./room-settings-page";

/**
 * Under Room order, for an administrator, the rooms they aren't in, private ones others made, each with
 * Delete, as Slack's workspace admins can delete any channel. Nothing shows while there are none.
 */
export function RoomsElsewhere({ onFailed }: { onFailed: (error: unknown) => void }) {
  const [rooms, setRooms] = useState<SharedRoom[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmFirst, confirmation] = useConfirm();
  const headingId = useId();

  useEffect(() => {
    let stopped = false;
    fetchRoomsElsewhere().then(
      (rooms) => !stopped && setRooms(rooms),
      (error: unknown) => !stopped && onFailed(error),
    );
    return () => void (stopped = true);
  }, [onFailed]);

  const remove = async (room: SharedRoom) => {
    const asked = confirmDelete(roomLabel({ name: subRoomName(room), open: room.kind === "open" }));
    if (!(await confirmFirst(asked.title, { body: asked.body, confirm: "Delete", destructive: true }))) return;
    setDeleting(room.id);
    deleteRoom(room.id).then(
      () => setRooms((rooms) => rooms && rooms.filter((r) => r.id !== room.id)),
      onFailed,
    ).finally(() => setDeleting(null));
  };

  if (!rooms || rooms.length === 0) return confirmation;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        Rooms you’re not in
      </h3>
      <ul className="border-t">
        {rooms.map((room) => (
          <li key={room.id} className="flex min-h-[52px] items-center gap-2.5 border-b py-1 pr-3 pl-3">
            <RoomIcon icon={room.icon} closed={room.kind === "closed"} size={19} className="w-[18px] shrink-0 text-center text-[22px] leading-none text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{subRoomName(room)}</span>
            <button type="button" aria-label={`Delete ${subRoomName(room)}`} title="Delete" disabled={deleting !== null} onClick={() => void remove(room)} className={SLOT_CONTROL}>
              <Trash className="size-[18px]" />
            </button>
          </li>
        ))}
      </ul>
      {confirmation}
    </section>
  );
}
