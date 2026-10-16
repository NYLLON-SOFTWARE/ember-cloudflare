import { useEffect, useLayoutEffect, useState, type FormEvent } from "react";
import { BOTS_FORBIDDEN, MAX_WEBHOOK_URL_LENGTH, type BotChanges, type BotSettings, type Me, type UserId } from "@ember/protocol";
import { AUTH_FORM } from "@/components/auth-page";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { Refresh } from "@/components/icons/campfire";
import { Input } from "@/components/ui/input";
import { useMounted } from "@/hooks/use-mounted";
import { BOTS_PATH, navigate } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { changeBot, createBot, deleteBot, fetchBot, isSignedOut, resetBotKey } from "@/lib/api";
import { useAdministratorsOnly } from "./bots-page";
import { DeleteButton, isMissing, NEGATIVE_BUTTON } from "./room-settings-page";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

// ember-rust's pages for adding a bot and changing one (accounts/bots/new.html and edit.html), which
// share its bot form (accounts/bots/_form.html) and go back to the bots page once they've saved.

/** What Delete bot asks first, as ember-rust's does, in the browser's own dialog as Turbo asks it. */
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
 * The fields typed differently from `bot` as it loaded. Only they're sent, where ember-rust's form sends
 * both, so a save doesn't put back what another administrator has saved since.
 */
function changesOf(bot: BotSettings, typed: Fields): BotChanges {
  const loaded = fieldsOf(bot);
  const changes: BotChanges = {};
  if (typed.name !== loaded.name) changes.name = typed.name;
  if (typed.webhookUrl !== loaded.webhookUrl) changes.webhookUrl = typed.webhookUrl;
  return changes;
}

/**
 * Goes back to the bots page once `request` succeeds, as ember-rust redirects there. A request that
 * fails says why, where it was made from, unless the page has been left, which only a session that's
 * ended is reported from.
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
  const { sendAway, failed } = useAdministratorsOnly(onFailed);
  const [saving, send] = useSending(failed);
  useTitle("New chat bot");

  // Before the form paints, as ember-rust answers anyone else 403 instead of showing it.
  useLayoutEffect(() => {
    if (!me.administrator) sendAway(BOTS_FORBIDDEN);
  }, [me.administrator, sendAway]);

  return (
    <SettingsPage back={BOTS_PATH}>
      <Panel>
        <BotForm fields={fields} onChange={setFields} saving={saving} onSave={() => send(() => createBot(fields))} />
      </Panel>
    </SettingsPage>
  );
}

interface SettingsProps {
  botId: UserId;
  /** For an id that isn't an active bot's, which ember-rust answers with its 404 page. */
  onMissing: () => void;
  /** Says why something else failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * A bot's settings, which only administrators may open: the bot form, then Delete bot, which takes the
 * bot out of every room but its DMs, and Generate a new key, which stops its old key working. Each asks
 * first, as ember-rust's do.
 */
export function BotSettingsPage({ botId, onMissing, onFailed }: SettingsProps) {
  const [bot, setBot] = useState<BotSettings | null>(null);
  const [fields, setFields] = useState(NO_FIELDS);
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
            <BotForm fields={fields} onChange={setFields} saving={busy} onSave={() => send(() => changeBot(botId, changesOf(bot, fields)))} />
            <hr className="my-8 w-full" />
            <div className="flex flex-wrap items-center justify-between gap-x-[1ch] gap-y-4">
              <DeleteButton label="Delete this chat bot" text="Delete bot" disabled={busy} onClick={remove} />
              <button type="button" aria-label="Generate a new key" disabled={busy} onClick={newKey} className={NEGATIVE_BUTTON}>
                <Refresh tone="white" width={20} height={20} className="size-[1.3em] shrink-0" />
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
  fields: Fields;
  onChange: (fields: Fields) => void;
  /** Whether the form or one of the page's buttons is on its way to the server, which Save changes waits for. */
  saving: boolean;
  onSave: () => void;
}

/**
 * ember-rust's bot form: Chat bot setup, the bot's name and its webhook URL, each with a translation
 * button, and Save changes. There's no avatar picker until photos are stored, as the profile has none.
 */
function BotForm({ fields, onChange, saving, onSave }: FormProps) {
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!saving) onSave();
  };

  return (
    <form onSubmit={save} className={AUTH_FORM}>
      <PageHeading title="Chat bot setup">Connect a bot to your workspace and choose where updates are delivered.</PageHeading>
      <Field id="user_name" label="Bot name" translation="bot_name">
        <Input
          id="user_name"
          autoComplete="name"
          placeholder="Name the bot"
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
