import { memo, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Me, Message, User } from "@ember/protocol";
import { displayBody, isAllEmoji, type DisplayNode } from "@ember/richtext/dom";
import { PageLink } from "@/components/page-link";
import { PeopleContext } from "@/hooks/use-directory";
import { messagePath } from "@/hooks/use-route";
import { dateTimeLabel, timeLabel } from "@/lib/messages";
import { isPending, type PendingMessage } from "@/lib/room-state";
import { cn } from "@/lib/utils";
import { MessageActionsMenu, type MessageActionsHandle } from "./message-actions-menu";
import { MessageBody } from "./message-body";
import { MessageBoosts } from "./message-boosts";
import { MessageEditor, type MessageEditorHandle } from "./message-editor";
import { AvatarLink, userTitle } from "./user-avatar";

export interface MessageActions {
  /** Returns whether the reaction was sent. */
  boost: (messageId: string, content: string) => boolean;
  /** Returns whether the deletion was sent. */
  unboost: (boostId: string) => boolean;
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

/**
 * The author's name as the people directory lists them now, which runs to an ellipsis rather than wrap,
 * and shows their bio on hover, as ember-rust's `.message__author` does (messages.css, _message.html).
 */
function Author({ user }: { user: User }) {
  const listed = useContext(PeopleContext).get(user.id) ?? user;
  return (
    <strong title={userTitle(listed)} className="truncate font-bold text-message-ink">
      {listed.name}
    </strong>
  );
}

/** One message, laid out like ember-rust's: a 36px avatar gutter, author and time, then the body. */
export const MessageItem = memo(function MessageItem({ message, me, threaded, editing: editorOpen, actions, editors }: Props) {
  const article = useRef<HTMLElement>(null);
  const menu = useRef<MessageActionsHandle>(null);
  const attachEditor = useCallback((editor: MessageEditorHandle | null) => editors.attach(message.id, editor), [editors, message.id]);
  const pending = isPending(message);
  // The editor shows only while the message can still be changed.
  const editing = editorOpen && actions !== null && !pending;
  const [customizing, setCustomizing] = useState(false);
  const customField = useRef<HTMLInputElement>(null);
  // The Custom reaction form goes as the editor opens, as ember-rust's editor replaces the whole message.
  if (customizing && (editing || !actions)) setCustomizing(false);
  const mine = message.creator.id === me.id;
  const created = new Date(message.createdAt);
  // Any message that mentions you, yours too, as Campfire's message_formatter.js means to mark them. It looks
  // for an avatar address that mentions don't have, so ember-rust never does.
  const mentioned = message.mentions.some((person) => person.id === me.id);
  const shown = useMemo(() => shownBody(message.body), [message.body]);
  const allEmoji = isAllEmoji(message.plainText);
  // ember-rust doesn't mark edited messages. Ember does, like Slack, so readers can tell a message changed.
  const edited = message.editedAt !== null && <span className="text-xs text-message-muted">(edited)</span>;

  // ember-rust's `.message__permalink` (_message.html): the time, linking to the message, though not while the
  // message is on its way to the room (_template.html). A follow-up's shows only on hover or focus, after its
  // text, without moving it (zz-ember.css, `.message--threaded`).
  const timeClass = cn(
    "text-xs leading-[18px] whitespace-nowrap text-message-muted",
    threaded && "col-start-2 row-start-1 mt-[3px] justify-self-start opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100",
  );
  const time = (
    <time dateTime={message.createdAt} title={dateTimeLabel(created)}>
      {timeLabel(created)}
    </time>
  );
  const permalink = pending ? (
    <span className={timeClass}>{time}</span>
  ) : (
    <PageLink href={messagePath(message.roomId, message.id)} className={timeClass}>
      {time}
    </PageLink>
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
        pending && "opacity-60",
      )}
    >
      {/* The avatar sits 8px down, level with the author's name, and 4px below where the editor starts. */}
      {!threaded && <AvatarLink user={message.creator} square className="mt-2 size-9 max-md:size-[30px]" />}

      {editing ? (
        <MessageEditor
          ref={attachEditor}
          message={message}
          onSave={(body) => actions.edit(message.id, body)}
          onDelete={() => actions.remove(message.id) && editors.returnFocus()}
          onClose={() => editors.close(message.id)}
        />
      ) : (
        // ember-rust's `.message__body-content`, which a permalink outlines. A follow-up's time takes a column
        // of its own after the text, which the text gives up its room to only as it runs long.
        <div
          data-body-content
          className={cn(
            "col-start-2 min-w-0",
            allEmoji ? "py-0" : "py-1",
            threaded && "grid grid-cols-[minmax(0,max-content)_minmax(max-content,1fr)] items-start gap-x-2.5 touch:pr-8",
            // zz-ember.css's `.message--mentioned`, which wiggles as it shows, as Campfire's messages.css has it.
            mentioned && "animate-wiggle border-l-2 border-mention bg-mention/10 pl-2 motion-reduce:animate-none",
          )}
        >
          {/* ember-rust's `.message__heading`, a 15px h3, whose letters are spaced as headings' are. A follow-up's
              holds only its time, which it leaves to the text's grid, as ember-rust's `display: contents` does. */}
          {threaded ? (
            <h3 className="contents text-[15px]">{permalink}</h3>
          ) : (
            <h3 className="flex min-h-[22px] items-baseline gap-2 text-[15px] leading-[22px] max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-0.5 max-md:pr-[22px]">
              <Author user={message.creator} />
              {permalink}
              {edited}
            </h3>
          )}

          {/* A grouped message has no header, so its mark follows the text. Where Message options is 44px, the
              text stops 32px short of the row's end, clear of it. */}
          <MessageBody
            nodes={shown}
            mentions={message.mentions}
            emoji={allEmoji}
            trailing={(threaded && edited) || undefined}
            className={threaded ? "col-start-1 row-start-1" : "touch:pr-8"}
          />

          {pending && message.failed && <p className="col-span-full text-xs text-destructive">Not sent</p>}

          {(message.boosts.length > 0 || customizing) && (
            <MessageBoosts
              message={message}
              me={me}
              threaded={threaded}
              actions={actions}
              customizing={customizing}
              customField={customField}
              onAddBoost={(button) => menu.current?.openReactions(button)}
              onCloseCustom={() => setCustomizing(false)}
              returnFocus={() => menu.current?.focus()}
            />
          )}
        </div>
      )}

      {actions && !pending && !editing && (
        <MessageActionsMenu
          ref={menu}
          message={message}
          nodes={shown}
          row={article}
          editable={mine || me.administrator}
          onReact={(emoji) => actions.boost(message.id, emoji)}
          onReply={editors.reply}
          onEdit={() => editors.open(message.id)}
          // The form opens with its field focused, or, open already, keeps what's written in it and focuses it.
          onNewBoost={() => (customizing ? customField.current?.focus() : setCustomizing(true))}
        />
      )}
    </article>
  );
});
