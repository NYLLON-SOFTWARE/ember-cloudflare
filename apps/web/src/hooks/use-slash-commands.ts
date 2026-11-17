import { useContext } from "react";
import { MESSAGE_TOO_LONG, searchPath, startingInvolvement, type Involvement, type Me, type Room, type RoomId, type SharedRoom, type SidebarRoom, type User } from "@ember/protocol";
import { writtenBody } from "@ember/richtext/dom";
import { useFlash } from "@/components/flash";
import { useJoinsNoHuddle } from "@/components/workspace/huddle-button";
import { OpenSearchContext } from "@/components/workspace/search-box";
import { changeRoom, CONFIRM_LEAVE, fetchRoomSettings, leaveRoom, setInvolvement, startDirect } from "@/lib/api";
import { chooseAppearance } from "@/lib/appearance";
import { roomName, toSentence } from "@/lib/directs";
import { hasHuddles } from "@/lib/huddle-people";
import { sendAway } from "@/lib/outbox";
import type { RoomAnswer } from "@/lib/room-list";
import { bodyAfter, commandsIn, isBlankBody, mentionAfter, personNamedIn, roomNamedIn, type CommandName, type SlashCommand, type Taken, type WrittenCommand } from "@/lib/slash-commands";
import { useAccount } from "./use-account";
import { PeopleContext, useNameOf } from "./use-directory";
import { isTooLong, pendingMessage } from "./use-room";
import { huddlePath, navigate, roomPath, roomSettingsPath } from "./use-route";

interface Options {
  room: Room;
  me: Me;
  /** This person's level in the room. */
  involvement: Involvement;
  /** This person's rooms, as their sidebar has them, hidden ones too. */
  rooms: SidebarRoom[];
  /** Has the sidebar list a room as the server answers a change to it. */
  askForRoom: () => (answer: RoomAnswer) => void;
  /** Says why a command failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
  /** Opens New direct message, the DMs, giving focus back to `opener` as it closes. */
  onOpenDirects: (opener: HTMLElement | null) => void;
  onOpenShortcuts: () => void;
  /** Sends a message to the room, answering whether it went. */
  onSend: (body: string) => boolean;
}

/** Runs a command, settling with whether it ran: one that didn't is written again, to put right. */
type Runner = (written: WrittenCommand) => Promise<boolean>;

/** What /msg sends to, and how it's named after the command. */
interface Recipient {
  roomId: () => Promise<RoomId>;
  name: string;
  taken: Taken;
}

/**
 * Slack's commands that Ember can do in `room`, which / lists, and what runs each but /shrug and
 * /snippet, which the composer runs itself: as Slack's do, with a room where Slack has a channel, saying
 * what they did, or why they couldn't, over the page. Where a command needs more than it's given, such as
 * /invite with nobody named, it opens the page that asks for it.
 */
