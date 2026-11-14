import { createContext, createElement, useContext, type ReactNode } from "react";
import { workspacePageOf, type Room, type RoomId, type UserId } from "@ember/protocol";
import type { DisplayElement, DisplayNode } from "@ember/richtext/dom";
import { Lock } from "@/components/icons/iconoir";
import { useNameOf } from "@/hooks/use-directory";
import { roomName } from "@/lib/directs";
import { roomDisplayName } from "@/lib/sub-rooms";
import { dateTimeLabel, quotedTimeLabel } from "@/lib/messages";
import { MessageLink } from "./message-body";

/** The conversations the reader is in, and who they are, by which a quote's cite names the conversation it's from. */
export interface Conversations {
  rooms: readonly Room[];
  meId: UserId;
}

export const ConversationsContext = createContext<Conversations | null>(null);

/** The conversation of the message showing a quote, where a quote of one of its own messages links to it by "#". */
export const QuotingRoom = createContext<RoomId | null>(null);

/** Where a cite's link goes, when it's the permalink of a message in one of the app's rooms: the room, and the thread, if it's in one. */
function permalinkPlace(href: string | undefined): { roomId: RoomId; inThread: boolean } | null {
  if (href === undefined) return null;
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return null;
  }
  if (url.origin !== location.origin) return null;
  const page = workspacePageOf(url.pathname);
  return page?.page === "room" ? { roomId: page.roomId, inThread: page.threadId !== undefined } : null;
}

const isText = (node: DisplayNode | undefined, value: string) => node?.kind === "text" && node.value === value;

/**
 * A quote's `<cite>`, as Quote and Forward write it: `Ada · <time> #`. The time shows in the reader's time
 * zone, and the "#" linking to the quoted message stays "#" for a message from the conversation the quote's
 * in. For one from elsewhere it names that conversation instead, and the thread, if it's in one, as Slack's
 * forwarded messages do: "Ada · Nov 11, 7:30 PM · #Portside › thread", "· #Engineering – Backend" for a
 * sub-room, or "· DM with Zan". Only a conversation the reader is in is named and linked; another is "another
 * conversation", so a forward from a private room or a DM tells those who aren't in it nothing of it beyond
 * what was forwarded. `render` draws the rest.
 */
export function QuoteCite({ cite, props, render }: { cite: DisplayElement; props: Record<string, string>; render: (node: DisplayNode) => ReactNode }) {
  return createElement(
    "cite",
    props,
    ...cite.children.map((child) => {
      if (child.kind !== "element") return render(child);
      if (child.name === "time" && !Number.isNaN(Date.parse(child.attrs.datetime ?? ""))) return <QuotedTime dateTime={child.attrs.datetime!} />;
      const place = child.name === "a" && child.children.length === 1 && isText(child.children[0], "#") ? permalinkPlace(child.attrs.href) : null;
      return place ? <CitedPlace href={child.attrs.href!} {...place} fallback={render(child)} /> : render(child);
    }),
  );
}

/** When a quoted message was written, in the reader's time zone, with the date and time on hover. */
function QuotedTime({ dateTime }: { dateTime: string }) {
  const date = new Date(dateTime);
  return (
    <time dateTime={dateTime} title={dateTimeLabel(date)}>
      {quotedTimeLabel(date)}
    </time>
  );
}

/** The conversation a quoted message is from, or `fallback`, the "#", for one from the quote's own. */
function CitedPlace({ href, roomId, inThread, fallback }: { href: string; roomId: RoomId; inThread: boolean; fallback: ReactNode }) {
  const quoting = useContext(QuotingRoom);
  const conversations = useContext(ConversationsContext);
  const nameOf = useNameOf();
  if (roomId === quoting) return fallback;
  const room = conversations?.rooms.find((r) => r.id === roomId);
  if (!room) return <span className="font-normal text-muted-foreground">· another conversation</span>;
  // Named as the sidebar marks it: a DM by its people, a private room after its lock, an open one after `#`.
  const name =
    room.kind === "direct" ? `DM with ${roomName(room, conversations!.meId, nameOf)}` : `${room.kind === "closed" ? "" : "#"}${roomDisplayName(room, conversations!.rooms)}`;
  return (
    <>
      {"· "}
      <MessageLink href={href}>
        {room.kind === "closed" && (
          <>
            <Lock aria-hidden="true" className="inline size-[0.8em] align-baseline" />
            <span className="sr-only">Private</span>{" "}
          </>
        )}
        {inThread ? `${name} › thread` : name}
      </MessageLink>
    </>
  );
}
