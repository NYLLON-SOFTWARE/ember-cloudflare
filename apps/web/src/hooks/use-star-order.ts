import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type TouchEvent } from "react";
import type { Favorites, Me, RoomId } from "@ember/protocol";
import { useMounted } from "@/hooks/use-mounted";
import { isSignedOut, setFavoriteOrder } from "@/lib/api";
import { movedBefore } from "@/lib/room-list";

// A starred room's row moves as in ember-rust's channel_order_controller.js: held 400ms with a mouse, a
// pen or a finger, unless it moves 8px first, then dragged, the list scrolling 8px a frame while the
// pointer is within 64px of its top or bottom, and saved where it's let go. A click within 500ms of
// letting go is ignored, so a drop never opens the room.
const HOLD_MS = 400;
const STILL_PX = 8;
const EDGE_PX = 64;
const SCROLL_PX = 8;
const CLICK_GUARD_MS = 500;

/** What the list last said about moving a room: to screen readers, or on screen when a save failed. */
export interface OrderStatus {
  message: string;
  error: boolean;
}

/** A row held down, until it's let go, and whether it's being dragged yet. */
interface Press {
  roomId: RoomId;
  x: number;
  y: number;
  lastY: number;
  kind: "pointer" | "touch";
  dragging: boolean;
}

interface Point {
  clientX: number;
  clientY: number;
}

interface Options {
  favorites: Favorites;
  /** The rooms the list shows. Activity hides the rest, whose stars keep their places. */
  shown: ReadonlySet<RoomId>;
  /** The name a room's move is announced by. */
  nameOf: (roomId: RoomId) => string;
  /** Called with this person's stars as the server answers them, once an order is saved. */
  onSaved: (favorites: Favorites) => void;
  /** Called with null when the session has expired. */
  onSessionChanged: (me: Me | null) => void;
}

/** The room whose row `target` is in, if it's in one. */
const roomOf = (target: EventTarget | null) => (target instanceof Element ? (target.closest<HTMLElement>("[data-room-id]")?.dataset.roomId ?? null) : null);

const sameOrder = (a: RoomId[], b: RoomId[] | null) => b !== null && a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Reorders someone's starred rooms in the sidebar's list, by dragging a starred row or pressing Alt and
 * an arrow on one, as ember-rust's sidebar does. It answers the order to show their stars in: while a
 * row is dragged, the order it's been dragged to, and while an order saves, that order, until the
 * answer comes or news that the stars changed otherwise. A failed save puts the stars back as the server
 * last said they were, which is the order before the move unless they changed meanwhile.
 *
 * The list's element takes `listRef` and `listProps`, its rows carry `data-room-id`, and the element the
 * list scrolls in takes `scrollerRef`.
 */
