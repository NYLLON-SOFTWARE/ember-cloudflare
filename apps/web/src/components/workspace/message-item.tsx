import { memo, useState } from "react";
import { MAX_MESSAGE_LENGTH, QUICK_REACTION_COUNT, REACTIONS, type Message, type User } from "@ember/protocol";
import { Ellipsis, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { sendsMessage } from "@/lib/keyboard";
import { boostSummary, mentions, timeLabel } from "@/lib/messages";
import { isPending, type PendingMessage } from "@/lib/room-state";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";

export interface MessageActions {
  boost: (messageId: string, content: string) => void;
  unboost: (boostId: string) => void;
  edit: (messageId: string, body: string) => void;
  remove: (messageId: string) => void;
}

const actionButton = "flex size-8 items-center justify-center rounded-md text-message-muted hover:bg-hover touch:size-11 [&_svg]:size-4";

interface Props {
  message: Message | PendingMessage;
  me: User;
  threaded: boolean;
  actions: MessageActions;
}

/** One message, laid out like ember-rust's: a 36px avatar gutter, author and time, then the body. */
export const MessageItem = memo(function MessageItem({ message, me, threaded, actions }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const pending = isPending(message);
  const mine = message.creator.id === me.id;
  const created = new Date(message.createdAt);
  const mentioned = !mine && mentions(message.body, me.name);

  const saveEdit = () => {
    const body = draft.trim();
    if (body && body !== message.body) actions.edit(message.id, body);
    setEditing(false);
  };

  const time = (
    <time dateTime={message.createdAt} title={created.toLocaleString()} className="text-xs leading-[18px] text-message-muted">
      {timeLabel(created)}
    </time>
  );

  return (
    <article
      aria-busy={pending || undefined}
      className={cn(
        "group/message relative grid grid-cols-[36px_minmax(0,1fr)] gap-x-2 px-5 hover:bg-message-hover max-md:grid-cols-[30px_minmax(0,1fr)] max-md:gap-x-2.5 max-md:px-3",
        // Where the options button shows, each message is at least as tall as it, as in ember-rust,
        // so the buttons of short messages in a row don't overlap.
        "[@media(hover:none)]:min-h-11",
        threaded ? "pt-0" : "pt-2",
        pending && "opacity-60",
      )}
    >
      {threaded ? (
        <span className="pt-[7px] text-right text-[10px] opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100">{time}</span>
      ) : (
        <UserAvatar user={message.creator} square className="mt-0 size-9 max-md:size-[30px]" />
      )}

      <div className={cn("min-w-0 py-1", threaded && "[@media(hover:none)]:pr-8", mentioned && "border-l-2 border-mention bg-mention/10 pl-2")}>
        {!threaded && (
          <div className="flex min-h-[22px] items-baseline gap-2 text-[15px] leading-[22px] max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-0.5 max-md:pr-[22px]">
            <strong className="font-bold text-message-ink">{message.creator.name}</strong>
            {time}
            {message.updatedAt !== message.createdAt && <span className="text-xs text-message-muted">(edited)</span>}
          </div>
        )}

        {editing ? (
          <form
            className="rounded-[10px] border bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              saveEdit();
            }}
          >
            <Textarea
              autoFocus
              aria-label="Edit message"
              value={draft}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
                if (sendsMessage(event)) {
                  event.preventDefault();
                  saveEdit();
                }
              }}
              className="min-h-10 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 touch:min-h-11 touch:text-base dark:bg-transparent"
            />
            {/* Phones have no Escape key and use Enter for new lines, so editing needs buttons. */}
            <div className="mt-1 flex items-center justify-end gap-1">
              <p className="mr-auto text-xs text-muted-foreground touch:hidden">Escape to cancel, Enter to save</p>
              <Button type="button" variant="ghost" size="sm" className="touch:h-11" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="touch:h-11">
                Save
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-[15px] leading-[22px] break-words whitespace-pre-wrap text-message-ink">{message.body}</p>
        )}

        {pending && message.failed && <p className="text-xs text-destructive">Not sent</p>}

        {message.boosts.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1" aria-label="Reactions">
            {boostSummary(message, me.id).map((group) => (
              <li key={group.content}>
                <button
                  type="button"
                  title={group.names.join(", ")}
                  aria-pressed={group.mine !== null}
                  onClick={() => (group.mine ? actions.unboost(group.mine) : actions.boost(message.id, group.content))}
                  className="flex h-6 items-center gap-1 rounded-full border bg-background px-2 text-xs hover:bg-hover aria-pressed:border-foreground/40 aria-pressed:bg-hover"
                >
                  <span>{group.content}</span>
                  <span className="text-message-muted">{group.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!pending && !editing && (
        <div
          className={cn(
            // On touch screens the bar opens beside the options button rather than over it.
            "absolute -top-1.5 right-4 z-10 items-center gap-1 [@media(hover:none)]:top-0 [@media(hover:none)]:right-12",
            menuOpen ? "flex" : "hidden group-hover/message:flex group-focus-within/message:flex",
          )}
        >
          <div role="group" aria-label="Message actions" className="flex items-center rounded-[11px] border border-message-border bg-background p-1 shadow-[0_1px_3px_#0000001a] touch:p-0.5">
            {REACTIONS.slice(0, QUICK_REACTION_COUNT).map(([emoji, title]) => (
              <button key={emoji} type="button" title={title} aria-label={title} className={actionButton} onClick={() => actions.boost(message.id, emoji)}>
                {emoji}
              </button>
            ))}
            <DropdownMenu onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger className={actionButton} title="More reactions" aria-label="More reactions">
                <SmilePlus />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-[11px] p-2">
                <DropdownMenuLabel className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">More reactions</DropdownMenuLabel>
                <div className="flex">
                  {REACTIONS.slice(QUICK_REACTION_COUNT).map(([emoji, title]) => (
                    <DropdownMenuItem key={emoji} title={title} aria-label={title} className="size-8 justify-center p-0 text-base touch:size-11" onSelect={() => actions.boost(message.id, emoji)}>
                      {emoji}
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            {mine && (
              <>
                <button
                  type="button"
                  title="Edit"
                  aria-label="Edit"
                  className={actionButton}
                  onClick={() => {
                    setDraft(message.body);
                    setEditing(true);
                  }}
                >
                  <Pencil />
                </button>
                <button type="button" title="Delete" aria-label="Delete" className={actionButton} onClick={() => confirm("Delete this message?") && actions.remove(message.id)}>
                  <Trash2 />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Touch screens have no hover, so a trigger toggles the actions, as on ember-rust mobile. */}
      {!pending && (
        <button
          type="button"
          aria-label="Message options"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="absolute top-0 right-1 hidden size-11 items-center justify-center rounded-md text-message-muted opacity-50 aria-expanded:opacity-100 [@media(hover:none)]:flex"
        >
          <Ellipsis className="size-4" />
        </button>
      )}
    </article>
  );
});
