import { memo, useCallback, useMemo, useRef } from "react";
import type { Me, Message, User } from "@ember/protocol";
import { displayBody, isAllEmoji, type DisplayNode } from "@ember/richtext/dom";
import { useNameOf } from "@/hooks/use-directory";
import { boostSummary, mentions, timeLabel } from "@/lib/messages";
import { isPending, type PendingMessage } from "@/lib/room-state";
import { cn } from "@/lib/utils";
import { MessageActionsMenu } from "./message-actions-menu";
import { MessageBody } from "./message-body";
import { MessageEditor, type MessageEditorHandle } from "./message-editor";
import { UserAvatar } from "./user-avatar";

export interface MessageActions {
  boost: (messageId: string, content: string) => void;
  unboost: (boostId: string) => void;
  /** Returns whether the edit was sent. */
  edit: (messageId: string, body: string) => boolean;
  /** Returns whether the deletion was sent. */
  remove: (messageId: string) => boolean;
}

/**
 * Opens and closes messages' editors, which the room keeps, so that Up Arrow can open one too, and
 * writes replies in its composer.
 */
export interface MessageEditors {
  /** Opens a message's editor, or focuses it where it's open already, keeping what's written in it. */
  open: (messageId: string) => void;
  /** Closes a message's editor, returning focus to the composer. */
  close: (messageId: string) => void;
  /** Returns focus to the composer from an editor, as a message deleted from its editor goes. */
  returnFocus: () => void;
  /** Keeps a message's editor while it's open, for `open` to focus; called with null as it goes. */
  attach: (messageId: string, editor: MessageEditorHandle | null) => void;
  /** Writes a reply in the composer, starting with `quote`, in place of what's written there. */
  reply: (quote: string) => void;
}

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
function Reactions({ message, me, threaded, actions }: Pick<Props, "message" | "me" | "threaded" | "actions">) {
  const nameOf = useNameOf();
  return (
    <ul
      aria-label="Reactions"
      // Where Message options is 44px, the next message's rises 11px into this one, reaching 38px in from
      // its edge, so the chips stop short of it. A grouped message's body already keeps 32px of that clear.
      className={cn("mt-1 flex flex-wrap gap-1", threaded ? "touch:pr-1.5" : "touch:pr-[38px]")}
    >
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
  const article = useRef<HTMLElement>(null);
  const attachEditor = useCallback((editor: MessageEditorHandle | null) => editors.attach(message.id, editor), [editors, message.id]);
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

  const time = (
    <time dateTime={message.createdAt} title={created.toLocaleString()} className="text-xs leading-[18px] text-message-muted">
      {timeLabel(created)}
    </time>
  );

  if (shown === null) return <UnrenderableMessage />;

  return (
    <article
      ref={article}
      aria-busy={pending || undefined}
      className={cn(
        "group/message relative grid grid-cols-[36px_minmax(0,1fr)] gap-x-2 px-5 hover:bg-message-hover max-md:grid-cols-[30px_minmax(0,1fr)] max-md:gap-x-2.5 max-md:px-3",
        // Where Message options is 44px, each message is at least as tall as it, as in ember-rust, so
        // the buttons of short messages in a row don't overlap.
        "touch:min-h-11",
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
          ref={attachEditor}
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
            threaded && "touch:pr-8",
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

          {message.boosts.length > 0 && <Reactions message={message} me={me} threaded={threaded} actions={actions} />}
        </div>
      )}

      {actions && !pending && !editing && (
        <MessageActionsMenu
          message={message}
          nodes={shown}
          row={article}
          editable={mine || me.administrator}
          onReact={(emoji) => actions.boost(message.id, emoji)}
          onReply={editors.reply}
          onEdit={() => editors.open(message.id)}
        />
      )}
    </article>
  );
});
