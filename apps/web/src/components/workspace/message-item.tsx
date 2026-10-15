import { memo, useEffect, useMemo, useRef, useState } from "react";
import { QUICK_REACTION_COUNT, REACTIONS, type Me, type Message, type User } from "@ember/protocol";
import { displayBody, isAllEmoji, type DisplayNode } from "@ember/richtext/dom";
import { Ellipsis, FaceSlightlySmilingPlus, Pencil } from "@/components/icons/lucide";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNameOf } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { boostSummary, mentions, timeLabel } from "@/lib/messages";
import { isPending, type PendingMessage } from "@/lib/room-state";
import { cn } from "@/lib/utils";
import { MessageBody } from "./message-body";
import { MessageEditor } from "./message-editor";
import { UserAvatar } from "./user-avatar";

export interface MessageActions {
  boost: (messageId: string, content: string) => void;
  unboost: (boostId: string) => void;
  /** Returns whether the edit was sent. */
  edit: (messageId: string, body: string) => boolean;
  /** Returns whether the deletion was sent. */
  remove: (messageId: string) => boolean;
}

/** Opens and closes messages' editors, which the room keeps, so that Up Arrow can open one too. */
export interface MessageEditors {
  open: (messageId: string) => void;
  /** Closes a message's editor, returning focus to the composer. */
  close: (messageId: string) => void;
  /** Returns focus to the composer from an editor, as a message deleted from its editor goes. */
  returnFocus: () => void;
}

const actionButton = "flex size-8 items-center justify-center rounded-md text-message-muted hover:bg-hover touch:size-11 [&_svg]:size-4";

interface Props {
  message: Message | PendingMessage;
  me: Me;
  threaded: boolean;
  /** Whether the message's editor is open in its place. */
  editing: boolean;
  /** What can be done to the message, or null where nothing can, as in a room that's gone. */
  actions: MessageActions | null;
  editors: MessageEditors;
}

/** What a stored body shows, or null when it can't be shown. */
function shownBody(body: string): DisplayNode[] | null {
  try {
    return displayBody(body);
  } catch (error) {
    console.error("Could not show a message", error);
    return null;
  }
}

/**
 * ember-rust's messages/_unrenderable.html, in place of a message whose text can't be shown, with no
 * author, time, actions or reactions. As `.message--failed.center` does, it centers the message,
 * whose avatar's column stays empty, and fades it, and the text wiggles in a dashed red outline.
 */
function UnrenderableMessage() {
  return (
    <article className="mx-auto grid w-fit grid-cols-[36px_minmax(0,1fr)] gap-x-2 px-5 pt-2 opacity-50 max-md:grid-cols-[30px_minmax(0,1fr)] max-md:gap-x-2.5 max-md:px-3">
      <p className="col-start-2 animate-wiggle py-1 text-center text-sm leading-normal text-message-ink outline outline-dashed outline-negative motion-reduce:animate-none">
        Failed to load message content
      </p>
    </article>
  );
}

// The names below are the people directory's, which follow a rename, read where they're shown, so a
// change to the directory doesn't render every message again.

/** Someone's name as the people directory lists them now. */
function Name({ user }: { user: User }) {
  return useNameOf()(user);
}

