import { useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { botMessagesPath, botSlackPath, type Bot, type BotRoom, type Command, type Commands, type Shortcut, type Shortcuts } from "@ember/protocol/bots";
import type { RoomId, UserId } from "@ember/protocol";
import { useFlash } from "@/components/flash";
import { Attachment, ChatBubbleEmpty, EditPencil, Internet, Plus, Sparks, Terminal, Trash } from "@/components/icons/iconoir";
import { useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { botMessagesPath, botSlackPath, type Bot, type BotRoom } from "@ember/protocol/bots";
import { useFlash } from "@/components/flash";
import { Attachment, ChatBubbleEmpty, EditPencil, Internet, NavArrowRight, Plus } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { TranslationButton } from "@/components/translation-button";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { botSettingsPath, navigate, NEW_BOT_PATH, WORKSPACE_SETTINGS_PATH } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { ApiError, fetchBots, fetchCommands, fetchShortcuts, isSignedOut, registerCommand, registerShortcut, removeCommand, removeShortcut, subscribeBotToMessages, unsubscribeBotFromMessages } from "@/lib/api";
import { byName } from "@/lib/people";
import { cn } from "@/lib/utils";
import { roomNames } from "./agent-list";
import { CopyButton, ROUND_BUTTON } from "./link-buttons";
import { Panel, SECTION_HEADING, SettingsPage, TITLE, TITLE_LINK } from "./settings-page";
import { AvatarLink } from "./user-avatar";

/** The command the bots page gives for posting a message as a bot to `url`. */
export const curlTextLine = (url: string) => `curl -d 'Hello!' ${url}`;

/** And for posting a file (`curl_upload_line`). */
export const curlUploadLine = (url: string) => `curl -F "attachment=@/path/to/file" ${url}`;

/** Campfire's `.input.fill-white` in a panel: 42px tall, or 44px for fingers. */
const INPUT = "min-h-[42px] w-full min-w-0 rounded-[9px] border bg-background px-[0.8em] py-[0.5em] text-base focus:border-muted-foreground touch:min-h-11";

/** A form's button, as New domain asks for one. */
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-[9px] border bg-background px-3.5 py-2.5 font-medium disabled:opacity-50";
/** What a bot's row says of a bot in no rooms, which has no commands. */
export const NO_ROOMS = "No rooms";

/** A row that opens to what's under it, as a bot's opens to its rooms and a room's to its commands. */
const DISCLOSURE = "group flex min-w-0 cursor-pointer items-center gap-x-[1ch] text-start";

/**
 * Sends anyone but an administrator to workspace settings with an alert, as the Custom CSS page does:
 * `sendAway` with why, and `failed` with an error, which goes to `onFailed` unless the server answered
 * 403.
 */
export function useAdministratorsOnly(onFailed: (error: unknown) => void) {
  const flash = useFlash();
  return useMemo(() => {
    const sendAway = (alert: string) => {
      navigate(WORKSPACE_SETTINGS_PATH, { replace: true });
      flash("alert", alert);
    };
    const failed = (error: unknown) => (error instanceof ApiError && error.status === 403 ? sendAway(error.message) : onFailed(error));
    return { sendAway, failed };
  }, [flash, onFailed]);
}

/**
 * The Chat bots page: what bots do, in short, and Add a chat bot, then each active bot by name, with a
 * link to its settings and, for each room it's in, the commands that post to the room as it, which their
 * buttons copy. A bot of the workspace's can be given a command to answer, and a room's messages to
 * hear, each in the bot's card below. Go Back returns to workspace settings. A bot deleted or renamed
 * elsewhere leaves or is renamed here as soon as the people directory hears of it.
 * The Chat bots page: what bots do, in short, and Add a chat bot, then a row for each active bot by name,
 * with the rooms it's in and a link to its settings. A bot's row opens to its rooms, and each room to the
 * commands that post to it as the bot, which their buttons copy, so a page of many bots stays short. Go
 * Back returns to workspace settings. A bot deleted or renamed elsewhere leaves or is renamed here as soon
 * as the people directory hears of it.
 */
export function BotsPage({ onFailed }: { onFailed: (error: unknown) => void }) {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [commands, setCommands] = useState<Commands | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcuts | null>(null);
  // Why the commands or the shortcuts couldn't be had, which keeps the bots, their addresses and their
  // settings links from hiding behind them, said under the list until another ask answers.
  const [commandsError, setCommandsError] = useState<unknown>(null);
  const [shortcutsError, setShortcutsError] = useState<unknown>(null);
  const people = useContext(PeopleContext);
  const { failed } = useAdministratorsOnly(onFailed);
  useTitle("Chat bots");

  useEffect(() => {
    let stopped = false;
    fetchBots().then(
      (bots) => !stopped && setBots(bots),
      (error: unknown) => {
        // A page left before its bots load only reports a session that's ended, which goes to sign in.
        if (!stopped || isSignedOut(error)) failed(error);
      },
    );
    fetchCommands().then(
      (loaded) => !stopped && setCommands(loaded),
      (error: unknown) => {
        // The addresses below work without them, so why they didn't come is said under the list, as a
        // session that's ended goes to sign in.
        if (!stopped) isSignedOut(error) ? failed(error) : setCommandsError(error);
      },
    );
    fetchShortcuts().then(
      (loaded) => !stopped && setShortcuts(loaded),
      (error: unknown) => {
        if (!stopped) isSignedOut(error) ? failed(error) : setShortcutsError(error);
      },
    );
    return () => void (stopped = true);
  }, [failed]);

  // Reads the commands and the shortcuts again, as registering or forgetting one, or ticking a room,
  // changes them.
  const commandsChanged = useCallback(() => {
    fetchCommands().then(
      (loaded) => {
        setCommands(loaded);
        setCommandsError(null);
      },
      (error: unknown) => !isSignedOut(error) && setCommandsError(error),
    );
    fetchShortcuts().then(
      (loaded) => {
        setShortcuts(loaded);
        setShortcutsError(null);
      },
      (error: unknown) => !isSignedOut(error) && setShortcutsError(error),
    );
  }, []);

  const listed = bots && listedNow(bots, people);
  return (
    <SettingsPage back={WORKSPACE_SETTINGS_PATH}>
      {/* `.panel--wide`: 900px. Spaced as workspace settings' sections are. */}
      <Panel aria-busy={bots === null || commands === null || shortcuts === null} className="flex w-[900px] flex-col gap-6">
        {/*
          Add a chat bot ends the heading's row, as New room does in Rooms and permissions, with the
          explainer under both in lines short enough to read. On phones it follows the explainer, rather
          than wrapping in between them.
        */}
        <header className={cn(SECTION_HEADING, "grid grid-cols-[1fr_auto] items-center gap-x-3 upto-500px:grid-cols-1")}>
          {/* The globe sits beside the heading. */}
          <div className="flex items-center gap-2">
            <h1 id="chat-bots-heading" className={TITLE}>Chat bots</h1>
            <TranslationButton translations="chat_bots" />
          </div>
          <p className="col-span-full mt-1.5 max-w-prose text-muted-foreground">
            Chat bots let other apps and services post in your rooms, and reply when people talk to them.
            Each of a bot's rooms gets two addresses, one for posting text or a file and one that takes a Slack incoming webhook's payload.
            Give a bot a webhook URL, and Ember sends it every message that @mentions it or is sent to it in a DM, then posts whatever it answers within 30 seconds.
            Register a command for a bot, and typing /name in a room it's in sends it what was typed, its answer posted as the bot.
            Register a shortcut, and picking its name in a message's More actions sends it that message, its answer posted as the bot.
            Or set a room to send a bot every message written there, mention or no.
          </p>
          <PageLink
            href={NEW_BOT_PATH}
            aria-label="Add a chat bot"
            className={cn(TITLE_LINK, "col-start-2 row-start-1 upto-500px:col-start-auto upto-500px:row-start-auto upto-500px:mt-4 upto-500px:justify-self-start")}
          >
            <Plus className="size-[18px]" />
            <span>Add a chat bot</span>
          </PageLink>
        </header>
        {/* The bots are listed once they've loaded, whether the commands and shortcuts did or not, which
            each card takes as they come, and why they couldn't be had is said under the list. */}
        <menu className="flex flex-col gap-4">
          {bots &&
            listedNow(bots, people).map((bot) => (
              <BotItem key={bot.id} bot={bot} commands={commands} shortcuts={shortcuts} onChanged={commandsChanged} />
            ))}
        </menu>
        {(commandsError !== null || shortcutsError !== null) && (
          <p role="alert" className="flex flex-wrap items-center gap-x-3 px-1 text-[13px] leading-normal text-negative">
            The workspace's {commandsError !== null && shortcutsError !== null ? "commands and shortcuts" : commandsError !== null ? "commands" : "shortcuts"} couldn't be loaded.
            <button type="button" onClick={commandsChanged} className="cursor-pointer font-semibold underline">
              Try again
            </button>
          </p>
        {/* One card, as wide as the heading, with a row for each bot, as the AI assistant tab lists its agents. */}
        {listed && listed.length > 0 && (
          <menu aria-labelledby="chat-bots-heading" className="flex flex-col rounded-[10px] border bg-surface">
            {listed.map((bot) => (
              <BotItem key={bot.id} bot={bot} />
            ))}
          </menu>
        )}
      </Panel>
    </SettingsPage>
  );
}

/** `bots` as the people directory has them now: by their names now, as the server orders them, and without those it says are gone. */
const listedNow = (bots: Bot[], people: People) =>
  byName(bots.filter(({ id }) => people.get(id)?.status !== "deactivated").map((bot) => ({ ...bot, name: people.get(bot.id)?.name ?? bot.name })));

/** The bot, with its avatar, name and edit link, then its rooms' commands, the commands it answers, and the shortcuts it answers. The commands and shortcuts are null until they've loaded, or once they couldn't be, which shows neither tick nor command. */
function BotItem({ bot, commands, shortcuts, onChanged }: { bot: Bot; commands: Commands | null; shortcuts: Shortcuts | null; onChanged: () => void }) {
  const flash = useFlash();
  // A tick that couldn't be saved is unticked again by the reading that answers, so why it didn't is said.
  const ticked = async (roomId: RoomId, subscribed: boolean) => {
    try {
      if (subscribed) await subscribeBotToMessages(bot.id, roomId);
      else await unsubscribeBotFromMessages(bot.id, roomId);
      onChanged();
    } catch (error) {
      flash("alert", error instanceof ApiError ? error.message : "That couldn't be saved");
    }
  };
  const itsRooms = new Set((commands?.subscriptions ?? []).filter(({ botId }) => botId === bot.id).map(({ roomId }) => roomId));
/**
 * A bot's row: its avatar, linking to its page, its name over the rooms it's in, and its edit link. The
 * name opens the bot to its rooms, unless it's in none, and shows them until it's clicked again.
 */
function BotItem({ bot }: { bot: Bot }) {
  const [open, setOpen] = useState(false);
  const nameId = useId();
  const roomsNamedId = useId();
  const roomsId = useId();
  const named = (
    <span className="min-w-0">
      <strong id={nameId} className="block truncate text-[17px]">
        {bot.name}
      </strong>
      <span id={roomsNamedId} className="block truncate text-[13px] text-muted-foreground">
        {bot.rooms.length === 0 ? NO_ROOMS : roomNames(bot.rooms)}
      </span>
    </span>
  );
  return (
    <li className="flex flex-col gap-3 border-t px-[2ch] py-3 first:border-t-0 max-md:px-3">
      <div className="flex items-center gap-x-[1ch]">
        <AvatarLink user={bot} lazy className="size-[2.65em]" />
        {bot.rooms.length === 0 ? (
          <div className="min-w-0 flex-1">{named}</div>
        ) : (
          <button
            type="button"
            aria-labelledby={nameId}
            aria-describedby={roomsNamedId}
            aria-expanded={open}
            aria-controls={open ? roomsId : undefined}
            onClick={() => setOpen(!open)}
            className={cn(DISCLOSURE, "min-h-11 flex-1")}
          >
            {named}
            <Chevron />
          </button>
        )}
        <PageLink href={botSettingsPath(bot.id)} className={ROUND_BUTTON}>
          <EditPencil className="size-[1.3em]" />
          <span className="sr-only">Edit {bot.name}</span>
        </PageLink>
      </div>
      {bot.rooms.map((room) => (
        <RoomCommands key={room.id} room={room} botKey={bot.key} listening={itsRooms.has(room.id)} onTick={ticked} />
      ))}
      <BotCommands bot={bot} commands={(commands?.commands ?? []).filter(({ bot: { id } }) => id === bot.id)} onChanged={onChanged} />
      <BotShortcuts bot={bot} shortcuts={(shortcuts?.shortcuts ?? []).filter(({ bot: { id } }) => id === bot.id)} onChanged={onChanged} />
      {open && (
        <ul id={roomsId} aria-label={`Rooms for ${bot.name}`} className="flex flex-col rounded-[10px] border bg-background">
          {bot.rooms.map((room) => (
            <RoomItem key={room.id} room={room} botKey={bot.key} startsOpen={bot.rooms.length === 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The commands that post to `room` as the bot whose key is `botKey`, and its Slack-compatible webhook, in
 * a fieldset with the room's name on its border, with the room's tick for the bot's hearing its messages.
 */
function RoomCommands({ room, botKey, listening, onTick }: { room: BotRoom; botKey: string; listening: boolean; onTick: (roomId: RoomId, subscribed: boolean) => void }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-x-[1ch] gap-y-4 rounded-[10px] border border-muted-foreground px-[1ch] py-4">
      <legend className="mx-auto flex max-w-full min-w-0 justify-center px-[1ch] text-start">
        <strong className="truncate">{room.name}</strong>
      </legend>
      <PostingCommands room={room} botKey={botKey} />
      <label className="flex min-h-[24px] cursor-pointer items-center gap-[7px] text-[13px] leading-[18px] text-message-muted touch:min-h-11">
        <input
          type="checkbox"
          checked={listening}
          onChange={(event) => onTick(room.id, event.target.checked)}
          className="m-0 size-4 flex-none cursor-pointer accent-foreground"
        />
        <span>
          Send it <strong className="font-semibold text-message-ink">every message</strong> posted here, mention or no
        </span>
      </label>
    </fieldset>
 * One of a bot's rooms: its name, which opens to the commands that post to the room as the bot whose key
 * is `botKey`, and its Slack-compatible webhook, in a group named for the room. A bot's only room starts
 * open, as there's no other to choose.
 */
function RoomItem({ room, botKey, startsOpen }: { room: BotRoom; botKey: string; startsOpen: boolean }) {
  const [open, setOpen] = useState(startsOpen);
  const commandsId = useId();
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? commandsId : undefined}
        onClick={() => setOpen(!open)}
        className={cn(DISCLOSURE, "min-h-10 w-full px-[1.5ch] touch:min-h-11")}
      >
        <span className="truncate font-medium">{room.name}</span>
        <Chevron />
      </button>
      {open && (
        <div id={commandsId} role="group" aria-label={room.name} className="flex min-w-0 flex-col gap-3 px-[1.5ch] pb-4">
          <PostingCommands room={room} botKey={botKey} />
        </div>
      )}
    </li>
  );
}

/** The arrow at the end of a row that opens, which turns to point down while it's open. */
function Chevron() {
  return (
    <NavArrowRight className="ms-auto size-[18px] shrink-0 text-muted-foreground transition-transform duration-150 ease-[ease] group-hover:text-foreground group-aria-expanded:rotate-90" />
  );
}

/** The commands that post to `room` as the bot whose key is `botKey`, and its Slack-compatible webhook, each with a button that copies it. */
export function PostingCommands({ room, botKey }: { room: BotRoom; botKey: string }) {
  const url = new URL(botMessagesPath(room.id, botKey), location.origin).href;
  return (
    <>
      <Command
        icon={<ChatBubbleEmpty className="size-6 flex-none" />}
        command={curlTextLine(url)}
        label="curl command for posting messages"
        copyLabel="Copy message command"
      />
      <Command
        icon={<Attachment className="size-6 flex-none" />}
        command={curlUploadLine(url)}
        label="curl command for posting attachments"
        copyLabel="Copy attachment command"
      />
      <Command
        icon={<Internet className="size-6 flex-none" />}
        command={new URL(botSlackPath(room.id, botKey), location.origin).href}
        label="Slack-compatible webhook URL"
        copyLabel="Copy Slack-compatible webhook URL"
      />
    </>
  );
}

function Command({ icon, command, label, copyLabel }: { icon: ReactNode; command: string; label: string; copyLabel: string }) {
  return (
    <div className="flex items-center gap-x-[1ch]">
      {icon}
      <div className="min-w-0 grow">
        {/* A command is there to be copied, so Enter in one doesn't send a form around it, as the bot form is. */}
        <input type="text" value={command} aria-label={label} readOnly onKeyDown={(event) => event.key === "Enter" && event.preventDefault()} className={INPUT} />
      </div>
      {/* `.txt-small`, which draws the icon smaller. */}
      <div className="text-[0.8rem]">
        <CopyButton text={command} label={copyLabel} className={ROUND_BUTTON} />
      </div>
    </div>
  );
}

/**
 * The commands registered for `bot`, each with a button that takes it away, and the form that registers
 * another: its name, which typing finds without its case, and what it's for, which the composer's menu
 * says. A name the workspace has given another bot already is refused, as the server keeps the names
 * apart.
 */
function BotCommands({ bot, commands, onChanged }: { bot: Bot; commands: Command[]; onChanged: () => void }) {
  const flash = useFlash();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const said = (error: unknown, otherwise: string) => flash("alert", error instanceof ApiError ? error.message : otherwise);

  const registered = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || name.trim() === "") return;
    setSaving(true);
    try {
      await registerCommand({ botId: bot.id, name, ...(description.trim() !== "" && { description: description.trim() }) });
      setName("");
      setDescription("");
      onChanged();
    } catch (error) {
      said(error, "That command couldn't be registered");
    } finally {
      setSaving(false);
    }
  };

  const forgot = async (command: Command) => {
    try {
      await removeCommand(command.id);
      onChanged();
    } catch (error) {
      said(error, "That command couldn't be taken away");
    }
  };

  return (
    <section aria-label="Commands" className="flex flex-col gap-y-3">
      <h2 className="text-[15px] font-semibold text-message-ink">Commands</h2>
      {commands.map((command) => (
        <div key={command.id} className="flex items-center gap-x-[1ch]">
          <Terminal className="size-5 flex-none opacity-70" />
          <div className="min-w-0">
            <div className="truncate text-[14px] leading-5">
              <strong>/{command.name}</strong>
            </div>
            {command.description !== null && <div className="truncate text-[13px] leading-[18px] text-muted-foreground">{command.description}</div>}
          </div>
          <button type="button" onClick={() => void forgot(command)} className={cn(ROUND_BUTTON, "ms-auto")}>
            <Trash className="size-[1.3em]" />
            <span className="sr-only">Forget /{command.name}</span>
          </button>
        </div>
      ))}
      <form onSubmit={(event) => void registered(event)} className="flex flex-wrap items-center gap-x-[1ch] gap-y-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={`A command's name for ${bot.name}`}
          placeholder="/deploy"
          className={cn(INPUT, "min-w-0 grow basis-40")}
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          aria-label={`What ${bot.name}'s command is for`}
          placeholder="What it's for"
          className={cn(INPUT, "min-w-0 grow basis-40")}
        />
        <button type="submit" disabled={saving || name.trim() === ""} className={cn(BUTTON, "touch:min-h-11")}>
          Register
        </button>
      </form>
      <p className="max-w-prose text-[13px] leading-[18px] text-muted-foreground">
        Typing a command's name in a room {bot.name} is in sends it what was typed after it, and what it answers is posted as the bot.
      </p>
    </section>
  );
}

/**
 * The shortcuts registered for `bot`, each with a button that takes it away, and the form that registers
 * another: its name, as it's shown ("Translate this"), and what it's for, which its item in More actions
 * sits beside. A name one of the workspace's shortcuts has already is refused, as the server keeps the
 * names apart.
 */
function BotShortcuts({ bot, shortcuts, onChanged }: { bot: Bot; shortcuts: Shortcut[]; onChanged: () => void }) {
  const flash = useFlash();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const said = (error: unknown, otherwise: string) => flash("alert", error instanceof ApiError ? error.message : otherwise);

  const registered = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || name.trim() === "") return;
    setSaving(true);
    try {
      await registerShortcut({ botId: bot.id, name, ...(description.trim() !== "" && { description: description.trim() }) });
      setName("");
      setDescription("");
      onChanged();
    } catch (error) {
      said(error, "That shortcut couldn't be registered");
    } finally {
      setSaving(false);
    }
  };

  const forgot = async (shortcut: Shortcut) => {
    try {
      await removeShortcut(shortcut.id);
      onChanged();
    } catch (error) {
      said(error, "That shortcut couldn't be taken away");
    }
  };

  return (
    <section aria-label="Shortcuts" className="flex flex-col gap-y-3">
      <h2 className="text-[15px] font-semibold text-message-ink">Shortcuts</h2>
      {shortcuts.map((shortcut) => (
        <div key={shortcut.id} className="flex items-center gap-x-[1ch]">
          <Sparks className="size-5 flex-none opacity-70" />
          <div className="min-w-0">
            <div className="truncate text-[14px] leading-5">
              <strong>{shortcut.name}</strong>
            </div>
            {shortcut.description !== null && <div className="truncate text-[13px] leading-[18px] text-muted-foreground">{shortcut.description}</div>}
          </div>
          <button type="button" onClick={() => void forgot(shortcut)} className={cn(ROUND_BUTTON, "ms-auto")}>
            <Trash className="size-[1.3em]" />
            <span className="sr-only">Forget {shortcut.name}</span>
          </button>
        </div>
      ))}
      <form onSubmit={(event) => void registered(event)} className="flex flex-wrap items-center gap-x-[1ch] gap-y-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={`A shortcut's name for ${bot.name}`}
          placeholder="Translate this"
          className={cn(INPUT, "min-w-0 grow basis-40")}
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          aria-label={`What ${bot.name}'s shortcut is for`}
          placeholder="What it's for"
          className={cn(INPUT, "min-w-0 grow basis-40")}
        />
        <button type="submit" disabled={saving || name.trim() === ""} className={cn(BUTTON, "touch:min-h-11")}>
          Register
        </button>
      </form>
      <p className="max-w-prose text-[13px] leading-[18px] text-muted-foreground">
        A shortcut's name shows in every message's More actions, and picking it sends that message to {bot.name}, whose answer is posted as the bot.
      </p>
    </section>
  );
}
