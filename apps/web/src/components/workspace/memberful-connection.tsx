import { useRef, useState, type FormEvent } from "react";
import { MAX_PASSWORD_LENGTH } from "@ember/protocol";
import { AUTH_FORM } from "@/components/auth-page";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { Input } from "@/components/ui/input";
import { useMounted } from "@/hooks/use-mounted";
import { connectMemberful, isSignedOut } from "@/lib/api";
import { openPage } from "@/lib/page";

// This port's own Memberful section of your profile (`auth.memberful-connect`): while Memberful is
// members only, someone with an account from before connects their Memberful account to it, with their
// password, as changing their email address takes it, and signs in with Memberful from then on. Boxed
// as workspace settings' Memberful section is.

interface Props {
  /** Whether you've connected a Memberful account. */
  connected: boolean;
  /** Whether you have a password, which connecting one asks for then. */
  hasPassword: boolean;
  /** Whether you need Memberful to sign in, as everyone does but administrators and the people they invite, who sign in with a password too. */
  membershipNeeded: boolean;
  /** Says why connecting didn't start, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * That you've connected a Memberful account, or Connect Memberful, which sends the browser to sign in at
 * the Memberful site once your password checks out, and Memberful sends it back here.
 */
export function MemberfulConnection({ connected, hasPassword, membershipNeeded, onFailed }: Props) {
  const [connecting, setConnecting] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const mounted = useMounted();

  const connect = (event: FormEvent) => {
    event.preventDefault();
    if (connecting) return;
    setConnecting(true);
    connectMemberful(hasPassword ? (passwordInput.current?.value ?? "") : undefined).then(
      ({ memberfulConnection }) => openPage(memberfulConnection),
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setConnecting(false);
        if (passwordInput.current) passwordInput.current.value = "";
        onFailed(error);
      },
    );
  };

  return (
    <section aria-labelledby="memberful-connection-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 max-md:px-3">
      <h2 id="memberful-connection-heading" className="text-base font-semibold">
        Memberful
      </h2>
      {connected ? (
        <p>{membershipNeeded ? "Your Memberful account is connected, so you sign in with it." : "Your Memberful account is connected, so you can sign in with it too."}</p>
      ) : (
        <form onSubmit={connect} aria-describedby="memberful-connection-help" className={AUTH_FORM}>
          <p id="memberful-connection-help">
            Members sign in with Memberful.{" "}
            {membershipNeeded ? "Connect your Memberful account to keep signing in as yourself." : "Connect your Memberful account to sign in with it too."}
          </p>
          {hasPassword && (
            <Field id="memberful_password" label="Password" translation="password">
              {/* Uncontrolled, as the profile's password fields are. */}
              <Input
                ref={passwordInput}
                id="memberful_password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                maxLength={MAX_PASSWORD_LENGTH}
                className={FIELD_INPUT}
              />
            </Field>
          )}
          <SubmitButton disabled={connecting}>Connect Memberful</SubmitButton>
        </form>
      )}
    </section>
  );
}
