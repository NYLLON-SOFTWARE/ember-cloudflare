import { useState } from "react";
import { ArrowRight, User } from "@/components/icons/ember";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, type Session } from "@/lib/api";

/** ember-rust's restrained auth card. Accounts come later; for now a name is enough. */
export function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="flex min-h-dvh items-start justify-center bg-surface pt-[env(safe-area-inset-top)] pr-[max(16px,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[max(16px,env(safe-area-inset-left))]">
      <div className="mt-[clamp(24px,7vh,80px)] mb-6 w-[440px] max-w-full rounded-2xl border bg-background p-8 max-md:mt-[18px] max-md:px-5 max-md:py-6">
        <div className="mb-7 text-center">
          <img src="/ember-icon.png" alt="" width={48} height={48} className="mx-auto mb-5 size-12 object-contain" />
          <h1 className="mb-2 text-2xl leading-tight font-[650]">Welcome to Ember</h1>
          <p className="text-muted-foreground">Pick the name people will see next to your messages.</p>
        </div>
        <form
          className="flex flex-col gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              onSignedIn(await signIn(name));
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't sign in");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="name" className="text-[13px] font-[550]">
              Your name
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted-foreground" />
              <Input
                id="name"
                autoFocus
                required
                maxLength={48}
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "name-error" : undefined}
                className="h-[42px] rounded-[9px] bg-background pl-9 text-sm shadow-none touch:h-11 touch:text-base"
              />
            </div>
            {error && (
              <p id="name-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <Button type="submit" disabled={busy || !name.trim()} className="h-[42px] w-full rounded-[9px] font-[550] touch:h-11">
            Join <ArrowRight className="size-[18px]" />
          </Button>
        </form>
      </div>
    </main>
  );
}
