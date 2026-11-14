import { useCallback, useEffect, useLayoutEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Me } from "@ember/protocol";
import { APPS_FORBIDDEN, MAX_APP_NAME_LENGTH, MAX_APP_TOKEN_LENGTH, MAX_APP_TOOLS, MAX_APP_URL_LENGTH, type App, type AppChanges, type AppId, type AppRefused, type NewApp } from "@ember/protocol/apps";
import { AUTH_FORM } from "@/components/auth-page";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { useFlash } from "@/components/flash";
import { RefreshDouble } from "@/components/icons/iconoir";
import { Input } from "@/components/ui/input";
import { useMounted } from "@/hooks/use-mounted";
import { appSettingsPath, navigate } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { ApiError, changeApp, connectApp, disconnectApp, fetchApp, fetchApps, isSignedOut, readAppTools } from "@/lib/api";
import { dateTimeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { AGENTS_PATH, useAgentsOnly } from "./agent-list";
import { toolsOf } from "./app-list";
import { BUTTON } from "./email-settings";
import { DeleteButton, isMissing } from "./room-settings-page";
import { CHANGES_SAVED, PageHeading, Panel, SettingsPage } from "./settings-page";

// The pages for connecting an app and changing one, which share the app form. Connecting one goes on to
// its page, which lists the tools Ember read from its server, and can read them again.

/** What Remove app asks first, in the browser's own dialog. */
export const CONFIRM_REMOVE_APP = "Are you sure you want to remove this app? Ember forgets its token and the tools it read.";

/** What the form says while Ember asks an app's server for its tools, which can take a while. */
export const READING_TOOLS = "Reading its tools…";

/** What each field is for. */
export const URL_EXPLAINED = "Where its MCP server is, which the app's documentation gives. It often ends in /mcp.";
export const TOKEN_EXPLAINED = "Optional. Ember sends it to the server with every request, keeps it encrypted, and never shows it again.";
export const TOKEN_KEPT = "It has a token. Leave this blank to keep it, or type another.";

const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

/** A card of the page, as the workspace settings' cards are. */
const CARD = "flex min-w-0 flex-col gap-4 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3";

type AppField = NonNullable<AppRefused["field"]>;

/** The app form's fields as typed: its name, its server's address, a token to send it, and whether to stop sending the one it has. */
interface Fields {
  name: string;
  url: string;
  token: string;
  noToken: boolean;
}

const NO_FIELDS: Fields = { name: "", url: "", token: "", noToken: false };

const fieldsOf = (app: App): Fields => ({ ...NO_FIELDS, name: app.name, url: app.url });

/** Why what the form sends is refused, said on the field it's about, or else, with none, under its button. */
interface Refusal {
  field: AppField | null;
  error: string;
}

const APP_FIELDS: readonly string[] = ["name", "url", "token"] satisfies AppField[];

/** What a 422 answer says is refused, on the field of the form it names, if it names one. */
const refusalOf = (error: unknown): Refusal | null =>
  error instanceof ApiError && error.status === 422 ? { field: error.field !== undefined && APP_FIELDS.includes(error.field) ? (error.field as AppField) : null, error: error.message } : null;

/** The app the form asks Ember to connect. */
const newAppOf = ({ name, url, token }: Fields): NewApp => ({ name, url, ...(token.trim() !== "" && { token }) });

/**
 * The fields typed differently from `app` as it loaded. Only they're sent, so a save doesn't put back
 * what another administrator has saved since, and Ember reads the server's tools again only for another
 * address or token.
 */
export function changesOf(app: App, typed: Fields): AppChanges {
  const changes: AppChanges = {};
  if (typed.name.trim() !== app.name) changes.name = typed.name;
  if (typed.url.trim() !== app.url) changes.url = typed.url;
  if (typed.token.trim() !== "") changes.token = typed.token;
  else if (typed.noToken && app.hasToken) changes.token = "";
  return changes;
}

interface PageProps {
  me: Me;
  /** Says why something failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** Connect an app, which only administrators may open while Ember AI is on: anyone else is sent away at once, as from the agents' pages. */
export function NewAppPage({ me, onFailed }: PageProps) {
  const [ready, setReady] = useState(false);
  const [fields, setFields] = useState(NO_FIELDS);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [connecting, setConnecting] = useState(false);
  const { forbidden, failed } = useAgentsOnly(onFailed);
  const flash = useFlash();
  const mounted = useMounted();
  useTitle("Connect an app");

  // Before the form paints, so anyone else never sees it.
  useLayoutEffect(() => {
    if (!me.administrator) forbidden(APPS_FORBIDDEN);
  }, [me.administrator, forbidden]);

  // Listing the apps says whether Ember AI is on, before anything is typed.
  useEffect(() => {
    if (!me.administrator) return;
    let stopped = false;
    fetchApps().then(
      () => !stopped && setReady(true),
      (error: unknown) => {
        if (!stopped || isSignedOut(error)) failed(error);
      },
    );
    return () => void (stopped = true);
  }, [me.administrator, failed]);

  const connect = () => {
    setConnecting(true);
    setRefusal(null);
    connectApp(newAppOf(fields)).then(
      (app) => {
        if (!mounted.current) return;
        navigate(appSettingsPath(app.id));
        flash("notice", `${app.name} is connected. Ember read ${toolsOf(app.tools.length)} from it.`);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setConnecting(false);
        const refused = refusalOf(error);
        if (refused) setRefusal(refused);
        else failed(error);
      },
    );
  };

  return (
    <SettingsPage back={AGENTS_PATH}>
      <Panel aria-busy={!ready}>
        {ready && (
          <AppForm
            saved={null}
            fields={fields}
            onChange={(fields) => {
              setFields(fields);
              setRefusal(null);
            }}
            refusal={refusal}
            busy={connecting}
            reading={connecting}
            canSave
            onSave={connect}
          />
        )}
      </Panel>
    </SettingsPage>
  );
}

/** What the page is doing, which its buttons wait for. */
type Busy = "saving" | "reading" | "removing" | null;

/**
 * A connected app's page, which only administrators may open while Ember AI is on, as Connect an app: the
 * app form, then the tools Ember read from its server, with Read its tools again, and Remove app, which
 * asks first. An id that isn't a connected app's gets the 404 page.
 */
export function AppSettingsPage({ appId, me, onMissing, onFailed }: PageProps & { appId: AppId; onMissing: () => void }) {
  const [app, setApp] = useState<App | null>(null);
  const [fields, setFields] = useState(NO_FIELDS);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [unread, setUnread] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const { forbidden, failed: agentsOnly } = useAgentsOnly(onFailed);
  const failed = useCallback((error: unknown) => (isMissing(error) ? onMissing() : agentsOnly(error)), [onMissing, agentsOnly]);
  const flash = useFlash();
  const mounted = useMounted();
  useTitle("Edit app");

  useLayoutEffect(() => {
    if (!me.administrator) forbidden(APPS_FORBIDDEN);
  }, [me.administrator, forbidden]);

  const show = useCallback((app: App) => {
    setApp(app);
    setFields(fieldsOf(app));
  }, []);

  useEffect(() => {
    if (!me.administrator) return;
    let stopped = false;
    fetchApp(appId).then(
      (app) => !stopped && show(app),
      (error: unknown) => {
        // A page left before its app loads only reports a session that's ended, which goes to sign in.
        if (!stopped || isSignedOut(error)) failed(error);
      },
    );
    return () => void (stopped = true);
  }, [me.administrator, appId, show, failed]);

  /** Sends `request`, which `doing` says the page is busy with, then does `done` with what it answers, or `refused` with what a 422 says, or else says why it failed. */
  const send = <T,>(doing: NonNullable<Busy>, request: () => Promise<T>, done: (answer: T) => void, refused: (refusal: Refusal) => void) => {
    setBusy(doing);
    setRefusal(null);
    setUnread(null);
    request().then(
      (answer) => {
        if (!mounted.current) return;
        setBusy(null);
        done(answer);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setBusy(null);
        const why = refusalOf(error);
        if (why) refused(why);
        else failed(error);
      },
    );
  };

  const changes = app ? changesOf(app, fields) : {};
  const rereads = changes.url !== undefined || changes.token !== undefined;
  const save = () =>
    send(
      "saving",
      () => changeApp(appId, changes),
      (saved) => {
        show(saved);
        flash("notice", rereads ? `Changes saved. Ember read ${toolsOf(saved.tools.length)} from ${saved.name}.` : CHANGES_SAVED);
      },
      setRefusal,
    );
  const readAgain = () =>
    send(
      "reading",
      () => readAppTools(appId),
      // What's typed stays as it is, and a field left as the app had it follows what another administrator has saved since, so that the next save doesn't put the old back. Sending no token is switched back off once the app keeps none, as the switch isn't shown then.
      (read) => {
        if (app) setFields((typed) => ({ ...typed, ...(typed.name.trim() === app.name && { name: read.name }), ...(typed.url.trim() === app.url && { url: read.url }), ...(!read.hasToken && { noToken: false }) }));
        setApp(read);
      },
      ({ error }) => setUnread(error),
    );
  const remove = () => {
    if (!confirm(CONFIRM_REMOVE_APP)) return;
    send("removing", () => disconnectApp(appId), () => navigate(AGENTS_PATH), ({ error }) => setUnread(error));
  };

  return (
    <SettingsPage back={AGENTS_PATH}>
      <Panel aria-busy={app === null}>
        {app && (
          <>
            <AppForm
              saved={app}
              fields={fields}
              onChange={(fields) => {
                setFields(fields);
                setRefusal(null);
              }}
              refusal={refusal}
              busy={busy !== null}
              reading={busy === "saving" && rereads}
              canSave={Object.keys(changes).length > 0}
              onSave={save}
            />
            <hr className="my-8 w-full" />
            <Tools app={app} busy={busy} unread={unread} onReadAgain={readAgain} />
            <hr className="my-8 w-full" />
            <DeleteButton label={`Remove ${app.name}`} text="Remove app" disabled={busy !== null} onClick={remove} />
          </>
        )}
      </Panel>
    </SettingsPage>
  );
}

interface FormProps {
  /** The app as it's connected, or null for one not yet. */
  saved: App | null;
  fields: Fields;
  onChange: (fields: Fields) => void;
  refusal: Refusal | null;
  /** Whether the form or one of the page's buttons is on its way to the server, which the form's button waits for, its fields kept as they were sent: what it answers would replace anything typed since. */
  busy: boolean;
  /** Whether Ember is asking the app's server for its tools as the form is sent. */
  reading: boolean;
  /** Whether there's anything to send. */
  canSave: boolean;
  onSave: () => void;
}

/**
 * The app form: the app's name, its server's address and the token Ember sends it, each with what it's
 * for under it, or why it was refused, and Connect, or Save changes, which says so while Ember reads the
 * server's tools.
 */
function AppForm({ saved, fields, onChange, refusal, busy, reading, canSave, onSave }: FormProps) {
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && canSave) onSave();
  };
  const refused = (field: AppField) => (refusal?.field === field ? true : undefined);
  const describedBy = (id: string, field: AppField) => (refusal?.field === field ? `${id}-refusal` : `${id}-description`);
  const keepsToken = saved?.hasToken === true;

  return (
    <form onSubmit={save} className={AUTH_FORM}>
      <PageHeading title={saved ? "Edit app" : "Connect an app"}>
        An app is another service's MCP server. Ember reads the tools it offers when you connect it, and again whenever you ask.
      </PageHeading>
      <Field id="app_name" label="Name">
        <Input
          id="app_name"
          readOnly={busy}
          placeholder="Name the app"
          maxLength={MAX_APP_NAME_LENGTH}
          autoComplete="off"
          autoFocus={saved === null}
          required
          data-1p-ignore
          aria-invalid={refused("name")}
          aria-describedby={refusal?.field === "name" ? "app_name-refusal" : undefined}
          value={fields.name}
          onChange={(event) => onChange({ ...fields, name: event.target.value })}
          className={FIELD_INPUT}
        />
        <Under id="app_name" field="name" refusal={refusal} />
      </Field>
      <Field id="app_url" label="Server address">
        <Input
          id="app_url"
          readOnly={busy}
          type="url"
          inputMode="url"
          placeholder="https://example.com/mcp"
          maxLength={MAX_APP_URL_LENGTH}
          autoComplete="off"
          required
          aria-invalid={refused("url")}
          aria-describedby={describedBy("app_url", "url")}
          value={fields.url}
          onChange={(event) => onChange({ ...fields, url: event.target.value })}
          className={FIELD_INPUT}
        />
        <Under id="app_url" field="url" refusal={refusal}>
          {URL_EXPLAINED}
        </Under>
      </Field>
      <Field id="app_token" label="Token">
        <Input
          id="app_token"
          readOnly={busy}
          type="password"
          placeholder={keepsToken ? "Unchanged" : "None"}
          maxLength={MAX_APP_TOKEN_LENGTH}
          autoComplete="off"
          data-1p-ignore
          disabled={fields.noToken}
          aria-invalid={refused("token")}
          aria-describedby={describedBy("app_token", "token")}
          value={fields.token}
          onChange={(event) => onChange({ ...fields, token: event.target.value })}
          className={FIELD_INPUT}
        />
        <Under id="app_token" field="token" refusal={refusal}>
          {keepsToken ? TOKEN_KEPT : TOKEN_EXPLAINED}
        </Under>
        {keepsToken && (
          <label className="flex min-h-9 cursor-pointer items-center gap-[1ch] text-[0.9em]">
            <input
              type="checkbox"
              checked={fields.noToken}
              disabled={busy}
              onChange={(event) => onChange({ ...fields, token: "", noToken: event.target.checked })}
              className="size-4 flex-none accent-foreground"
            />
            <span>Send no token</span>
          </label>
        )}
      </Field>
      <SubmitButton disabled={busy || !canSave}>{saved ? "Save changes" : "Connect"}</SubmitButton>
      <p role="status" className={cn(NOTE, "-mt-1 text-center wrap-anywhere empty:hidden", !reading && "text-negative")}>
        {reading ? READING_TOOLS : refusal?.field === null ? refusal.error : null}
      </p>
    </form>
  );
}

