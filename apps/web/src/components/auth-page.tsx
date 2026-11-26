import type { ComponentProps, ReactNode } from "react";
import type { Bootstrap } from "@ember/protocol";
import { AccountLogo } from "@/components/account-logo";
import { MainContent, SkipLink } from "@/components/main-content";
import { Version } from "@/components/version";
import { cn } from "@/lib/utils";

// What the sign-in and join pages share: a card on the surface, holding a heading and a form, with
// Ember's version under it.

/** What the app knows about the workspace before anyone signs in. */
export type SignedOutWorkspace = Omit<Bootstrap, "user">;

/** How a sign-in card lays out its form. */
export const AUTH_FORM = "flex flex-col gap-5";

/** The campaign lockup and office line, above a public card. The wide mark already carries the rise, the stripes, and the extrude. */
export function BrandMark() {
  return (
    <>
      <div className="brand-rise" aria-hidden="true" />
      <img src="/logos/victor-lopez-logo-wide.png" alt="Victor Lopez for Hammond City Council" width={880} height={330} className="brand-lockup" />
      <p className="brand-office">4th District · Hammond City Council</p>
    </>
  );
}

/** The committee line under a public card. */
export function BrandDisclaimer() {
  return <p className="brand-disclaimer">Paid for by CTE Victor Lopez</p>;
}

/** The page around a sign-in card: the lockup, then what `children` holds, the version, and the disclaimer. */
export function AuthPage({ workspace, children }: { workspace: SignedOutWorkspace; children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <MainContent className="brand-public min-h-dvh bg-surface pt-header pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] max-md:pt-[calc(56px+env(safe-area-inset-top))]">
        <BrandMark />
        {children}
        <Version version={workspace.version} className="my-8 text-center" />
        <BrandDisclaimer />
      </MainContent>
    </>
  );
}

/** Something that went wrong apart from the form, such as the connection, said above the card. */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <div role="alert" aria-atomic="true" className="mx-auto mt-6 w-[440px] max-w-[calc(100%-32px)] rounded-lg border bg-card px-4 py-3.5 max-md:max-w-[calc(100%-24px)]">
      {children}
    </div>
  );
}

/** The card a sign-in page holds. */
export function AuthCard({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "mx-auto mt-[clamp(24px,7vh,88px)] mb-6 w-[440px] max-w-[calc(100%-32px)] rounded-2xl border bg-background p-8 text-start max-md:my-[18px] max-md:max-w-[calc(100%-24px)] max-md:rounded-xl max-md:px-5 max-md:py-6",
        className,
      )}
      {...props}
    />
  );
}

/** A sign-in card's heading: the workspace's logo, at `logo` if it has one, over the title and a line under it. */
export function AuthHeading({ title, logo, children }: { title: string; logo: string | null; children: ReactNode }) {
  return (
    <header className="mb-7 text-center">
      <AuthLogo logo={logo} />
      <h1 className="mb-2 text-2xl leading-tight font-[650]">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
    </header>
  );
}

/** The workspace's logo at `logo`, 48px wide. With none, the lockup above the card is the mark. */
export function AuthLogo({ logo }: { logo: string | null }) {
  if (logo) return <AccountLogo src={logo} className="mx-auto mb-5 size-12" />;
  return null;
}
