import { useEffect, useLayoutEffect, useState, type FormEvent } from "react";
import { MAX_USER_NAME_LENGTH, type Me, type UserId } from "@ember/protocol";
import { BOTS_FORBIDDEN, MAX_WEBHOOK_URL_LENGTH, type BotChanges, type BotSettings } from "@ember/protocol/bots";
import { AUTH_FORM } from "@/components/auth-page";
import defaultBotAvatar from "@/components/default-bot-avatar.svg";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { Camera, RefreshDouble } from "@/components/icons/iconoir";
import { Input } from "@/components/ui/input";
import { useChosenPhoto, type PhotoChoice } from "@/hooks/use-chosen-photo";
import { useMounted } from "@/hooks/use-mounted";
import { BOTS_PATH, navigate } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { changeBot, createBot, deleteBot, fetchBot, isSignedOut, resetBotKey } from "@/lib/api";
import { useAdministratorsOnly } from "./bots-page";
import { DeleteButton, isMissing, NEGATIVE_BUTTON } from "./room-settings-page";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

// The pages for adding a bot and changing one, which share the bot form and go back to the bots page
// once they've saved.

/** What Delete bot asks first, in the browser's own dialog. */
export const CONFIRM_DELETE_BOT = "Are you sure you want to permanently remove this bot from the account? This can’t be undone.";

/** What Generate a new key asks first. */
export const CONFIRM_NEW_KEY = "Are you sure you want to change the bot key? All usage of this bot must be updated.";

/** The bot form's fields as typed: the bot's name, and where its webhook delivers, "" for nowhere. */
interface Fields {
  name: string;
  webhookUrl: string;
}

const NO_FIELDS: Fields = { name: "", webhookUrl: "" };

const fieldsOf = (bot: BotSettings): Fields => ({ name: bot.name, webhookUrl: bot.webhookUrl ?? "" });

/**
 * The fields typed differently from `bot` as it loaded. Only they're sent, so a save doesn't put back
 * what another administrator has saved since.
 */
function changesOf(bot: BotSettings, typed: Fields): BotChanges {
  const loaded = fieldsOf(bot);
  const changes: BotChanges = {};
  if (typed.name !== loaded.name) changes.name = typed.name;
  if (typed.webhookUrl !== loaded.webhookUrl) changes.webhookUrl = typed.webhookUrl;
  return changes;
}

/**
 * Goes back to the bots page once `request` succeeds. A request that fails says why, where it was made
 * from, unless the page has been left, which only a session that's ended is reported from.
 */
function useSending(failed: (error: unknown) => void): [boolean, (request: () => Promise<void>) => void] {
  const [sending, setSending] = useState(false);
  const mounted = useMounted();
  const send = (request: () => Promise<void>) => {
    setSending(true);
    request().then(
      () => mounted.current && navigate(BOTS_PATH),
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSending(false);
        failed(error);
      },
    );
  };
  return [sending, send];
}

/** Add a chat bot, which only administrators may open: anyone else is sent to workspace settings at once. */
export function NewBotPage({ me, onFailed }: { me: Me; onFailed: (error: unknown) => void }) {
  const [fields, setFields] = useState(NO_FIELDS);
  const photo = useChosenPhoto();
  const { sendAway, failed } = useAdministratorsOnly(onFailed);
  const [saving, send] = useSending(failed);
  useTitle("New chat bot");

  // Before the form paints, so anyone else never sees it.
  useLayoutEffect(() => {
    if (!me.administrator) sendAway(BOTS_FORBIDDEN);
  }, [me.administrator, sendAway]);

  return (
    <SettingsPage back={BOTS_PATH}>
      <Panel>
        <BotForm
          avatar={defaultBotAvatar}
          photo={photo}
          fields={fields}
          onChange={setFields}
          saving={saving}
          onSave={() => send(async () => createBot(fields, await photo.photo()))}
        />
      </Panel>
    </SettingsPage>
  );
}