/** Under a field: why it's refused, if it is, or else what's said of it, if anything is. */
function Under({ id, field, refusal, children }: { id: string; field: AppField; refusal: Refusal | null; children?: ReactNode }) {
  if (refusal?.field === field) {
    return (
      <p id={`${id}-refusal`} role="alert" className={cn(NOTE, "wrap-anywhere text-negative")}>
        {refusal.error}
      </p>
    );
  }
  if (children === undefined) return null;
  return (
    <p id={`${id}-description`} className={NOTE}>
      {children}
    </p>
  );
}

/** What the Tools card says of how many of an app's tools Ember keeps, when it has more. */
export const toolsLeftOut = (count: number) => `It has ${count} more that Ember leaves out: it keeps ${MAX_APP_TOOLS} at most, and none whose name or inputs it can't give a model.`;

/**
 * The Tools card: what the app's server calls itself, when Ember last read its tools and who connected
 * it, Read its tools again, with why that failed, if it did, and each tool by its name there, with what
 * it's called, if that's something else, and what its server says it does, which is the server's word.
 */
function Tools({ app, busy, unread, onReadAgain }: { app: App; busy: Busy; unread: string | null; onReadAgain: () => void }) {
  const read = `Read ${dateTimeLabel(new Date(app.toolsReadAt))}`;
  const facts = [...(app.serverName ? [`Its server calls itself ${app.serverName}`] : []), read, ...(app.connectedBy ? [`Connected by ${app.connectedBy.name}`] : [])];
  return (
    <section aria-labelledby="app-tools-heading" aria-busy={busy === "reading"} className={CARD}>
      <div className="flex flex-wrap items-center gap-x-[1ch] gap-y-3">
        <div className="min-w-[14em] flex-1">
          <h2 id="app-tools-heading" className="text-base font-semibold">
            {app.tools.length === 0 ? "Tools" : `Tools (${app.tools.length})`}
          </h2>
          <p className={cn(NOTE, "wrap-anywhere")}>{facts.join(" · ")}</p>
        </div>
        <button type="button" disabled={busy !== null} onClick={onReadAgain} className={cn(BUTTON, "gap-[0.5em]")}>
          <RefreshDouble className="size-[18px]" />
          <span>Read its tools again</span>
        </button>
      </div>
      <p role="status" className={cn(NOTE, "wrap-anywhere empty:hidden", busy !== "reading" && "text-negative")}>
        {busy === "reading" ? READING_TOOLS : unread}
      </p>
      <p className={NOTE}>Each description is the app's own. Pick the tools an agent may use on the agent's page.</p>
      {app.tools.length > 0 && (
        <ul aria-labelledby="app-tools-heading" className="flex max-h-[28em] flex-col overflow-y-auto overscroll-contain rounded-[10px] border bg-background">
          {app.tools.map(({ name, title, description }) => (
            <li key={name} className="border-t px-[1.5ch] py-2.5 first:border-t-0">
              <div className="flex flex-wrap items-baseline gap-x-[1ch]">
                <code className="font-mono text-[0.9em] font-semibold wrap-anywhere">{name}</code>
                {title !== null && title !== name && <span className={NOTE}>{title}</span>}
              </div>
              {description !== "" && <p className="text-[0.9em] wrap-anywhere whitespace-pre-line text-message-ink max-md:text-[13px]">{description}</p>}
            </li>
          ))}
        </ul>
      )}
      {app.toolsLeftOut > 0 && <p className={NOTE}>{toolsLeftOut(app.toolsLeftOut)}</p>}
    </section>
  );
}