export function useSlashCommands({ room, me, involvement, rooms, askForRoom, onFailed, onOpenDirects, onOpenShortcuts, onSend }: Options): {
  commands: SlashCommand[];
  run: Runner;
} {
  const flash = useFlash();
  const people = useContext(PeopleContext);
  const openSearch = useContext(OpenSearchContext);
  const nameOf = useNameOf();
  const joinsNone = useJoinsNoHuddle();
  const huddlesOn = useAccount().huddles;
  const huddles = huddlesOn && hasHuddles(room, me.id, joinsNone);
  const shared = rooms.filter((r): r is SidebarRoom & SharedRoom => r.kind !== "direct");
  // How a room is named after a command: by its name after a #, or a DM by whom it's with.
  const named = (r: Room) => (r.kind === "direct" ? roomName(r, me.id, nameOf) : `#${r.name}`);
  // What's said of a command that can't run as written, which stays to be put right.
  const refuse = (alert: string) => {
    flash("alert", alert);
    return false;
  };
  const focused = () => (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  /**
   * The people named after an @ at the start of `argument`, one after another, and what follows them. Two
   * people can share a name, so each mention of it names the next of them mentioned, in turn, and once
   * they're all found, whom it named before.
   */
  const peopleIn = (argument: string, mentions: User[]) => {
    const found: User[] = [];
    const isFound = (person: User) => found.some(({ id }) => id === person.id);
    for (let rest = argument; ; ) {
      const next = personNamedIn(rest, [...mentions.filter((person) => !isFound(person)), ...found], people.values());
      if (!next) return { found, rest };
      if (!isFound(next.named)) found.push(next.named);
      rest = next.rest;
    }
  };

  /** The room `argument` names after a #, or this one, where it names none; undefined where it names one that isn't this person's. */
  const roomIn = (argument: string): Room | undefined => (argument === "" ? room : roomNamedIn(argument, shared)?.named);

  const runners: Record<Exclude<CommandName, "shrug" | "snippet">, Runner> = {
    darkmode: async () => {
      chooseAppearance(document.documentElement.classList.contains("dark") ? "light" : "dark");
      return true;
    },
    dm: async () => {
      onOpenDirects(focused());
      return true;
    },
    huddle: async () => {
      if (huddlesOn && !huddles) return refuse("There's nobody here to huddle with.");
      // As the huddle's link does: it offers the huddle, or opens it, once the tab is in it.
      navigate(huddlePath(room.id));
      return true;
    },
    invite: async ({ typed, mentions }) => {
      const { found, rest } = peopleIn(typed.argument, mentions);
      if (rest.startsWith("@")) return refuse("Pick whom to add from the list @ shows.");
      const target = roomIn(rest);
      if (!target) return refuse("Name a room you're in after the #.");
      if (target.kind === "direct") return refuse("Nobody can be added to a direct message.");
      if (target.kind === "open") {
        flash("notice", `Everyone is in #${target.name} already.`);
        return true;
      }
      // Slack's /invite alone asks whom to add, as the room's settings do.
      if (found.length === 0) {
        navigate(roomSettingsPath("closed", target.id));
        return true;
      }
      const settings = await fetchRoomSettings(target.id);
      if (!settings.canAdminister) return refuse(`Only administrators and the room's creator can add people to #${target.name}.`);
      const offered = new Set(settings.people.map((person) => person.id));
      const members = settings.people.filter((person) => person.member).map((person) => person.id);
      const refused = found.filter((person) => !offered.has(person.id));
      if (refused.length > 0) return refuse(`${toSentence(refused.map(nameOf))} can't be added to a room.`);
      const added = found.filter((person) => !members.includes(person.id));
      if (added.length === 0) {
        flash("notice", `${toSentence(found.map(nameOf))} ${found.length === 1 ? "is" : "are"} in #${target.name} already.`);
        return true;
      }
      const answered = askForRoom();
      answered({ type: "saved", room: await changeRoom(target.id, { kind: "closed", memberIds: [...members, ...added.map((person) => person.id)] }) });
      flash("notice", `Added ${toSentence(added.map(nameOf))} to #${target.name}.`);
      return true;
    },
    leave: async () => {
      if (room.kind === "direct") return refuse("A direct message can't be left, though /mute turns its notifications off.");
      if (room.kind === "open") {
        // Everyone's in an open room, so leaving it, as Slack has it, is hiding it from the sidebar.
        const answered = askForRoom();
        answered({ type: "involved", roomId: room.id, involvement: await setInvolvement(room.id, "invisible") });
        flash("notice", `#${room.name} is hidden from your sidebar.`);
      } else {
        // As the room's settings ask.
        if (!confirm(CONFIRM_LEAVE)) return true;
        const answered = askForRoom();
        await leaveRoom(room.id);
        answered({ type: "gone", roomId: room.id });
      }
      navigate("/");
      return true;
    },
    msg: async ({ typed, markup, mentions }) => {
      const to = recipientOf(typed.name.length + 1, typed.argument, markup, mentions);
      if (!to) return refuse("Write /msg, then @someone or #room, then your message.");
      const body = bodyAfter(markup, typed.name.length + 1, to.taken);
      const roomId = await to.roomId();
      if (isBlankBody(body)) {
        navigate(roomPath(roomId));
        return true;
      }
      if (roomId === room.id) return onSend(body);
      const { plainText, mentions: mentioned } = writtenBody(body);
      if (isTooLong(body, plainText)) return refuse(MESSAGE_TOO_LONG);
      // Sent as one written in that room while it was away would be, which shows there as it's opened, and
      // said to be sent once the room has it. One that isn't is written again, to send again.
      const message = { ...pendingMessage(crypto.randomUUID(), roomId, me, body, plainText, mentioned, new Date().toISOString()), queued: true };
      if (!(await sendAway(roomId, message))) return refuse(`Your message to ${to.name} wasn't sent.`);
      flash("notice", `Sent to ${to.name}.`);
      return true;
    },
    mute: async ({ typed }) => {
      const target = roomIn(typed.argument);
      if (!target) return refuse("Name a room you're in after the #.");
      const level = target.id === room.id ? involvement : (rooms.find((r) => r.id === target.id)?.involvement ?? startingInvolvement(target));
      const muted = level === "nothing" || level === "invisible";
      const answered = askForRoom();
      answered({ type: "involved", roomId: target.id, involvement: await setInvolvement(target.id, muted ? startingInvolvement(target) : "nothing") });
      flash("notice", `${muted ? "Unmuted" : "Muted"} ${named(target)}.`);
      return true;
    },
    remove: async ({ typed, mentions }) => {
      if (room.kind !== "closed") return refuse(room.kind === "open" ? `Everyone is in #${room.name}, so nobody can be taken out of it.` : "Nobody can be taken out of a direct message.");
      const { found, rest } = peopleIn(typed.argument, mentions);
      if (found.length === 0 || rest !== "") return refuse("Pick whom to remove from the list @ shows.");
      const settings = await fetchRoomSettings(room.id);
      if (!settings.canAdminister) return refuse(`Only administrators and the room's creator can take people out of #${room.name}.`);
      const members = settings.people.filter((person) => person.member).map((person) => person.id);
      const removed = found.filter((person) => members.includes(person.id));
      if (removed.length === 0) {
        flash("notice", `${toSentence(found.map(nameOf))} ${found.length === 1 ? "isn't" : "aren't"} in #${room.name}.`);
        return true;
      }
      const memberIds = members.filter((id) => !removed.some((person) => person.id === id));
      const leaving = !memberIds.includes(me.id);
      const answered = askForRoom();
      const saved = await changeRoom(room.id, { kind: "closed", memberIds });
      answered(leaving ? { type: "gone", roomId: room.id } : { type: "saved", room: saved });
      flash("notice", `Removed ${toSentence(removed.map(nameOf))} from #${room.name}.`);
      if (leaving) navigate("/");
      return true;
    },
    rename: async ({ typed }) => {
      if (room.kind === "direct") return refuse("A direct message is named after the people in it.");
      // Slack's /rename alone asks for the name, as the room's settings do.
      if (typed.argument === "") {
        navigate(roomSettingsPath(room.kind, room.id));
        return true;
      }
      const answered = askForRoom();
      const saved = await changeRoom(room.id, { name: typed.argument });
      answered({ type: "saved", room: saved });
      flash("notice", `Renamed the room #${saved.name}.`);
      return true;
    },
    search: async ({ typed }) => {
      if (typed.argument === "") openSearch({ opener: focused(), roomId: room.id });
      else navigate(searchPath({ q: typed.argument }));
      return true;
    },
    shortcuts: async () => {
      onOpenShortcuts();
      return true;
    },
  };

  /**
   * Whom or where /msg sends to: whom it mentions first thing, as the @ list writes them, or whom it names
   * after an @ as typed, in a DM with them, started if they have none, or a room it names after a #.
   */
  function recipientOf(length: number, argument: string, markup: string, mentions: User[]): Recipient | null {
    const mentioned = mentionAfter(markup, length);
    const person = mentioned ? (people.get(mentioned) ?? mentions.find(({ id }) => id === mentioned)) : personNamedIn(argument, [], people.values())?.named;
    if (person) {
      return {
        name: nameOf(person),
        taken: mentioned ? "mention" : person.name.length + 1,
        roomId: async () => {
          const answered = askForRoom();
          const direct = await startDirect([person.id]);
          answered({ type: "saved", room: direct });
          return direct.id;
        },
      };
    }
    const to = roomNamedIn(argument, shared)?.named;
    return to ? { name: `#${to.name}`, taken: to.name.length + 1, roomId: async () => to.id } : null;
  }

  return {
    commands: commandsIn(room, huddles),
    run: async (written) => {
      const runner = runners[written.command.name as keyof typeof runners];
      try {
        return await runner(written);
      } catch (error) {
        onFailed(error);
        return false;
      }
    },
  };
}