export function useStarOrder({ favorites, shown, nameOf, onSaved, onSessionChanged }: Options) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<RoomId[] | null>(null);
  const [saving, setSaving] = useState<{ order: RoomId[]; version: number } | null>(null);
  const [moving, setMoving] = useState<RoomId | null>(null);
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const mounted = useMounted();

  // Pointers can move faster than the list draws, so what's pressed, the order it's been dragged to and
  // whether an order is saving are kept here too, as they are now rather than as last drawn.
  const press = useRef<Press | null>(null);
  const drafted = useRef<RoomId[] | null>(null);
  const saved = useRef(false);
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined);
  const frame = useRef(0);
  const clicksIgnoredUntil = useRef(0);
  const focusAfterMove = useRef<RoomId | null>(null);

  const order = draft ?? (saving?.version === favorites.version ? saving.order : favorites.rooms);
  // The rows that can move: starred ones the list shows.
  const movable = order.filter((id) => shown.has(id));

  const redraft = (next: RoomId[] | null) => {
    drafted.current = next;
    setDraft(next);
  };
  const rowOf = (roomId: RoomId) => listRef.current?.querySelector<HTMLElement>(`[data-room-id="${CSS.escape(roomId)}"]`) ?? null;

  function cleanUp() {
    clearTimeout(hold.current);
    cancelAnimationFrame(frame.current);
    press.current = null;
    setMoving(null);
  }

  /** Lets go of the row held, putting a dragged one back. */
  function cancel() {
    const dragged = press.current?.dragging;
    cleanUp();
    if (!dragged) return;
    clicksIgnoredUntil.current = Date.now() + CLICK_GUARD_MS;
    redraft(null);
    setStatus({ message: "Room move canceled.", error: false });
  }

  function start(roomId: RoomId, point: Point, kind: Press["kind"]) {
    if (saved.current || !movable.includes(roomId) || movable.length < 2) return;
    cancel();
    press.current = { roomId, x: point.clientX, y: point.clientY, lastY: point.clientY, kind, dragging: false };
    hold.current = setTimeout(() => latest.current.begin(), HOLD_MS);
  }

  function begin() {
    const pressed = press.current;
    if (!pressed || !movable.includes(pressed.roomId)) return cancel();
    pressed.dragging = true;
    setMoving(pressed.roomId);
    redraft(order);
    setStatus({ message: `Moving ${nameOf(pressed.roomId)}. Release to save, or press Escape to cancel.`, error: false });
    scroll();
  }

  function move(point: Point) {
    const pressed = press.current;
    if (!pressed) return;
    if (!pressed.dragging) {
      if (Math.hypot(point.clientX - pressed.x, point.clientY - pressed.y) > STILL_PX) cancel();
      return;
    }
    pressed.lastY = point.clientY;
    // The row goes before the first other one whose middle is below the pointer, or after every star.
    const before = movable.find((id) => {
      const box = id === pressed.roomId ? undefined : rowOf(id)?.getBoundingClientRect();
      return box !== undefined && point.clientY < box.top + box.height / 2;
    });
    const next = movedBefore(drafted.current ?? order, pressed.roomId, before ?? null);
    if (!sameOrder(next, drafted.current)) redraft(next);
  }

  function scroll() {
    const pressed = press.current;
    if (!pressed?.dragging) return;
    const scroller = scrollerRef.current;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const step = pressed.lastY < box.top + EDGE_PX ? -SCROLL_PX : pressed.lastY > box.bottom - EDGE_PX ? SCROLL_PX : 0;
      const before = scroller.scrollTop;
      scroller.scrollTop += step;
      // A pointer held still has the rows scroll past under it.
      if (scroller.scrollTop !== before) move({ clientX: pressed.x, clientY: pressed.lastY });
    }
    frame.current = requestAnimationFrame(() => latest.current.scroll());
  }

  /** Lets go of the row held, saving where a dragged one has been dragged to. */
  function finish() {
    const pressed = press.current;
    const dragged = drafted.current;
    if (!pressed) return;
    cleanUp();
    if (!pressed.dragging || !dragged) return;
    clicksIgnoredUntil.current = Date.now() + CLICK_GUARD_MS;
    rowOf(pressed.roomId)?.focus({ preventScroll: true });
    // A starred room that went meanwhile, deleted or no longer theirs, left the stars without news that
    // they changed, so the order saved leaves it out too.
    save(dragged.filter((id) => favorites.rooms.includes(id)));
  }

  async function save(next: RoomId[]) {
    saved.current = true;
    setSaving({ order: next, version: favorites.version });
    redraft(null);
    setStatus({ message: "Saving room order…", error: false });
    try {
      onSaved(await setFavoriteOrder(next));
      if (mounted.current) setStatus({ message: "Starred room order saved.", error: false });
    } catch (error) {
      // Once another person's workspace has taken this one's place, the session it hears about is gone.
      if (!mounted.current) return;
      if (isSignedOut(error)) return onSessionChanged(null);
      setStatus({ message: "Couldn’t save room order. Please try again.", error: true });
    } finally {
      saved.current = false;
      if (mounted.current) setSaving(null);
    }
  }

  /**
   * Alt and an arrow move the starred row focused past the one shown above or below it, and save, unless
   * a row is held down, whose drag saves where it's let go.
   */
  function onKeyDown(event: KeyboardEvent) {
    const roomId = roomOf(event.target);
    const up = event.key === "ArrowUp";
    if (!roomId || !movable.includes(roomId) || !event.altKey || (!up && event.key !== "ArrowDown")) return;
    event.preventDefault();
    if (saved.current || press.current) return;
    const neighbor = movable[movable.indexOf(roomId) + (up ? -1 : 1)];
    if (!neighbor) return;
    focusAfterMove.current = roomId;
    save(up ? movedBefore(order, roomId, neighbor) : movedBefore(order, neighbor, roomId));
  }

  // The hold's timer, the window's listeners and each frame of scrolling act on the newest of these.
  const latest = useRef({ begin, move, scroll, finish, cancel });
  useLayoutEffect(() => {
    latest.current = { begin, move, scroll, finish, cancel };
  });

  // A row moved with the keyboard keeps the focus wherever it's drawn.
  useLayoutEffect(() => {
    if (focusAfterMove.current === null) return;
    rowOf(focusAfterMove.current)?.focus({ preventScroll: true });
    focusAfterMove.current = null;
  });

  // News that the stars changed ends a hold or a drag, as it does in ember-rust's sidebar.
  useEffect(() => {
    if (press.current) latest.current.cancel();
  }, [favorites.version]);

  useEffect(() => {
    const pressedWith = (kind: Press["kind"]) => press.current?.kind === kind;
    const onPointerMove = (event: globalThis.PointerEvent) => {
      if (!pressedWith("pointer")) return;
      if (press.current?.dragging) event.preventDefault();
      latest.current.move(event);
    };
    const onPointerUp = () => pressedWith("pointer") && latest.current.finish();
    // Until a finger has held a row long enough, it scrolls the list as usual.
    const onTouchMove = (event: globalThis.TouchEvent) => {
      if (!pressedWith("touch") || !event.touches[0]) return;
      if (press.current?.dragging && event.cancelable) event.preventDefault();
      latest.current.move(event.touches[0]);
    };
    const onTouchEnd = () => pressedWith("touch") && latest.current.finish();
    const onCancel = () => latest.current.cancel();
    // Escape puts a dragged row back wherever the focus is, where ember-rust's list hears it only from
    // within, which a click doesn't move the focus to in Safari. Heard before anything else, it closes
    // nothing else, such as the drawer the list is in.
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !press.current?.dragging) return;
      event.preventDefault();
      latest.current.cancel();
    };
    window.addEventListener("keydown", onEscape, { capture: true });
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onCancel);
    return () => {
      window.removeEventListener("keydown", onEscape, { capture: true });
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onCancel);
      clearTimeout(hold.current);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const listProps = {
    onPointerDown: (event: PointerEvent) => {
      const roomId = roomOf(event.target);
      if (roomId && event.pointerType !== "touch" && event.button === 0) start(roomId, event, "pointer");
    },
    onTouchStart: (event: TouchEvent) => {
      const roomId = roomOf(event.target);
      if (event.touches.length !== 1) return cancel();
      if (roomId) start(roomId, event.touches[0]!, "touch");
    },
    onKeyDown,
    onClickCapture: (event: MouseEvent) => {
      if (Date.now() >= clicksIgnoredUntil.current || !roomOf(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    // A link dragged would otherwise go to the browser as a link.
    onDragStart: (event: MouseEvent) => event.preventDefault(),
    // A long press would otherwise open the link's menu over the drag.
    onContextMenu: (event: MouseEvent) => press.current?.dragging && event.preventDefault(),
  };

  return { order, moving, status, listRef, scrollerRef, listProps };
}
