import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { botMessagesPath, type Bot, type BotRoom } from "@ember/protocol";
import { PRIMARY_BUTTON } from "@/components/field";
import { useFlash } from "@/components/flash";
import { Add, Attachment, MessagesOutlined, Pencil } from "@/components/icons/campfire";
import { PageLink } from "@/components/page-link";
import { TranslationButton } from "@/components/translation-button";
import { Button } from "@/components/ui/button";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { botSettingsPath, navigate, NEW_BOT_PATH, WORKSPACE_SETTINGS_PATH } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { ApiError, fetchBots, isSignedOut } from "@/lib/api";
import { byName } from "@/lib/people";
import { cn } from "@/lib/utils";
import { CopyButton, ROUND_BUTTON } from "./link-buttons";
import { Panel, SettingsPage } from "./settings-page";
import { AvatarLink } from "./user-avatar";

/** The command ember-rust's bots page gives for posting a message as a bot to `url` (helpers/users.rs, `curl_text_line`). */
export const curlTextLine = (url: string) => `curl -d 'Hello!' ${url}`;

/** And for posting a file (`curl_upload_line`). */
export const curlUploadLine = (url: string) => `curl -F "attachment=@/path/to/file" ${url}`;

/** Campfire's `.input.fill-white` as ember-rust draws it in a panel (zz-ember.css): 42px tall, or 44px for fingers. */
const INPUT = "min-h-[42px] w-full min-w-0 rounded-[9px] border bg-background px-[0.8em] py-[0.5em] text-base focus:border-muted-foreground touch:min-h-11";

/**
 * Sends anyone but an administrator to workspace settings with an alert, as the Custom CSS page does,
 * where ember-rust's bot pages answer an empty 403 page: `sendAway` with why, and `failed` with an
 * error, which goes to `onFailed` unless the server answered 403.
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
 * ember-rust's Chat bots page (accounts/bots/index.html and _bot.html): Add a chat bot, then each active
 * bot by name, with a link to its settings and, for each room it's in, the commands that post to the
 * room as it, which their buttons copy. Go Back returns to workspace settings. Unlike ember-rust's, a bot
 * deleted or renamed elsewhere leaves or is renamed here as soon as the people directory hears of it.
 */
export function BotsPage({ onFailed }: { onFailed: (error: unknown) => void }) {
  const [bots, setBots] = useState<Bot[] | null>(null);
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
    return () => void (stopped = true);
  }, [failed]);

  return (
    <SettingsPage back={WORKSPACE_SETTINGS_PATH}>
      {/* `.panel--wide`: 900px. */}
      <Panel aria-busy={bots === null} className="w-[900px]">
        <header className="mb-6">
          {/* ember-rust puts the globe at the panel's corner, `.panel__button`, over the start of the heading. */}
          <div className="mb-1.5 flex items-center gap-2">
            <h1 className="text-[23px] leading-[1.3] font-[650]">Chat bots</h1>
            <TranslationButton translations="chat_bots" />
          </div>
          <p className="text-muted-foreground">With Chat bots, other sites and services can post updates directly to Ember.</p>
          <Button asChild className={PRIMARY_BUTTON}>
            <PageLink href={NEW_BOT_PATH} aria-label="Add a chat bot">
              <Add tone="reversed" width={20} height={20} className="h-5 w-[1.3em]" />
              <span>Add a chat bot</span>
            </PageLink>
          </Button>
        </header>
        <div className="px-[1ch] pt-4">
          <menu className="m-0 flex flex-col gap-4 px-[1ch] py-4">
            {bots &&
              listedNow(bots, people).map((bot) => (
                <BotItem key={bot.id} bot={bot} />
              ))}
          </menu>
        </div>
      </Panel>
    </SettingsPage>
  );
}

/** `bots` as the people directory has them now: by their names now, as the server orders them, and without those it says are gone. */
const listedNow = (bots: Bot[], people: People) =>
  byName(bots.filter(({ id }) => people.get(id)?.status !== "deactivated").map((bot) => ({ ...bot, name: people.get(bot.id)?.name ?? bot.name })));

/** ember-rust's accounts/bots/_bot.html: the bot, with its avatar, name and edit link, then its rooms' commands. */
function BotItem({ bot }: { bot: Bot }) {
  return (
    <li className="flex flex-col gap-x-[1ch] gap-y-4 rounded-[10px] border bg-surface px-[2ch] py-4">
      <div className="flex items-center gap-x-[1ch]">
        <AvatarLink user={bot} lazy className="size-[2.65em]" />
        <div className="min-w-0">
          <div className="truncate text-[17px]">
            <strong>{bot.name}</strong>
          </div>
        </div>
        <PageLink href={botSettingsPath(bot.id)} className={cn(ROUND_BUTTON, "ml-auto")}>
          <Pencil width={20} height={20} className="size-[1.3em]" />
          <span className="sr-only">Edit {bot.name}</span>
        </PageLink>
      </div>
      {bot.rooms.map((room) => (
        <RoomCommands key={room.id} room={room} botKey={bot.key} />
      ))}
    </li>
  );
}

/** The commands that post to `room` as the bot whose key is `botKey`, in a fieldset with the room's name on its border. */
function RoomCommands({ room, botKey }: { room: BotRoom; botKey: string }) {
  const url = new URL(botMessagesPath(room.id, botKey), location.origin).href;
  return (
    <fieldset className="flex min-w-0 flex-col gap-x-[1ch] gap-y-4 rounded-[10px] border border-muted-foreground px-[1ch] py-4">
      <legend className="mx-auto flex max-w-full min-w-0 justify-center px-[1ch] text-start">
        <strong className="truncate">{room.name}</strong>
      </legend>
      <Command
        icon={<MessagesOutlined width={24} height={24} className="size-6 flex-none" />}
        command={curlTextLine(url)}
        label="curl command for posting messages"
        copyLabel="Copy message command"
      />
      <Command
        icon={<Attachment width={24} height={24} className="size-6 flex-none" />}
        command={curlUploadLine(url)}
        label="curl command for posting attachments"
        copyLabel="Copy attachment command"
      />
    </fieldset>
  );
}

function Command({ icon, command, label, copyLabel }: { icon: ReactNode; command: string; label: string; copyLabel: string }) {
  return (
    <div className="flex items-center gap-x-[1ch]">
      {icon}
      <div className="min-w-0 grow">
        <input type="text" value={command} aria-label={label} readOnly className={INPUT} />
      </div>
      {/* `.txt-small`, which draws the icon smaller. */}
      <div className="text-[0.8rem]">
        <CopyButton text={command} label={copyLabel} className={ROUND_BUTTON} />
      </div>
    </div>
  );
}
