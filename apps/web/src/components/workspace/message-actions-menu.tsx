import { useContext, useEffect, useEffectEvent, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type MouseEvent, type Ref, type RefObject } from "react";
import { QUICK_REACTION_COUNT, REACTIONS, type Message, type StoredFile } from "@ember/protocol";
import type { DisplayNode } from "@ember/richtext/dom";
import { Copy, Download, Ellipsis, FaceSlightlySmilingPlus, Link, MessageCirclePlus, Pencil, Reply, Share, Trash } from "@/components/icons/lucide";
import { ShareButton } from "@/components/share-button";
import { mentionedPerson, PeopleContext, useNameOf } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { messagePath } from "@/hooks/use-route";
import { replyQuote } from "@/lib/messages";
import { canShare } from "@/lib/share";
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

/** An item of More actions: its icon, as the bar draws it, then its name, the panel's whole width. */
const ITEM =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-left text-sm whitespace-nowrap text-message-ink transition-colors duration-150 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground touch:h-11 [&_svg]:size-4 [&_svg]:shrink-0";

/** Campfire's `btn--success` (buttons.css) in ember-rust's colors: Copy link turns green as it copies. */
const COPIED = ["text-positive", "motion-safe:animate-success"];

interface Props {
  message: Message;
  /** What the message shows, which Reply quotes. */
  nodes: DisplayNode[];
  /** The message's row: hovering it opens the bar with a mouse, and the bar overlaps its top edge. */
  row: RefObject<HTMLElement | null>;
  /** Whether Edit and Delete message show: on your own messages, and on everyone's for administrators. */
  editable: boolean;
  onReact: (emoji: string) => void;
  /** Writes a reply in the composer, given the quote it starts with. */
  onReply: (quote: string) => void;
  onEdit: () => void;
  /** Deletes the message, from More actions, answering whether the deletion was sent. */
  onDelete: () => boolean;
  /** Opens the message's Custom reaction form, from New boost. */
  onNewBoost: () => void;
  ref?: Ref<MessageActionsHandle>;
}

export interface MessageActionsHandle {
  /**
   * Opens the bar with More reactions showing and focuses the first of them, as Add a boost does.
   * Clicking `from` again leaves the bar open, and Escape hands focus back to it.
   */
  openReactions: (from: HTMLElement) => void;
  /** Focuses Message options, as sending a reaction does. */
  focus: () => void;
}

/**
 * ember-rust's message actions (messages/_actions.html, message_actions_controller.js, zz-ember.css):
 * Message options, which opens a bar of three quick reactions, Reply, or a file message's Download, Copy
 * link, Edit and More reactions, whose tray holds the other reactions and New boost. With a mouse, hovering the message opens the bar
 * too, laid over the message's top edge at the timeline's right, with Message options pinned as its last
 * button. On touch screens it opens beside Message options. Once opened, the bar stays in the page while
 * it's shut, as ember-rust's does, so Copy link keeps its color.
 *
 * With a mouse, Message options then opens More actions under the bar, as Slack's does: Copy text, Copy
 * link, and on messages you can change, Edit message and Delete message. ember-rust has no such menu, and
 * clicking its Message options there only keeps the bar open, which shows nothing.
 */
