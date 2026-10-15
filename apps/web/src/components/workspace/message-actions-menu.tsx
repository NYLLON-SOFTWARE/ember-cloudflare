import { useContext, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { QUICK_REACTION_COUNT, REACTIONS, type Message } from "@ember/protocol";
import type { DisplayNode } from "@ember/richtext/dom";
import { Ellipsis, FaceSlightlySmilingPlus, Link, Pencil, Reply } from "@/components/icons/lucide";
import { PeopleContext, useNameOf } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { messagePath } from "@/hooks/use-route";
import { replyQuote } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { UNKNOWN_PERSON } from "./message-body";

/** With a mouse, the bar overlaps its message, as ember-rust's `.mb-message-actions--overlapping` does. */
const OVERLAPPING = "(hover: hover) and (pointer: fine)";

/** How long a bar that hovering opened stays after the pointer leaves it, so the pointer can cross to it. */
const LEAVE_DELAY_MS = 180;

/** The open bar, which closes as another opens, so only one is open at a time. */
let openBar: { close(): void } | null = null;

/**
 * The bar's buttons (zz-ember.css, `.mb-message-actions-menu .message__action-btn`): 32px, with 16px
 * icons. For fingers they're 44px, as Ember's controls are, where ember-rust's are 34px wide.
 */
const ACTION =
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[0.8rem] font-medium text-message-muted transition-colors duration-150 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground touch:size-11 [&_svg]:size-4";

/** The bar and the tray of more reactions (`.mb-message-action-bar`, `.mb-message-reaction-tray`). */
const PANEL = "rounded-[11px] border border-message-border bg-background shadow-[0_1px_3px_#0000001a]";

/** Campfire's `btn--success` (buttons.css) in ember-rust's colors: Copy link turns green as it copies. */
const COPIED = ["text-positive", "motion-safe:animate-success"];

interface Props {
  message: Message;
  /** What the message shows, which Reply quotes. */
  nodes: DisplayNode[];
  /** The message's row: hovering it opens the bar with a mouse, and the bar overlaps its top edge. */
  row: RefObject<HTMLElement | null>;
  /** Whether Edit shows: on your own messages, and on everyone's for administrators. */
  editable: boolean;
  onReact: (emoji: string) => void;
  /** Writes a reply in the composer, given the quote it starts with. */
  onReply: (quote: string) => void;
  onEdit: () => void;
}

/**
 * ember-rust's message actions (messages/_actions.html, message_actions_controller.js, zz-ember.css):
 * Message options, which opens a bar of three quick reactions, Reply, Copy link, Edit and More reactions,
 * whose tray holds the other reactions. With a mouse, hovering the message opens the bar too, laid over
 * the message's top edge at the timeline's right, with Message options pinned as its last button. On
 * touch screens it opens beside Message options. Once opened, the bar stays in the page while it's
 * shut, as ember-rust's does, so Copy link keeps its color.
 */
export function MessageActionsMenu({ message, nodes, row, editable, onReact, onReply, onEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [rendered, setRendered] = useState(false);
  // Whether hovering opened the bar, which leaving then closes, unless Message options pinned it.
  const hoverOpened = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const overlapping = useMediaQuery(OVERLAPPING);
  const menuId = useId();
  const trayId = useId();

  const show = (byHovering: boolean) => {
    hoverOpened.current = byHovering;
    setRendered(true);
    setOpen(true);
  };

  const close = () => {
    clearTimeout(leaveTimer.current);
    hoverOpened.current = false;
    setOpen(false);
    setTrayOpen(false);
  };

  // As ember-rust's bar closes once a reaction is sent (messages/_reaction.html), handing focus to Message options.
  const closeAfterReacting = () => {
    close();
    trigger.current?.focus({ preventScroll: true });
  };

  const react = (emoji: string) => {
    onReact(emoji);
    closeAfterReacting();
  };

  // Reply and Edit close the bar too, as their `message-actions#close` does, and take focus themselves.
  const reply = (quote: string) => {
    close();
    onReply(quote);
  };

  const edit = () => {
    close();
    onEdit();
  };

  const toggle = () => {
    if (!open) return show(false);
    if (!hoverOpened.current) return close();
    // Clicking Message options pins a bar that hovering opened, rather than closing it.
    hoverOpened.current = false;
    clearTimeout(leaveTimer.current);
  };

  const place = () => {
    // The bar can leave the page, with its message or as the message's editor opens, a moment before what
    // watches the page for it stops.
    if (!open || !container.current) return;
    if (!placeMenu({ row: row.current!, container: container.current, trigger: trigger.current!, menu: menu.current!, bar: bar.current!, tray: tray.current!, overlapping })) close();
  };

  const hovered = useEffectEvent((event: PointerEvent) => {
    if (event.pointerType === "touch" || !matchMedia(OVERLAPPING).matches) return;
    clearTimeout(leaveTimer.current);
    if (!open) show(true);
  });

  const left = useEffectEvent(() => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      if (hoverOpened.current && !container.current?.matches(":focus-within") && !row.current?.matches(":hover")) close();
    }, LEAVE_DELAY_MS);
  });

  useEffect(() => {
    const element = row.current!;
    const enter = (event: PointerEvent) => hovered(event);
    const leave = () => left();
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    // The bar comes back as its message's editor shuts, maybe under a pointer that never left the message
    // and so won't enter it, so the pointer's first move over the message opens it too.
    element.addEventListener("pointermove", enter, { once: true });
    return () => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("pointermove", enter);
      clearTimeout(leaveTimer.current);
    };
  }, [row]);

  const clickedElsewhere = useEffectEvent((event: Event) => {
    if (!container.current?.contains(event.target as Node)) close();
  });

  // Focus leaving the bar closes it. ember-rust's closes as focus lands anywhere else, but here that would
  // shut a bar the pointer opened as the composer, ready a moment after the messages show, takes focus.
  const focusLeft = useEffectEvent((event: FocusEvent) => {
    if (event.relatedTarget && !container.current?.contains(event.relatedTarget as Node)) close();
  });

  // Escape closes the tray first, handing focus to More reactions, then the bar, handing it to Message
  // options. While you're elsewhere, as in the composer under a bar the pointer opened, it only closes
  // the bar, where ember-rust's takes your focus to Message options.
  const keyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (!container.current?.contains(document.activeElement)) return close();
    event.preventDefault();
    if (trayOpen) {
      setTrayOpen(false);
      more.current?.focus({ preventScroll: true });
    } else {
      close();
      trigger.current?.focus({ preventScroll: true });
    }
  });

  const moved = useEffectEvent(() => place());
  const closedElsewhere = useEffectEvent(() => close());

  // Only the open bar watches the page: a click or Escape elsewhere, focus leaving it, and anything that moves it.
  useEffect(() => {
    if (!open) return;
    const self = { close: () => closedElsewhere() };
    openBar?.close();
    openBar = self;
    const events = new AbortController();
    const options = { signal: events.signal };
    document.addEventListener("click", (event) => clickedElsewhere(event), options);
    container.current!.addEventListener("focusout", (event) => focusLeft(event), options);
    document.addEventListener("keydown", (event) => keyDown(event), options);
    document.addEventListener("scroll", () => moved(), { ...options, capture: true, passive: true });
    window.addEventListener("resize", () => moved(), options);
    window.visualViewport?.addEventListener("resize", () => moved(), options);
    const resized = new ResizeObserver(() => moved());
    resized.observe(menu.current!);
    // Messages above can change or go without anything scrolling, as when someone reacts to one, moving the row.
    const changed = new MutationObserver(() => moved());
    const timeline = row.current!.closest('[role="log"]');
    if (timeline) changed.observe(timeline, { childList: true, characterData: true, subtree: true });
    return () => {
      if (openBar === self) openBar = null;
      events.abort();
      resized.disconnect();
      changed.disconnect();
    };
  }, [open]);

  // Placed before it's painted, and again as the tray opens or shuts.
  useLayoutEffect(place, [open, trayOpen, overlapping]);

  const pinned = open && overlapping;

  return (
    <div ref={container} className="contents">
      <button
        ref={trigger}
        type="button"
        aria-label="Message options"
        aria-expanded={open}
        aria-controls={rendered ? menuId : undefined}
        onClick={toggle}
        className={cn(
          "flex size-8 cursor-pointer items-center justify-center rounded-[9px] text-[0.8rem] font-medium text-message-muted hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground touch:size-11 [&_svg]:size-4",
          // Campfire's messages.css: hidden until the message is hovered or holds focus, fading in after a
          // moment with a mouse, and half shown for fingers.
          "opacity-0 touch:opacity-50 group-hover/message:opacity-100! group-focus-within/message:opacity-100! aria-expanded:opacity-100!",
          "[@media(hover:hover)_and_(pointer:fine)]:transition-opacity [@media(hover:hover)_and_(pointer:fine)]:delay-150 [@media(hover:hover)_and_(pointer:fine)]:duration-150 [@media(hover:hover)_and_(pointer:fine)]:ease-in-out",
          // `.message__options-btn` (zz-ember.css): at the top right of the message's text, 6px further out
          // for fingers. With a mouse, the open bar keeps room for it as its last button.
          pinned
            ? "fixed top-(--trigger-top) left-(--trigger-left) z-31"
            : "absolute -top-1.5 right-5 max-md:right-3 touch:-top-[11px] touch:translate-x-1.5",
        )}
      >
        <Ellipsis />
      </button>
      {rendered && (
        <div
          ref={menu}
          id={menuId}
          role="group"
          aria-label="Message actions"
          hidden={!open}
          onPointerEnter={() => clearTimeout(leaveTimer.current)}
          onPointerLeave={() => left()}
          className="group/menu fixed z-30 grid w-max min-w-0 gap-[7px]"
        >
          <div ref={bar} className={cn(PANEL, "flex flex-wrap items-center p-1", overlapping && "pr-9 touch:pr-12")}>
            <div role="group" aria-label="Quick reactions" className="flex flex-wrap">
              {REACTIONS.slice(0, QUICK_REACTION_COUNT).map(([emoji, title]) => (
                <Reaction key={emoji} emoji={emoji} title={title} onClick={() => react(emoji)} />
              ))}
            </div>
            <ReplyButton message={message} nodes={nodes} onClick={reply} />
            <button type="button" title="Copy link" aria-label="Copy link" className={ACTION} onClick={(event) => void copyLink(event, message)}>
              <Link />
            </button>
            {/* As ember-rust's `.message__edit-btn` shows (Campfire's messages.css). */}
            {editable && (
              <button type="button" title="Edit" aria-label="Edit" className={ACTION} onClick={edit}>
                <Pencil />
              </button>
            )}
            <button
              ref={more}
              type="button"
              title="More reactions"
              aria-label="More reactions"
              aria-expanded={trayOpen}
              aria-controls={trayId}
              className={cn(ACTION, "aria-expanded:bg-hover")}
              onClick={() => setTrayOpen((shown) => !shown)}
            >
              <FaceSlightlySmilingPlus />
            </button>
          </div>
          <div
            ref={tray}
            id={trayId}
            role="group"
            aria-label="More reactions"
            hidden={!trayOpen}
            className={cn(PANEL, "w-max max-w-full justify-self-end overflow-y-auto overscroll-contain p-2 group-data-[tray-above]/menu:-order-1")}
          >
            <span className="mx-[3px] mb-[5px] block text-[11px] leading-normal font-medium text-muted-foreground">More reactions</span>
            <div className="flex flex-wrap">
              {REACTIONS.slice(QUICK_REACTION_COUNT).map(([emoji, title]) => (
                <Reaction key={emoji} emoji={emoji} title={title} onClick={() => react(emoji)} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One of the reactions (messages/_reaction.html): the emoji, named by its title. */
function Reaction({ emoji, title, onClick }: { emoji: string; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} className={ACTION} onClick={onClick}>
      <span aria-hidden className="text-[1.3rem] leading-normal">
        {emoji}
      </span>
      <span className="sr-only">{title}</span>
    </button>
  );
}

/**
 * Reply, which reads the people directory only while the bar's in the page, so a change to the
 * directory doesn't render every message's actions again.
 */
function ReplyButton({ message, nodes, onClick }: { message: Message; nodes: DisplayNode[]; onClick: (quote: string) => void }) {
  const people = useContext(PeopleContext);
  const nameOf = useNameOf();
  const reply = () => {
    const link = new URL(messagePath(message.roomId, message.id), document.baseURI).href;
    onClick(replyQuote(nodes, nameOf(message.creator), link, (userId) => people.get(userId)?.name ?? UNKNOWN_PERSON));
  };
  return (
    <button type="button" title="Reply" aria-label="Reply" className={ACTION} onClick={reply}>
      <Reply />
    </button>
  );
}

/**
 * Copies the message's address, then turns Copy link green and plays its success animation from the
 * start, as ember-rust's copy_to_clipboard_controller.js does. It stays green until it's clicked again,
 * and a clipboard that refuses leaves it as it was.
 */
async function copyLink({ currentTarget: button }: MouseEvent<HTMLButtonElement>, message: Message) {
  button.classList.remove(...COPIED);
  // Reading the layout ends the last run of the animation, so adding the classes starts it again.
  void button.offsetWidth;
  try {
    // Pages carry only the path, made absolute against the page, as ember-rust's do.
    await navigator.clipboard.writeText(new URL(messagePath(message.roomId, message.id), document.baseURI).href);
    button.classList.add(...COPIED);
  } catch {
    // Nothing to show.
  }
}

interface Placed {
  row: HTMLElement;
  container: HTMLElement;
  trigger: HTMLElement;
  menu: HTMLElement;
  bar: HTMLElement;
  tray: HTMLElement;
  overlapping: boolean;
}

/**
 * Places an open bar as ember-rust's message_actions_controller.js#position does, within the timeline
 * less 8px on each side, and within what's on screen. With a mouse, it overlaps the row, its top 17px
 * above the row's and its right 16px in from the timeline's, with Message options pinned as its last
 * button, and the tray opens below it, or above when there's more room there. For fingers, it opens 6px
 * below Message options, lined up with its right edge, or above when it doesn't fit, or to its left when
 * it fits neither. Answers false, placing nothing, once the row is out of the timeline's sight, when the
 * bar should close.
 */
function placeMenu({ row, container, trigger, menu, bar, tray, overlapping }: Placed): boolean {
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop || 0;
  const left = viewport?.offsetLeft || 0;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const timeline = row.closest('[role="log"]')?.getBoundingClientRect();
  const bounds = {
    left: Math.max(left, timeline?.left ?? left) + 8,
    right: Math.min(left + width, timeline?.right ?? left + width) - 8,
    top: Math.max(top, timeline?.top ?? top) + 8,
    bottom: Math.min(top + height, timeline?.bottom ?? top + height) - 8,
  };
  const triggerBox = trigger.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  if (rowBox.bottom < bounds.top || rowBox.top > bounds.bottom) return false;
  menu.style.maxWidth = `${Math.max(0, bounds.right - bounds.left)}px`;
  tray.style.maxHeight = "";
  let menuBox = menu.getBoundingClientRect();
  let y: number;
  let right: number;
  let barTop = 0;
  let barHeight = 0;
  if (overlapping) {
    barHeight = bar.getBoundingClientRect().height;
    // Overlapping the row by more than half the bar leaves the pointer a way across to it.
    barTop = Math.max(bounds.top, Math.min(rowBox.top - 17, bounds.bottom - barHeight));
    const below = bounds.bottom - barTop - barHeight;
    const above = barTop - bounds.top;
    const trayAbove = !tray.hidden && menuBox.height - barHeight > below && above > below;
    menu.toggleAttribute("data-tray-above", trayAbove);
    if (!tray.hidden) {
      tray.style.maxHeight = `${Math.max(0, (trayAbove ? above : below) - 7)}px`;
      menuBox = menu.getBoundingClientRect();
    }
    // Opening the tray mustn't move the bar off its row or out from under the pointer.
    y = trayAbove ? barTop - (menuBox.height - barHeight) : barTop;
    right = bounds.right - 8;
  } else {
    menu.removeAttribute("data-tray-above");
    const below = triggerBox.bottom + 6;
    const above = triggerBox.top - menuBox.height - 6;
    right = triggerBox.right;
    if (below + menuBox.height <= bounds.bottom) y = below;
    else if (above >= bounds.top) y = above;
    else {
      // With room neither below nor above, as on a phone held sideways with the tray open, it opens to the
      // left of Message options, where ember-rust's covers it.
      y = Math.max(bounds.top, Math.min(triggerBox.top, bounds.bottom - menuBox.height));
      right = triggerBox.left - 6;
    }
  }
  const x = Math.max(bounds.left, Math.min(right - menuBox.width, bounds.right - menuBox.width));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  if (overlapping) {
    // Inside the bar's border and padding, at its right end.
    container.style.setProperty("--trigger-left", `${x + menuBox.width - 5 - triggerBox.width}px`);
    container.style.setProperty("--trigger-top", `${barTop + (barHeight - triggerBox.height) / 2}px`);
  }
  return true;
}
