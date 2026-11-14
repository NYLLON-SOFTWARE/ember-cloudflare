import { useMemo, useRef, useState } from "react";
import type { Me, RoomId, SharedRoom } from "@ember/protocol";
import { useMounted } from "@/hooks/use-mounted";
import { useRoomDrag, type OrderStatus } from "@/hooks/use-room-drag";
import { isSignedOut, setSharedOrder } from "@/lib/api";
import { inSidebarOrder } from "@/lib/room-list";
import { flattened, roomTree, type RoomBranch } from "@/lib/sub-rooms";

interface Options {
  /** The rooms in this administrator's sidebar, but their DMs, in any order. */
  rooms: SharedRoom[];
  /** The ones of them the shared order ranks, in its order. */
  sharedOrder: RoomId[];
  /** Called with the rooms of theirs the shared order ranks, as the server answers them, once an order is saved. */
  onSaved: (sharedOrder: RoomId[]) => void;
  /** Called with null when the session has expired. */
  onSessionChanged: (me: Me | null) => void;
}

const sameOrder = (a: RoomId[], b: RoomId[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** `staged` without the rooms that aren't in `rooms` any more, and then the ones in it that weren't yet. */
function stillStaged(staged: RoomId[], rooms: RoomId[]): RoomId[] {
  const now = new Set(rooms);
  const kept = staged.filter((id) => now.has(id));
  const listed = new Set(kept);
  return [...kept, ...rooms.filter((id) => !listed.has(id))];
}

/** `order`, the ids of `rooms`, as a tree one level deep, each room's sub-rooms under it in their order. */
function treeOf(rooms: SharedRoom[], order: RoomId[]): RoomBranch<SharedRoom>[] {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  return roomTree(order.flatMap((id) => byId.get(id) ?? []));
}

/**
 * The order an administrator puts their rooms in for everyone, staged on workspace settings (`staged`):
 * a row is dragged at once by its handle, or moved with Alt and an arrow (`useRoomDrag`), and each move
 * is only staged until Save order saves the whole list as the shared order, or Cancel puts it back as
 * saved. The rooms the shared order doesn't rank come after the rest, by name, as they do in the
 * sidebar. A room that comes or goes meanwhile joins or leaves what's staged, at its end. Sub-rooms move
 * with their parent, and among their parent's other sub-rooms, each parent's in a list of its own
 * (`subRoomDrag`), and the order saved lists each parent's after it.
 */
export function useSharedOrder({ rooms, sharedOrder, onSaved, onSessionChanged }: Options) {
  const [staged, setStaged] = useState<RoomId[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const mounted = useMounted();
  // The save under way, as it is now rather than as last drawn, which saving again waits for.
  const saved = useRef<Promise<boolean> | null>(null);

  const savedOrder = useMemo(() => flattened(roomTree(inSidebarOrder(rooms, [], sharedOrder))), [rooms, sharedOrder]);
  const order = useMemo(() => flattened(treeOf(rooms, staged ? stillStaged(staged, savedOrder) : savedOrder)), [rooms, staged, savedOrder]);
  const tree = useMemo(() => treeOf(rooms, order), [rooms, order]);
  const changed = !sameOrder(order, savedOrder);
  const nameOf = (roomId: RoomId) => rooms.find((room) => room.id === roomId)?.name ?? "";

  /** What a list of rows, the rooms' or a parent's sub-rooms', says as its rows move, staging the order they're moved to. */
  const moves = (stage: (moved: RoomId[]) => RoomId[]) => ({
    holdMs: 0,
    grabs: (target: Element) => target.closest("[data-room-order-handle]") !== null,
    isLocked: () => saved.current !== null,
    onDrag: (roomId: RoomId) => setStatus({ message: `Moving ${nameOf(roomId)}. Release to place, or press Escape to cancel.`, error: false }),
    onMove: (moved: RoomId[]) => {
      setStaged(stage(moved));
      setStatus({ message: "Unsaved room order. Save to apply it to everyone.", error: false });
    },
    onCancel: () => setStatus({ message: "Room move canceled.", error: false }),
  });

  const topIds = tree.map((branch) => branch.room.id);
  const subRoomsOf = new Map(tree.map((branch) => [branch.room.id, branch.subRooms.map((sub) => sub.id)]));
  // A parent's row carries its sub-rooms with it.
  const drag = useRoomDrag({ order: topIds, movable: topIds, ...moves((moved) => moved.flatMap((id) => [id, ...(subRoomsOf.get(id) ?? [])])) });

  /** What `useRoomDrag` takes for parent `parentId`'s list of sub-rooms, whose moves stay among them. */
  const subRoomDrag = (parentId: RoomId) => {
    const subRoomIds = subRoomsOf.get(parentId) ?? [];
    return {
      order: subRoomIds,
      movable: subRoomIds,
      ...moves((moved) => order.filter((id) => !subRoomIds.includes(id)).flatMap((id) => (id === parentId ? [id, ...moved] : [id]))),
    };
  };

  /**
   * Saves the order staged as the shared order, putting back a row being dragged, so what's saved is what
   * shows, and settles with whether it's saved, waiting for a save already under way rather than saving again.
   */
  function save(): Promise<boolean> {
    if (saved.current) return saved.current;
    if (!changed) return Promise.resolve(true);
    drag.release();
    setSaving(true);
    setStatus({ message: "Saving room order…", error: false });
    saved.current = send().finally(() => {
      saved.current = null;
      if (mounted.current) setSaving(false);
    });
    return saved.current;
  }

  /** Sends the order staged, saying how that went, and settles with whether it's saved. */
  async function send(): Promise<boolean> {
    try {
      onSaved(await setSharedOrder(order));
      if (mounted.current) {
        setStaged(null);
        setStatus({ message: "Room order saved for everyone.", error: false });
      }
      return true;
    } catch (error) {
      // Once another person's workspace has taken this one's place, the session it hears about is gone.
      if (!mounted.current) return false;
      if (isSignedOut(error)) onSessionChanged(null);
      else setStatus({ message: "Couldn’t save room order. Please try again.", error: true });
      return false;
    }
  }

  /** Puts the rows back in the order saved, a row being dragged included. */
  function reset() {
    if (saved.current) return;
    drag.release();
    setStaged(null);
    setStatus(null);
  }

  // While a parent's row is dragged, the tree shows it where it's been dragged to.
  const shownTree = drag.order.flatMap((id) => tree.find((branch) => branch.room.id === id) ?? []);
  return { tree: shownTree, subRoomDrag, moving: drag.moving, status, changed, saving, listRef: drag.listRef, listProps: drag.listProps, save, reset };
}