/** The reaction chips under a message, each naming who reacted with it, which toggle yours. */
function Reactions({ message, me, actions }: Pick<Props, "message" | "me" | "actions">) {
  const nameOf = useNameOf();
  return (
    <ul className="mt-1 flex flex-wrap gap-1" aria-label="Reactions">
      {boostSummary(message, me.id, nameOf).map((group) => (
        <li key={group.content}>
          <button
            type="button"
            title={group.names.join(", ")}
            aria-pressed={group.mine !== null}
            disabled={!actions}
            onClick={() => (group.mine ? actions?.unboost(group.mine) : actions?.boost(message.id, group.content))}
            className="flex h-6 items-center gap-1 rounded-full border bg-background px-2 text-xs enabled:hover:bg-hover aria-pressed:border-foreground/40 aria-pressed:bg-hover"
          >
            <span>{group.content}</span>
            <span className="text-message-muted">{group.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One message, laid out like ember-rust's: a 36px avatar gutter, author and time, then the body. */
export const MessageItem = memo(function MessageItem({ message, me, threaded, editing: editorOpen, actions, editors }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [timeline, setTimeline] = useState<Element | null>(null);
  const article = useRef<HTMLElement>(null);
  const options = useRef<HTMLButtonElement>(null);
  const actionBar = useRef<HTMLDivElement>(null);
  // Set while the More reactions menu is up: to "chosen" once a reaction is picked from it, and to
  // "elsewhere" once a click outside it closes it.
  const moreReactions = useRef<"open" | "chosen" | "elsewhere" | null>(null);
  const touch = useMediaQuery("(hover: none)");
  const pending = isPending(message);
  // The editor shows only while the message can still be changed.
  const editing = editorOpen && actions !== null && !pending;
  const mine = message.creator.id === me.id;
  const created = new Date(message.createdAt);
  const mentioned = !mine && mentions(message.plainText, me.name);
  const shown = useMemo(() => shownBody(message.body), [message.body]);
  const allEmoji = isAllEmoji(message.plainText);
  // ember-rust doesn't mark edited messages. Ember does, like Slack, so readers can tell a message changed.
  const edited = message.editedAt !== null && <span className="text-xs text-message-muted">(edited)</span>;

  // With a mouse, a click or focus anywhere else closes the actions, so only one message has them open,
  // as in ember-rust (message_actions_controller.js). The More reactions menu is outside the message
  // while it's up, and closes them itself. On touch screens the popover does all of this.
  useEffect(() => {
    if (!menuOpen || touch) return;
    const closeElsewhere = (event: Event) => {
      const target = event.target as Node;
      if (!moreReactions.current && !actionBar.current?.contains(target) && !options.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener("click", closeElsewhere);
    document.addEventListener("focusin", closeElsewhere);
    return () => {
      document.removeEventListener("click", closeElsewhere);
      document.removeEventListener("focusin", closeElsewhere);
    };
  }, [menuOpen, touch]);

  const setTouchMenuOpen = (open: boolean) => {
    // ember-rust keeps the actions inside the timeline, so they go above the button when there's no room below.
    if (open) setTimeline(article.current?.closest('[role="log"]') ?? null);
    setMenuOpen(open);
  };

  // Like ember-rust's, the actions close once a reaction is sent or the editor opens (messages/_reaction.html),
  // and focus goes to Message options rather than staying on the reaction.
  const closeAfterReacting = () => {
    setMenuOpen(false);
    options.current?.focus({ preventScroll: true });
  };

  const boost = (emoji: string) => {
    actions?.boost(message.id, emoji);
    closeAfterReacting();
  };

  const time = (
    <time dateTime={message.createdAt} title={created.toLocaleString()} className="text-xs leading-[18px] text-message-muted">
      {timeLabel(created)}
    </time>
  );

  const optionsButton = (onClick?: () => void) => (
    <button
      ref={options}
      type="button"
      aria-label="Message options"
      aria-expanded={menuOpen}
      onClick={onClick}
      className={cn(
        actionButton,
        "absolute opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100 aria-expanded:opacity-100",
        "[@media(hover:hover)]:-top-px [@media(hover:hover)]:right-[21px] [@media(hover:hover)]:z-20",
        "[@media(hover:none)]:top-0 [@media(hover:none)]:right-1 [@media(hover:none)]:size-11 [@media(hover:none)]:opacity-50",
      )}
    >
      <Ellipsis className="size-4" />
    </button>
  );

  const bar = (
    <div
      ref={actionBar}
      role="group"
      aria-label="Message actions"
      className="flex items-center rounded-[11px] border border-message-border bg-background p-1 shadow-[0_1px_3px_#0000001a] [@media(hover:hover)]:pr-9 [@media(hover:hover)]:touch:pr-12"
    >
      {REACTIONS.slice(0, QUICK_REACTION_COUNT).map(([emoji, title]) => (
        <button key={emoji} type="button" title={title} aria-label={title} className={actionButton} onClick={() => boost(emoji)}>
          {emoji}
        </button>
      ))}
      {/* As ember-rust's `.message__edit-btn` shows (Campfire's messages.css): on your own messages, and
          on everyone's for administrators. */}
      {(mine || me.administrator) && (
        <button
          type="button"
          title="Edit"
          aria-label="Edit"
          className={actionButton}
          onClick={() => {
            setMenuOpen(false);
            editors.open(message.id);
          }}
        >
          <Pencil />
        </button>
      )}
      {/* Keep the bar shown until the closing menu hands focus back to its button. Hiding it
          first drops keyboard focus to the page. */}
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) return;
          moreReactions.current = "open";
          setMenuOpen(true);
        }}
      >
        <DropdownMenuTrigger className={actionButton} title="More reactions" aria-label="More reactions">
          <FaceSlightlySmilingPlus />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="rounded-[11px] p-2"
          onPointerDownOutside={() => (moreReactions.current = "elsewhere")}
          onCloseAutoFocus={(event) => {
            if (moreReactions.current === "chosen") {
              event.preventDefault();
              closeAfterReacting();
            } else {
              // A click elsewhere closes the actions along with the menu, so focus doesn't go back to them.
              if (moreReactions.current === "elsewhere") event.preventDefault();
              setMenuOpen(false);
            }
            moreReactions.current = null;
          }}
        >
          <DropdownMenuLabel className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">More reactions</DropdownMenuLabel>
          <div className="flex">
            {REACTIONS.slice(QUICK_REACTION_COUNT).map(([emoji, title]) => (
              <DropdownMenuItem
                key={emoji}
                title={title}
                aria-label={title}
                className="size-8 justify-center p-0 text-base touch:size-11"
                onSelect={() => {
                  moreReactions.current = "chosen";
                  actions?.boost(message.id, emoji);
                }}
              >
                {emoji}
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  if (shown === null) return <UnrenderableMessage />;

  return (
    <article
      ref={article}
      aria-busy={pending || undefined}
      className={cn(
        "group/message relative grid grid-cols-[36px_minmax(0,1fr)] gap-x-2 px-5 hover:bg-message-hover max-md:grid-cols-[30px_minmax(0,1fr)] max-md:gap-x-2.5 max-md:px-3",
        // Where the options button shows, each message is at least as tall as it, as in ember-rust,
        // so the buttons of short messages in a row don't overlap.
        "[@media(hover:none)]:min-h-11",
        // The editor starts 4px above where the avatar does, as ember-rust's does.
        threaded || editing ? "pt-0" : "pt-2",
        pending && "opacity-60",
      )}
    >
      {/* The editor replaces the time beside a grouped message too, as it replaces the header. */}
      {threaded ? (
        !editing && <span className="pt-[7px] text-right text-[10px] opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100">{time}</span>
      ) : (
        <UserAvatar user={message.creator} square className={cn("size-9 max-md:size-[30px]", editing ? "mt-2" : "mt-0")} />
      )}

      {editing ? (
        <MessageEditor
          message={message}
          onSave={(body) => actions.edit(message.id, body)}
          onDelete={() => actions.remove(message.id) && editors.returnFocus()}
          onClose={() => editors.close(message.id)}
        />
      ) : (
        <div
          className={cn(
            "min-w-0",
            allEmoji ? "py-0" : "py-1",
            threaded && "[@media(hover:none)]:pr-8",
            mentioned && "border-l-2 border-mention bg-mention/10 pl-2",
          )}
        >
          {!threaded && (
            <div className="flex min-h-[22px] items-baseline gap-2 text-[15px] leading-[22px] max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-0.5 max-md:pr-[22px]">
              <strong className="font-bold text-message-ink">
                <Name user={message.creator} />
              </strong>
              {time}
              {edited}
            </div>
          )}

          {/* A grouped message has no header, so its mark follows the text. */}
          <MessageBody nodes={shown} emoji={allEmoji} trailing={(threaded && edited) || undefined} />

          {pending && message.failed && <p className="text-xs text-destructive">Not sent</p>}

          {message.boosts.length > 0 && <Reactions message={message} me={me} actions={actions} />}
        </div>
      )}

      {actions &&
        !pending &&
        !editing &&
        (touch ? (
          // Touch screens have no hover, so the options button opens the actions just below it, or above
          // it when there's no room, as ember-rust places them on phones (message_actions_controller.js).
          <Popover open={menuOpen} onOpenChange={setTouchMenuOpen}>
            <PopoverTrigger asChild>{optionsButton()}</PopoverTrigger>
            <PopoverContent
              aria-label="Message options"
              align="end"
              sideOffset={6}
              collisionBoundary={timeline}
              collisionPadding={8}
              hideWhenDetached
              className="w-auto rounded-none border-0 bg-transparent p-0 shadow-none"
            >
              {bar}
            </PopoverContent>
          </Popover>
        ) : (
          <>
            {/* With a mouse the options button is the bar's last button, in the space the bar leaves for
                it, as in ember-rust's overlapping bar (zz-ember.css, `.mb-message-actions--overlapping`).
                It comes before the bar in tab order because it's how a keyboard gets into the bar. */}
            {optionsButton(() => setMenuOpen((open) => !open))}
            <div
              className={cn(
                "absolute -top-1.5 right-4 z-10 items-center gap-1",
                menuOpen ? "flex" : "hidden group-hover/message:flex group-focus-within/message:flex",
              )}
            >
              {bar}
            </div>
          </>
        ))}
    </article>
  );
});
