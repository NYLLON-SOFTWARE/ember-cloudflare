import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { MAX_BIO_LENGTH, MAX_PASSWORD_LENGTH, type Me, type Profile } from "@ember/protocol";
import { AUTH_FORM } from "@/components/auth-page";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { useFlash } from "@/components/flash";
import { Logout } from "@/components/icons/campfire";
import { Input } from "@/components/ui/input";
import { useMounted } from "@/hooks/use-mounted";
import { leave, useBackPath } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { changeProfile, fetchProfile, isSignedOut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { HEADER_TEXT_BUTTON } from "./page-header";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

interface Props {
  me: Me;
  /** Signs out, settling with whether it did. */
  onSignOut: () => Promise<boolean>;
  /** Says why loading or saving failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** The form's fields as typed. */
type Fields = Record<"name" | "emailAddress" | "password" | "bio", string>;

/** A profile in the form, with no new password typed. */
const fieldsOf = ({ name, emailAddress, bio }: Profile): Fields => ({ name, emailAddress: emailAddress ?? "", password: "", bio: bio ?? "" });

/**
 * ember-rust's profile (users/profiles/show.html), as far as it's built: your name, email address, a
 * new password and your bio, which Save changes saves with the notice "✓", keeping the page where
 * ember-rust reloads it, and Log out in the top bar. Go Back returns to the page it was opened from.
 * Your name and bio reach everyone's open pages at once, through the workspace socket, as your new
 * name reaches the rail. There's no photo picker until photos are stored, and no conversation
 * notifications, sign-in link or install instructions until those are built.
 */
export function ProfilePage({ me, onSignOut, onFailed }: Props) {
  const [fields, setFields] = useState<Fields | null>(null);
  const [saving, setSaving] = useState(false);
  const back = useBackPath();
  const flash = useFlash();
  const mounted = useMounted();
  useTitle(me.name);

  useEffect(() => {
    let stopped = false;
    fetchProfile().then(
      (profile) => !stopped && setFields(fieldsOf(profile)),
      (error: unknown) => {
        // A page left before its profile loads only reports a session that's ended, which goes to sign in.
        if (!stopped || isSignedOut(error)) onFailed(error);
      },
    );
    return () => void (stopped = true);
  }, [onFailed]);

  const change = (field: keyof Fields) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((fields) => fields && { ...fields, [field]: event.target.value });

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!fields || saving) return;
    setSaving(true);
    const sent = fields;
    changeProfile(sent).then(
      () => {
        if (!mounted.current) return;
        setSaving(false);
        // Saved, the new password leaves the field, as ember-rust's page comes back without it.
        setFields((fields) => fields && { ...fields, password: fields.password === sent.password ? "" : fields.password });
        flash("notice", "✓");
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onFailed(error);
      },
    );
  };

  const logOut = (
    <button type="button" onClick={() => leave(onSignOut)} className={HEADER_TEXT_BUTTON}>
      <Logout width={20} height={20} className="h-5 w-[1.3em]" />
      <span>Log out</span>
    </button>
  );

  return (
    <SettingsPage back={back} links={logOut}>
      <Panel aria-busy={fields === null} className="flex flex-col gap-x-[1ch] gap-y-4">
        <PageHeading title="Your profile">Manage how you appear to the people in your workspace.</PageHeading>
        <form onSubmit={save} className={AUTH_FORM}>
          {/* Nothing is focused as the page opens, as in ember-rust. */}
          <Field id="user_name" label="Name" translation="user_name">
            <Input
              id="user_name"
              autoComplete="name"
              placeholder="Enter your name"
              required
              data-1p-ignore
              disabled={!fields}
              value={fields?.name ?? ""}
              onChange={change("name")}
              className={FIELD_INPUT}
            />
          </Field>
          <Field id="user_email_address" label="Email address" translation="email_address">
            <Input
              id="user_email_address"
              type="email"
              autoComplete="username"
              placeholder="Enter your email address"
              disabled={!fields}
              value={fields?.emailAddress ?? ""}
              onChange={change("emailAddress")}
              className={FIELD_INPUT}
            />
          </Field>
          <Field id="user_password" label="New password" translation="update_password">
            <Input
              id="user_password"
              type="password"
              autoComplete="new-password"
              placeholder="Change password"
              maxLength={MAX_PASSWORD_LENGTH}
              aria-describedby="profile-password-help"
              disabled={!fields}
              value={fields?.password ?? ""}
              onChange={change("password")}
              className={FIELD_INPUT}
            />
            <p id="profile-password-help" className="text-[0.8em] text-muted-foreground">
              Leave blank to keep your current password.
            </p>
          </Field>
          <Field id="user_bio" label="Bio" translation="bio">
            {/* Campfire's `.input` as a textarea: three rows, which zz-ember.css lets you make taller. */}
            <textarea
              id="user_bio"
              rows={3}
              placeholder="A few words about yourself…"
              maxLength={MAX_BIO_LENGTH}
              disabled={!fields}
              value={fields?.bio ?? ""}
              onChange={change("bio")}
              className={cn("w-full border placeholder:text-muted-foreground disabled:opacity-50", FIELD_INPUT, "resize-y")}
            />
          </Field>
          <SubmitButton disabled={!fields || saving}>Save changes</SubmitButton>
        </form>
      </Panel>
    </SettingsPage>
  );
}