export function MessageActionsMenu({ message, nodes, row, editable, onReact, onReply, onEdit, onDelete, onNewBoost, ref }: Props) {
  const [open, setOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [rendered, setRendered] = useState(false);
  // Whether hovering opened the bar, which leaving then closes, unless Message options pinned it.
  const hoverOpened = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The Add a boost that opened the bar, if one did, and whether its first reaction is still to be focused.
  const boostTrigger = useRef<HTMLElement | null>(null);
  const focusingTray = useRef(false);
  // Whether More actions' first item is still to be focused, as it opens.
  const focusingActions = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const actionsPanel = useRef<HTMLDivElement>(null);
  const overlapping = useMediaQuery(OVERLAPPING);
  const menuId = useId();
  const trayId = useId();
  // What Copy text copies: the message's plain text, which holds a bot's cards' too. A file message has none
  // but its file's name.
  const text = message.attachment ? null : message.plainText;

  const show = (byHovering: boolean) => {
    hoverOpened.current = byHovering;
    setRendered(true);
    setOpen(true);
  };

  const close = () => {
    clearTimeout(leaveTimer.current);
    hoverOpened.current = false;
    boostTrigger.current = null;
    setOpen(false);
    setTrayOpen(false);
    setActionsOpen(false);
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

  // New boost closes the bar too, and the form it opens takes focus.
  const newBoost = () => {
    close();
    onNewBoost();
  };

  // Delete message asks first, as the editor's does. The composer takes focus as the message goes, or Message
  // options does where the deletion can't be sent.
  const deleteMessage = () => {
    if (!confirm("Are you sure you want to delete this message?")) return;
    close();
    if (!onDelete()) trigger.current?.focus({ preventScroll: true });
  };

  const focusFirstReaction = () => {
    focusingTray.current = false;
    tray.current?.querySelector("button")?.focus({ preventScroll: true });
  };

  const focusFirstAction = () => {
    focusingActions.current = false;
    actionsPanel.current?.querySelector("button")?.focus({ preventScroll: true });
  };

  // The tray and More actions open in the same place, under the bar, so one shuts as the other opens.
  const toggleTray = () => {
    setActionsOpen(false);
    setTrayOpen((shown) => !shown);
  };

  // Opening More actions keeps the bar open, as clicking Message options alone does in ember-rust.
  const toggleActions = () => {
    clearTimeout(leaveTimer.current);
    hoverOpened.current = false;
    focusingActions.current = !actionsOpen;
    setTrayOpen(false);
    setActionsOpen(!actionsOpen);
  };

  useImperativeHandle(ref, () => ({
    // As the controller's click on `.message__boost-inline .boost__action` does.
    openReactions: (from) => {
      clearTimeout(leaveTimer.current);
      hoverOpened.current = false;
      boostTrigger.current = from;
      focusingTray.current = true;
      setRendered(true);
      setOpen(true);
      setActionsOpen(false);
      setTrayOpen(true);
      // An open bar with its tray showing doesn't render again, so its reaction is focused here.
      if (open && trayOpen) focusFirstReaction();
    },
    focus: () => trigger.current?.focus({ preventScroll: true }),
  }));

  const toggle = () => {
    if (!open) return show(false);
    // With a mouse, Message options is the open bar's last button, and opens More actions.
    if (overlapping) return toggleActions();
    close();
  };

  const place = () => {
    // The bar can leave the page, with its message or as the message's editor opens, a moment before what
    // watches the page for it stops.
    if (!open || !container.current) return;
    // Add a boost goes if the message's last reaction does while the bar is open.
    const anchor = boostTrigger.current?.isConnected ? boostTrigger.current : trigger.current!;
    const panel = actionsOpen ? actionsPanel.current! : tray.current!;
    if (!placeMenu({ row: row.current!, container: container.current, trigger: trigger.current!, anchor, menu: menu.current!, bar: bar.current!, panel, overlapping })) close();
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
    const target = event.target as Node;
    if (!container.current?.contains(target) && !boostTrigger.current?.contains(target)) close();
  });

  // Focus leaving the bar closes it. ember-rust's closes as focus lands anywhere else, but here that would
  // shut a bar the pointer opened as the composer, ready a moment after the messages show, takes focus.
  const focusLeft = useEffectEvent((event: FocusEvent) => {
    if (event.relatedTarget && !container.current?.contains(event.relatedTarget as Node)) close();
  });

  // Escape closes a bar Add a boost opened, handing focus back to it. Otherwise it closes the tray first,
  // handing focus to More reactions, or More actions, handing it to Message options, then the bar, handing
  // it to Message options. While you're elsewhere, as in the composer under a bar the pointer opened, it
  // only closes the bar, where ember-rust's takes your focus to Message options.
  const keyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const from = boostTrigger.current;
    if (from) {
      event.preventDefault();
      close();
      return (from.isConnected ? from : trigger.current)?.focus({ preventScroll: true });
    }
    if (!container.current?.contains(document.activeElement)) return close();
    event.preventDefault();
    if (trayOpen) {
      setTrayOpen(false);
      more.current?.focus({ preventScroll: true });
    } else if (actionsOpen) {
      setActionsOpen(false);
      trigger.current?.focus({ preventScroll: true });
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

  // Placed before it's painted, and again as the tray or More actions opens or shuts.
  useLayoutEffect(() => {
    place();
    if (open && trayOpen && focusingTray.current) focusFirstReaction();
    if (open && actionsOpen && focusingActions.current) focusFirstAction();
  }, [open, trayOpen, actionsOpen, overlapping]);

  const pinned = open && overlapping;

  return (
    <div ref={container} className="contents">
      <button
        ref={trigger}
        type="button"
        aria-label="Message options"
        aria-expanded={open}
        aria-controls={rendered ? menuId : undefined}
        // As the bar's last button, it's named for what it opens, as the bar's other buttons are.
        title={pinned ? "More actions" : undefined}
        onClick={toggle}
        className={cn(
          "flex size-8 cursor-pointer items-center justify-center rounded-[9px] text-[0.8rem] font-medium text-message-muted hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground touch:size-11 [&_svg]:size-4",
          // Campfire's messages.css: hidden until the message is hovered or holds focus, fading in after a
          // moment with a mouse, and half shown for fingers.
          "opacity-0 touch:opacity-50 group-hover/message:opacity-100! group-focus-within/message:opacity-100! aria-expanded:opacity-100!",
          "[@media(hover:hover)_and_(pointer:fine)]:transition-opacity [@media(hover:hover)_and_(pointer:fine)]:delay-150 [@media(hover:hover)_and_(pointer:fine)]:duration-150 [@media(hover:hover)_and_(pointer:fine)]:ease-in-out",
          // `.message__options-btn` (zz-ember.css): at the top right of the message's text, 6px further out
          // for fingers. With a mouse, the open bar keeps room for it as its last button, which stays shaded
          // while More actions is open, as More reactions does while its tray is.
          pinned
            ? "fixed top-(--trigger-top) left-(--trigger-left) z-31"
            : "absolute -top-1.5 right-5 max-md:right-3 touch:-top-[11px] touch:translate-x-1.5",
          pinned && actionsOpen && "bg-hover",
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
            {message.attachment ? (
              <FileActions file={message.attachment} />
            ) : (
              <ReplyButton message={message} nodes={nodes} onClick={reply} />
            )}
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
              onClick={toggleTray}
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
            className={cn(PANEL, "w-max max-w-full justify-self-end overflow-y-auto overscroll-contain p-2 group-data-[panel-above]/menu:-order-1")}
          >
            <span className="mx-[3px] mb-[5px] block text-[11px] leading-normal font-medium text-muted-foreground">More reactions</span>
            <div className="flex flex-wrap">
              {REACTIONS.slice(QUICK_REACTION_COUNT).map(([emoji, title]) => (
                <Reaction key={emoji} emoji={emoji} title={title} onClick={() => react(emoji)} />
              ))}
              <button type="button" title="New boost" className={ACTION} onClick={newBoost}>
                <MessageCirclePlus />
                <span className="sr-only">New boost</span>
              </button>
            </div>
          </div>
          <div
            ref={actionsPanel}
            role="group"
            aria-label="More actions"
            hidden={!actionsOpen}
            className={cn(PANEL, "w-max max-w-full justify-self-end overflow-y-auto overscroll-contain p-1 group-data-[panel-above]/menu:-order-1")}
          >
            {text !== null && (
              <button type="button" className={ITEM} onClick={(event) => void copy(event, text)}>
                <Copy />
                Copy text
              </button>
            )}
            <button type="button" className={ITEM} onClick={(event) => void copyLink(event, message)}>
              <Link />
              Copy link
            </button>
            {editable && (
              <>
                <hr className="my-1 border-message-border" />
                {/* The text of a file message, or of a bot's cards, can't be changed, so only the bar's Edit opens their editor. */}
                {!message.attachment && !message.cards && (
                  <button type="button" className={ITEM} onClick={edit}>
                    <Pencil />
                    Edit message
                  </button>
                )}
                <button type="button" className={cn(ITEM, "text-negative")} onClick={deleteMessage}>
                  <Trash />
                  Delete message
                </button>
              </>
            )}
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
 * A file message's Download and Share, in Reply's place, as ember-rust's bar has them (messages/_actions.html).
 * Download is hidden in Ember added to an iPhone's or iPad's home screen, as the file's card hides it, and
 * Share shows where the browser can share, sharing the file titled with its name.
 */
function FileActions({ file }: { file: StoredFile }) {
  return (
    <>
      <a href={file.downloadUrl} title="Download" aria-label="Download" className={cn(ACTION, "ios-pwa:hidden")}>
        <Download />
      </a>
      {canShare() && (
        <ShareButton url={file.url} sharedTitle={file.name} title="Share" aria-label="Share" className={ACTION}>
          <Share />
        </ShareButton>
      )}
    </>
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
    const mentioned = (userId: string) => mentionedPerson(people, message.mentions, userId)?.name ?? UNKNOWN_PERSON;
    onClick(replyQuote(nodes, nameOf(message.creator), link, mentioned));
  };
  return (
    <button type="button" title="Reply" aria-label="Reply" className={ACTION} onClick={reply}>
      <Reply />
    </button>
  );
}

/**
 * Copies `text`, then turns the button clicked green and plays its success animation from the start, as
 * ember-rust's copy_to_clipboard_controller.js does. It stays green until it's clicked again, and a
 * clipboard that refuses leaves it as it was.
 */
async function copy({ currentTarget: button }: MouseEvent<HTMLButtonElement>, text: string) {
  button.classList.remove(...COPIED);
  // Reading the layout ends the last run of the animation, so adding the classes starts it again.
  void button.offsetWidth;
  try {
    await navigator.clipboard.writeText(text);
    button.classList.add(...COPIED);
  } catch {
    // Nothing to show.
  }
}

/** Copies the message's address, as Copy link does. Pages carry only the path, made absolute against the page, as ember-rust's do. */
function copyLink(event: MouseEvent<HTMLButtonElement>, message: Message) {
  return copy(event, new URL(messagePath(message.roomId, message.id), document.baseURI).href);
}

interface Placed {
  row: HTMLElement;
  container: HTMLElement;
  trigger: HTMLElement;
  /** What the bar opens beside for fingers: Message options, or Add a boost when that opened it. */
  anchor: HTMLElement;
  menu: HTMLElement;
  bar: HTMLElement;
  /** What opens under the bar, or over it: More actions while it's open, or else the tray of more reactions. */
  panel: HTMLElement;
  overlapping: boolean;
}

/**
 * Places an open bar as ember-rust's message_actions_controller.js#position does, within the timeline
 * less 8px on each side, and within what's on screen. With a mouse, it overlaps the row, its top 17px
 * above the row's and its right 16px in from the timeline's, with Message options pinned as its last
 * button, and the tray or More actions opens below it, or above when there's more room there. For
 * fingers, it opens 6px below its anchor, lined up with its right edge, or above when it doesn't fit, or
 * beside it when it fits neither, so it doesn't cover what opened it, as ember-rust's covers Add a boost.
 * Answers false, placing nothing, once the row is out of the timeline's sight, when the bar should close.
 */
function placeMenu({ row, container, trigger, anchor, menu, bar, panel, overlapping }: Placed): boolean {
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
  panel.style.maxHeight = "";
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
    const panelAbove = !panel.hidden && menuBox.height - barHeight > below && above > below;
    menu.toggleAttribute("data-panel-above", panelAbove);
    if (!panel.hidden) {
      panel.style.maxHeight = `${Math.max(0, (panelAbove ? above : below) - 7)}px`;
      menuBox = menu.getBoundingClientRect();
    }
    // Opening the tray or More actions mustn't move the bar off its row or out from under the pointer.
    y = panelAbove ? barTop - (menuBox.height - barHeight) : barTop;
    right = bounds.right - 8;
  } else {
    menu.removeAttribute("data-panel-above");
    const anchorBox = anchor.getBoundingClientRect();
    const below = anchorBox.bottom + 6;
    const above = anchorBox.top - menuBox.height - 6;
    right = anchorBox.right;
    if (below + menuBox.height <= bounds.bottom) y = below;
    else if (above >= bounds.top) y = above;
    else {
      // With room neither below nor above, as on a phone held sideways with the tray open, it opens to the
      // left of its anchor, where ember-rust's covers Message options, or to its right where only that has room.
      y = Math.max(bounds.top, Math.min(anchorBox.top, bounds.bottom - menuBox.height));
      const roomLeft = anchorBox.left - 6 - bounds.left >= menuBox.width;
      const roomRight = bounds.right - anchorBox.right - 6 >= menuBox.width;
      right = roomRight && !roomLeft ? anchorBox.right + 6 + menuBox.width : anchorBox.left - 6;
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
