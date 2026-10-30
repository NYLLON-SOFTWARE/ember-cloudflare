import { useEffect, useRef, useState, type ComponentType, type ReactNode, type Ref } from "react";
import {
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_USER_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT,
  type NewWorkspace,
  type SetupAccess,
  type SetupPlaceholders,
} from "@ember/protocol";
import avatarPlaceholder from "@/components/avatar-placeholder.svg";
import { ArrowRight, Camera, Eye, Lock, Mail, User as UserIcon, type IconoirIconProps } from "@/components/icons/iconoir";
import { MainContent, SkipLink } from "@/components/main-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChosenPhoto, type PhotoChoice } from "@/hooks/use-chosen-photo";
import { navigate } from "@/hooks/use-route";
import { ApiError, setUpWorkspace } from "@/lib/api";
import { cn } from "@/lib/utils";
import { loadPage } from "@/lib/page";

// The Set up Ember page. Entering its fields doesn't select what's in them, since it isn't one of the
// app's pages, which do (`useSelectOnEntry`). Its name and email address placeholders come from
// /api/bootstrap: Kevin Rose's, unless the deployment suggests its own.
//
// A deployed Worker takes the setup link its deploy printed, `/first_run#token=<its setup token>`: the
// token rides in the fragment, which no request or log sees, and goes with the form as a bearer token.
// Opened without it, or where the Worker has no token to match (`setupAccess` from /api/bootstrap), the
// page says what to do in the form's place, on a "Setup is locked" card, rather than showing a form that
// would be refused.

const TITLE = "Set up Ember";
/** The token in a setup link's fragment. */
const setupTokenOf = (hash: string) => new URLSearchParams(hash.slice(1)).get("token") || null;
/** Makes a new setup token where the person sees it; `wrangler secret put` then asks for it, where a pipe would hide it. */
const NEW_TOKEN = "openssl rand -hex 32";
/** Gives the Worker the token made; the link then carries it. */
const PUT_TOKEN = "wrangler secret put EMBER_SETUP_TOKEN";
/** basecoat's `.ui-field .input`, over the stock input, and 44px tall for fingers as the app's fields are. */
const INPUT = "h-10 touch:h-11 rounded-[0.7rem] bg-card pr-3 pl-9 text-base shadow-none md:text-base dark:bg-card focus-visible:border-input focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring";
const FIELD_ICON = "pointer-events-none absolute top-1/2 left-3 z-[1] size-[1.125rem] -translate-y-1/2 text-muted-foreground";
/** basecoat's `.ui-skip-link` (theme.css): with no header to show it under, it shows at the top left, clear of a notch. */
const SKIP_LINK = "focus:top-[calc(0.5rem+env(safe-area-inset-top))] focus:left-[max(0.5rem,env(safe-area-inset-left))] focus:rounded-lg focus:border-0 focus:bg-card focus:px-4 focus:py-3 focus:outline-2 focus:outline-offset-0 focus:outline-ring";

/**
 * Creates the workspace and its first administrator, with the photo they choose, then opens general,
 * its first room, through the setup link where the deployment takes one (`access`).
 */
export function SetupPage(props: { placeholders: SetupPlaceholders; access: SetupAccess; onSetUp: (workspace: NewWorkspace) => void }) {
  // Pasting the setup link over this page's address only changes the fragment, which loads no new
  // page, so each link opened starts afresh here, as the sign-in link page's does.
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    const open = () => setOpened((count) => count + 1);
    addEventListener("hashchange", open);
    return () => removeEventListener("hashchange", open);
  }, []);
  return <Setup key={opened} {...props} />;
}

function Setup({ placeholders, access, onSetUp }: { placeholders: SetupPlaceholders; access: SetupAccess; onSetUp: (workspace: NewWorkspace) => void }) {
  const [setupToken] = useState(() => setupTokenOf(location.hash));

  useEffect(() => {
    const title = document.title;
    document.title = TITLE;
    return () => void (document.title = title);
  }, []);
  // The token leaves the address bar and this tab's history as the page opens.
  useEffect(() => {
    if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
  }, []);

  if (access === "closed") return <SetupClosed />;
  if (access === "link" && setupToken === null) return <SetupLinkNeeded />;
  return <SetupForm placeholders={placeholders} setupToken={setupToken} onSetUp={onSetUp} />;
}