interface SettingsProps {
  botId: UserId;
  /** For an id that isn't an active bot's, which gets the 404 page. */
  onMissing: () => void;
  /** Says why something else failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * A bot's settings, which only administrators may open: the bot form, then Delete bot, which takes the
 * bot out of every room but its DMs, and Generate a new key, which stops its old key working. Each asks
 * first.
 */
export function BotSettingsPage({ botId, onMissing, onFailed }: SettingsProps) {
  const [bot, setBot] = useState<BotSettings | null>(null);
  const [fields, setFields] = useState(NO_FIELDS);
  const photo = useChosenPhoto();
  const administratorsOnly = useAdministratorsOnly(onFailed);
  const failed = (error: unknown) => (isMissing(error) ? onMissing() : administratorsOnly.failed(error));
  const [busy, send] = useSending(failed);
  useTitle("Edit bot");

  useEffect(() => {
    let stopped = false;
    fetchBot(botId).then(
      (bot) => {
        if (stopped) return;
        setBot(bot);
        setFields(fieldsOf(bot));
      },
      (error: unknown) => {
        // A page left before its bot loads only reports a session that's ended, which goes to sign in.
        if (stopped && !isSignedOut(error)) return;
        if (isMissing(error)) onMissing();
        else administratorsOnly.failed(error);
      },
    );
    return () => void (stopped = true);
  }, [botId, onMissing, administratorsOnly]);

  const remove = () => {
    if (confirm(CONFIRM_DELETE_BOT)) send(() => deleteBot(botId));
  };
  const newKey = () => {
    if (confirm(CONFIRM_NEW_KEY)) send(() => resetBotKey(botId));
  };
  return (
    <SettingsPage back={BOTS_PATH}>
      <Panel aria-busy={bot === null}>
        {bot && (
          <>
            <BotForm
              avatar={bot.avatarUrl}
              photo={photo}
              fields={fields}
              onChange={setFields}
              saving={busy}
              onSave={() => send(async () => changeBot(botId, changesOf(bot, fields), await photo.photo()))}
            />
            <hr className="my-8 w-full" />
            <div className="flex flex-wrap items-center justify-between gap-x-[1ch] gap-y-4">
              <DeleteButton label="Delete this chat bot" text="Delete bot" disabled={busy} onClick={remove} />
              <button type="button" aria-label="Generate a new key" disabled={busy} onClick={newKey} className={NEGATIVE_BUTTON}>
                <RefreshDouble className="size-[1.3em] shrink-0" />
                <span className="truncate">Generate a new key</span>
              </button>
            </div>
          </>
        )}
      </Panel>
    </SettingsPage>
  );
}

interface FormProps {
  /** The bot's avatar as it is: its own, or Campfire's default bot picture, which the Worker serves for a bot without one. */
  avatar: string;
  /** The picture chosen to be its avatar, which saves with the form. */
  photo: PhotoChoice;
  fields: Fields;
  onChange: (fields: Fields) => void;
  /** Whether the form or one of the page's buttons is on its way to the server, which Save changes waits for. */
  saving: boolean;
  onSave: () => void;
}

/**
 * The bot form: Chat bot setup, the bot's avatar, its name and its webhook URL, each with a translation
 * button, and Save changes, which saves a picture chosen for its avatar too.
 */
function BotForm({ avatar, photo, fields, onChange, saving, onSave }: FormProps) {
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!saving) onSave();
  };

  return (
    <form onSubmit={save} className={AUTH_FORM}>
      <PageHeading title="Chat bot setup">Connect a bot to your workspace and choose where updates are delivered.</PageHeading>
      <AvatarField src={avatar} photo={photo} disabled={saving} />
      <Field id="user_name" label="Bot name" translation="bot_name">
        <Input
          id="user_name"
          autoComplete="name"
          placeholder="Name the bot"
          maxLength={MAX_USER_NAME_LENGTH}
          autoFocus
          required
          data-1p-ignore
          value={fields.name}
          onChange={(event) => onChange({ ...fields, name: event.target.value })}
          className={FIELD_INPUT}
        />
      </Field>
      <Field id="user_webhook_url" label="Webhook URL" translation="webhook_url">
        <Input
          id="user_webhook_url"
          type="url"
          placeholder="Webhook URL"
          maxLength={MAX_WEBHOOK_URL_LENGTH}
          value={fields.webhookUrl}
          onChange={(event) => onChange({ ...fields, webhookUrl: event.target.value })}
          className={FIELD_INPUT}
        />
      </Field>
      <SubmitButton disabled={saving}>Save changes</SubmitButton>
    </form>
  );
}

/**
 * The bot's avatar field, styled by Campfire's avatars.css and inputs.css: Upload bot avatar, a circle
 * `.btn` the file field fills, unseen, beside the bot's avatar, which shows a picture as it's chosen, as
 * Campfire's upload_preview_controller.js shows it. They're the middle columns of three, the last empty and
 * as wide as the first, so the avatar is centered over the form, and both are 36px, or 44px for fingers.
 * Pressing any of it picks a picture, as it's all one label, but not while the form is sent with it. Ember
 * says why a picture over 16 MB isn't kept.
 */
function AvatarField({ src, photo, disabled }: { src: string; photo: PhotoChoice; disabled: boolean }) {
  return (
    <div className="mb-3 grid justify-items-center gap-2">
      <label className="grid cursor-pointer grid-cols-[1fr_auto_1fr] items-center gap-x-[1ch] has-[input:disabled]:cursor-default">
        <span className="relative grid size-9 place-items-center rounded-full border bg-background touch:size-11 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-foreground">
          <Camera className="h-5 w-[1.6em]" />
          <input
            ref={photo.input}
            id="user_avatar"
            type="file"
            accept="image/*"
            aria-invalid={photo.refusal ? true : undefined}
            disabled={disabled}
            onChange={photo.choose}
            className="absolute inset-0 size-full cursor-pointer rounded-full opacity-0 disabled:cursor-default"
          />
          <span className="sr-only">Upload bot avatar</span>
        </span>
        <img src={photo.preview ?? src} alt="Bot avatar" width={48} height={48} className="aspect-square size-9 rounded-full object-cover touch:size-11" />
      </label>
      {photo.refusal && (
        <p role="alert" className="text-[0.8rem] text-destructive">
          {photo.refusal}
        </p>
      )}
    </div>
  );
}
