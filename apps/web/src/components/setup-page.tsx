import { useEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT, type NewWorkspace, type SetupPlaceholders } from "@ember/protocol";
import avatarPlaceholder from "@/components/avatar-placeholder.svg";
import { ArrowRight, Camera, Eye, Lock, Mail, User as UserIcon, type EmberIconProps } from "@/components/icons/ember";
import { MainContent, SkipLink } from "@/components/main-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChosenPhoto, type PhotoChoice } from "@/hooks/use-chosen-photo";
import { navigate } from "@/hooks/use-route";
import { ApiError, setUpWorkspace } from "@/lib/api";
import { cn } from "@/lib/utils";
import { loadPage } from "@/lib/page";

// ember-rust's Set up Ember page (crates/views/templates/first_runs/show.html and the macros in
// components/ui.html), styled as its basecoat card (crates/assets/overrides/basecoat/src/theme.css).
// Entering its fields doesn't select what's in them, since it isn't one of ember-rust's app pages, which
// do (`useSelectOnEntry`). Its name and email address placeholders are ember-rust's unless the
// deployment suggests its own, which /api/bootstrap passes on.

const TITLE = "Set up Ember";
/** basecoat's `.ui-field .input`, over the stock input, and 44px tall for fingers as the app's fields are. */
const INPUT = "h-10 touch:h-11 rounded-[0.7rem] bg-card pr-3 pl-9 text-base shadow-none md:text-base dark:bg-card focus-visible:border-input focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring";
const FIELD_ICON = "pointer-events-none absolute top-1/2 left-3 z-[1] size-[1.125rem] -translate-y-1/2 text-muted-foreground";
/** basecoat's `.ui-skip-link` (theme.css): with no header to show it under, it shows at the top left, clear of a notch. */
const SKIP_LINK = "focus:top-[calc(0.5rem+env(safe-area-inset-top))] focus:left-[max(0.5rem,env(safe-area-inset-left))] focus:rounded-lg focus:border-0 focus:bg-card focus:px-4 focus:py-3 focus:outline-2 focus:outline-offset-0 focus:outline-ring";

/** Creates the workspace and its first administrator, with the photo they choose, then opens general, its first room. */
export function SetupPage({ placeholders, onSetUp }: { placeholders: SetupPlaceholders; onSetUp: (workspace: NewWorkspace) => void }) {
  const [name, setName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [passwordTooShort, setPasswordTooShort] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const photo = useChosenPhoto();

  useEffect(() => {
    const title = document.title;
    document.title = TITLE;
    return () => void (document.title = title);
  }, []);

  async function submit() {
    setBusy(true);
    setPasswordTooShort(false);
    setProblem(null);
    try {
      const workspace = await setUpWorkspace({ name, emailAddress, password }, await photo.photo());
      navigate(`/rooms/${workspace.room.id}`, { replace: true });
      onSetUp(workspace);
    } catch (error) {
      setBusy(false);
      if (!(error instanceof ApiError)) return setProblem("Couldn't reach Ember. Check your connection and try again.");
      // As ember-rust re-renders the form: the name and email stay, and the password starts over. The
      // photo stays too, where ember-rust's form comes back without it.
      if (error.field === "password") {
        setPassword("");
        setPasswordTooShort(true);
        return passwordInput.current?.focus();
      }
      // A photo that's refused goes, so the form can be sent without it.
      if (error.field === "avatar") return photo.refuse(error.message);
      // Someone else set it up first, or the setup link's 15 minutes ran out: the Worker's pages say which.
      if (error.status === 409) return loadPage("/");
      if (error.status === 403) return loadPage("/first_run");
      setProblem(error.message);
    }
  }

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
            <p className="mt-2 text-base leading-normal text-muted-foreground upto-380px:text-sm">Create the admin account for your workspace.</p>
          </header>
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
                    autoComplete="username"
                    required
                    className={INPUT}
                  />
                </Field>
                <PasswordField ref={passwordInput} value={password} onChange={(event) => setPassword(event.target.value)} tooShort={passwordTooShort} />
              </div>
            </div>
            <footer className="border-t bg-surface p-5">
              <Button type="submit" disabled={busy} className="h-10 w-full gap-2 rounded-[0.7rem] text-base font-medium touch:h-11">
                Continue <ArrowRight className="size-[1.125rem]" />
              </Button>
            </footer>
          </form>
        </section>
      </MainContent>
    </>
  );
}

/**
 * ember-rust's `ui::avatar`: the photo to start with, which shows as it's chosen, in a 96px circle with
 * a camera on its corner, and says why one is refused in place of its description. It can't change while
 * the form is sent with it.
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

function Field({ id, label, icon: Icon, children }: { id: string; label: string; icon: ComponentType<EmberIconProps>; children: ReactNode }) {
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

/** ember-rust's `ui::password`, with its show and hide toggle (basecoat/src/password.js). */
function PasswordField({ tooShort, ...props }: ComponentProps<"input"> & { tooShort: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor="user_password" className="text-base leading-normal font-medium">
        Password
      </label>
      <div className="relative min-w-0">
        <Lock className={FIELD_ICON} />
        <Input
          {...props}
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