function SetupForm({ placeholders, setupToken, onSetUp }: { placeholders: SetupPlaceholders; setupToken: string | null; onSetUp: (workspace: NewWorkspace) => void }) {
  const [name, setName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [passwordTooShort, setPasswordTooShort] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const photo = useChosenPhoto();

  async function submit() {
    setBusy(true);
    setPasswordTooShort(false);
    setProblem(null);
    try {
      const workspace = await setUpWorkspace({ name, emailAddress, password: passwordInput.current?.value ?? "" }, await photo.photo(), setupToken);
      navigate(`/rooms/${workspace.room.id}`, { replace: true });
      onSetUp(workspace);
    } catch (error) {
      setBusy(false);
      if (!(error instanceof ApiError)) return setProblem("Couldn't reach Ember. Check your connection and try again.");
      // The name, email address and photo stay, and the password starts over.
      if (error.field === "password") {
        if (passwordInput.current) passwordInput.current.value = "";
        setPasswordTooShort(true);
        return passwordInput.current?.focus();
      }
      // A photo that's refused goes, so the form can be sent without it.
      if (error.field === "avatar") return photo.refuse(error.message);
      // Someone else set it up first.
      if (error.status === 409) return loadPage("/");
      // A setup link that isn't this deployment's is refused (403) with what to do, said here.
      setProblem(error.message);
    }
  }

  return (
    <SetupCard problem={problem} subtitle="Create the admin account for your workspace.">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-7 px-5 pt-6 pb-7">
          <AvatarField photo={photo} disabled={busy} />
          <div className="grid gap-6">
            <Field id="user_name" label="Name" icon={UserIcon}>
              <Input
                id="user_name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={placeholders.name}
                maxLength={MAX_USER_NAME_LENGTH}
                autoComplete="name"
                autoFocus
                required
                data-1p-ignore
                className={INPUT}
              />
            </Field>
            <Field id="user_email_address" label="Email address" icon={Mail}>
              <Input
                id="user_email_address"
                type="email"
                value={emailAddress}
                onChange={(event) => setEmailAddress(event.target.value)}
                placeholder={placeholders.emailAddress}
                maxLength={MAX_EMAIL_ADDRESS_LENGTH}
                autoComplete="username"
                required
                className={INPUT}
              />
            </Field>
            <PasswordField ref={passwordInput} tooShort={passwordTooShort} />
          </div>
        </div>
        <footer className="border-t bg-surface p-5">
          <Button type="submit" disabled={busy} className="h-10 w-full gap-2 rounded-[0.7rem] text-base font-medium touch:h-11">
            Continue <ArrowRight className="size-[1.125rem]" />
          </Button>
        </footer>
      </form>
    </SetupCard>
  );
}

/** The page without its form: what deploying Ember printed is the way in. */
function SetupLinkNeeded() {
  return (
    <SetupCard subtitle="Ember is waiting for its administrator.">
      <Notice>
        <p>
          Open the setup link that deploying Ember printed. It looks like <Code>{`${location.origin}/first_run#token=…`}</Code> and carries this deployment's
          setup token, so only whoever deployed it can set it up.
        </p>
        <p>
          The link is in the output of <Code>pnpm run deploy</Code>, or in the build's log in the Cloudflare dashboard after Deploy to Cloudflare. If it's lost, make a
          new token with <Code>{NEW_TOKEN}</Code>, give it to the Worker with <Code>{PUT_TOKEN}</Code>, which asks for it, and open the link with that token.
        </p>
      </Notice>
    </SetupCard>
  );
}

/** The page without its form: the Worker has no setup token, so there's no link to open yet. */
function SetupClosed() {
  return (
    <SetupCard subtitle="Nobody can set it up yet.">
      <Notice>
        <p>This deployment has no setup token, so there's no setup link to open.</p>
        <p>
          Deploy it with <Code>pnpm run deploy</Code>, which makes a token and prints the link, or make one with <Code>{NEW_TOKEN}</Code>, give it to the Worker with{" "}
          <Code>{PUT_TOKEN}</Code>, which asks for it, and open <Code>{`${location.origin}/first_run#token=<the token>`}</Code>.
        </p>
      </Notice>
    </SetupCard>
  );
}

/** The first-run card, with the page's skip link and the alert above it, around the form or what stands in for it. */
function SetupCard({ subtitle, problem = null, children }: { subtitle: string; problem?: string | null; children: ReactNode }) {
  return (
    <>
      <SkipLink className={SKIP_LINK} />
      <MainContent
        data-ember-preserve-selection
        className="grid min-h-svh grid-cols-[minmax(0,28rem)] place-content-center justify-items-center gap-4 bg-surface pt-[calc(2.5rem+env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] upto-380px:pt-[calc(1.25rem+env(safe-area-inset-top))] upto-380px:pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        {problem && (
          <div role="alert" aria-atomic="true" className="w-full rounded-lg border bg-card px-4 py-3.5">
            {problem}
          </div>
        )}
        <section aria-label={TITLE} className="w-full min-w-0 overflow-hidden rounded-2xl border bg-card text-card-foreground">
          <header className="flex flex-col items-center px-5 pt-5 text-center">
            <img src="/ember-icon.png" alt="Ember" width={48} height={48} className="mb-4 block size-12 object-contain" />
            <h1 className="text-2xl leading-[1.3] font-[550] tracking-[-0.025em] upto-380px:text-[1.375rem]">{TITLE}</h1>
            <p className="mt-2 text-base leading-normal text-muted-foreground upto-380px:text-sm">{subtitle}</p>
          </header>
          {children}
        </section>
      </MainContent>
    </>
  );
}

/** What to do, in the form's place, as the card's body. */
function Notice({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 px-5 pt-6 pb-7 text-base leading-normal upto-380px:text-sm [overflow-wrap:anywhere]">{children}</div>;
}

/** A command or an address to copy, in the card's text. */
function Code({ children }: { children: string }) {
  return <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">{children}</code>;
}

/**
 * The photo to start with, which shows as it's chosen, in a 96px circle with a camera on its corner, and
 * says why one is refused in place of its description. It can't change while the form is sent with it.
 */
function AvatarField({ photo, disabled }: { photo: PhotoChoice; disabled: boolean }) {
  return (
    <div className="grid min-w-0 justify-items-center gap-3.5">
      <label
        htmlFor="user_avatar"
        className="group relative block size-24 cursor-pointer rounded-full has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-4 has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-ring"
      >
        <span className="sr-only">Upload profile image (optional)</span>
        <img src={photo.preview ?? avatarPlaceholder} alt="Avatar preview" width={96} height={96} className="size-full rounded-full border bg-muted object-cover" />
        <span className="absolute -right-[0.2rem] -bottom-[0.2rem] grid size-[2.375rem] place-items-center rounded-full border bg-card text-foreground shadow-[0_1px_3px_#0002] group-hover:bg-muted">
          <Camera className="size-[1.125rem]" />
        </span>
        <input
          ref={photo.input}
          id="user_avatar"
          type="file"
          accept="image/*"
          aria-invalid={photo.refusal ? true : undefined}
          aria-describedby="avatar-description"
          disabled={disabled}
          onChange={photo.choose}
          className="absolute inset-0 size-full cursor-pointer rounded-[inherit] opacity-0 disabled:cursor-default"
        />
      </label>
      {photo.refusal ? (
        <p id="avatar-description" role="alert" className="text-sm leading-normal text-destructive">
          {photo.refusal}
        </p>
      ) : (
        <p id="avatar-description" className="text-sm leading-normal text-muted-foreground">
          Add a profile photo (optional).
        </p>
      )}
    </div>
  );
}

function Field({ id, label, icon: Icon, children }: { id: string; label: string; icon: ComponentType<IconoirIconProps>; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor={id} className="text-base leading-normal font-medium">
        {label}
      </label>
      <div className="relative min-w-0">
        <Icon className={FIELD_ICON} />
        {children}
      </div>
    </div>
  );
}

/** The password field, with its show and hide toggle. */
function PasswordField({ ref, tooShort }: { ref: Ref<HTMLInputElement>; tooShort: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor="user_password" className="text-base leading-normal font-medium">
        Password
      </label>
      <div className="relative min-w-0">
        <Lock className={FIELD_ICON} />
        {/* Uncontrolled, so what's typed never reaches its `value` attribute, where custom CSS could read it. */}
        <Input
          ref={ref}
          id="user_password"
          type={visible ? "text" : "password"}
          placeholder="••••••••"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          aria-invalid={tooShort || undefined}
          aria-describedby="password-description"
          className={cn(INPUT, "pr-11 touch:pr-12")}
        />
        <button
          type="button"
          aria-controls="user_password"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
          className="absolute top-1/2 right-[0.2rem] grid size-9 -translate-y-1/2 touch:size-11 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-pressed:text-foreground"
        >
          <Eye className="size-[1.125rem]" />
        </button>
      </div>
      {tooShort ? (
        <p id="password-description" role="alert" className="text-sm leading-normal text-destructive">
          {PASSWORD_TOO_SHORT}
        </p>
      ) : (
        <p id="password-description" className="text-sm leading-normal text-muted-foreground">
          Must be at least 8 characters.
        </p>
      )}
    </div>
  );
}
