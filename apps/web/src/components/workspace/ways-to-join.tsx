import { useState, type ReactNode } from "react";
import { joinsWithLink, signsUpOpenly, SIGN_UPS_PER_ADDRESS, SIGN_UPS_PER_HOUR, type AccountSettings, type WorkspaceSettings } from "@ember/protocol";
import { PageLink } from "@/components/page-link";
import { Switch } from "@/components/ui/switch";
import { useAccount } from "@/hooks/use-account";
import { cn } from "@/lib/utils";
import { ShareableLink } from "./invite-link";
import { SIGN_UP_LINK, signUpUrl } from "./join-link";
import { MemberfulSettings } from "./memberful-settings";
import { workspaceSectionPath } from "./settings-navigation";

// This port's own ways for new people to join (`accounts.ways-to-join`), at the top of Membership: for
// administrators, a card for each, Open, Join link and Memberful, whose switch saves as it's flipped, as
// the Memberful card's did, and which shows the way's settings while it's on. Open lets anyone in, and
// Memberful only its members, so while either is on the ways it overrides are greyed out, keeping their
// settings for when it's off. Members see the links that let people in.

/** What turning on Open asks first, since it lets anyone in. */
export const CONFIRM_OPEN = "Are you sure you want to let anyone create an account? Ember doesn't check that the email addresses people sign up with are theirs.";

/** What turning on Memberful sign-in asks first, since it keeps everyone but administrators from signing in with a password. */
export const CONFIRM_MEMBERFUL = "Are you sure you want members to sign in with Memberful? Everyone but administrators will need a Memberful membership to sign in.";

/** Why a way is greyed out while Open is on. */
const OPEN_OVERRIDES = "Set aside while Open lets anyone join.";

/** Why a way is greyed out while members sign in with Memberful. */
const MEMBERFUL_OVERRIDES = "Off while members sign in with Memberful.";

/** Where Turnstile's widgets are made, in the Cloudflare dashboard. */
const TURNSTILE_DASHBOARD = "https://dash.cloudflare.com/?to=/:account/turnstile";

const CARD = "flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3";
const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

type WaySetting = keyof Pick<AccountSettings, "openSignUp" | "joinLink" | "memberfulSignIn">;

const ASKS_FIRST: Partial<Record<WaySetting, string>> = { openSignUp: CONFIRM_OPEN, memberfulSignIn: CONFIRM_MEMBERFUL };

interface Props {
  settings: WorkspaceSettings;
  /** Saves a switch, as the page saves its others, then calls `settled`. */
  saveSwitch: (settings: AccountSettings, settled: () => void) => void;
  /** The join link, with its buttons, which its card shows while it's on. */
  joinLink: ReactNode;
}

/** Who can join, for administrators: a card for each way, with its switch, and its settings while it's on. */
export function WaysToJoin({ settings, saveSwitch, joinLink }: Props) {
  const account = useAccount();
  // Where each switch was moved to, while that's saved.
  const [moved, setMoved] = useState<Pick<AccountSettings, WaySetting>>({});
  const open = moved.openSignUp ?? account.openSignUp;
  const link = moved.joinLink ?? account.joinLink;
  const memberful = moved.memberfulSignIn ?? account.memberfulSignIn;
  // A way sets the others aside while it's on, until turning it off is saved, so that none is turned on
  // while the server still has the way that overrides it on, which would refuse it.
  const openOverrides = open || account.openSignUp;
  const memberfulOverrides = memberful || account.memberfulSignIn;

  const switchTo = (setting: WaySetting) => (on: boolean) => {
    if (moved[setting] !== undefined) return;
    const question = on ? ASKS_FIRST[setting] : undefined;
    if (question && !confirm(question)) return;
    setMoved((moved) => ({ ...moved, [setting]: on }));
    saveSwitch({ [setting]: on }, () => setMoved(({ [setting]: _, ...others }) => others));
  };

  return (
    <section aria-labelledby="ways-to-join-heading" className="flex flex-col gap-3">
      <header className="mb-1">
        <h2 id="ways-to-join-heading" className="mb-1.5 text-[17px] font-semibold">
          Who can join
        </h2>
        <p className="text-[13px] text-muted-foreground">Choose how new people can make an account.</p>
      </header>
      {/* Open and Memberful can't both be on, but should both be, each can still be turned off. */}
      <Way
        id="open-sign-up"
        title="Open"
        description="Anyone can create an account at Ember's sign-up page."
        checked={open}
        onCheckedChange={switchTo("openSignUp")}
        setAside={memberfulOverrides && !open ? MEMBERFUL_OVERRIDES : null}
      >
        <ShareableLink id="sign_up" label="Share so anyone can sign up" url={signUpUrl()} sharing={SIGN_UP_LINK} />
        {!account.restrictRoomCreation && (
          <p className={NOTE}>
            Anyone who signs up can create rooms. To keep that to administrators, turn on{" "}
            <PageLink href={workspaceSectionPath("channel-settings")} className="underline">
              Must be admin to create new rooms
            </PageLink>
            .
          </p>
        )}
        <p className={NOTE}>
          {SIGN_UPS_PER_ADDRESS} people can sign up from a network in an hour, and signing up waits once {SIGN_UPS_PER_HOUR} people have joined in an
          hour.{" "}
          {settings.turnstile ? (
            "Cloudflare Turnstile checks that whoever signs up is a person."
          ) : (
            <>
              To check that whoever signs up is a person too, add a Turnstile widget for Ember's address in the Cloudflare dashboard, then give this Worker
              its site key and secret key as the secrets <code>TURNSTILE_SITE_KEY</code> and <code>TURNSTILE_SECRET_KEY</code>.{" "}
              <a href={TURNSTILE_DASHBOARD} target="_blank" rel="noopener" className="underline">
                Open Turnstile in the Cloudflare dashboard
              </a>
            </>
          )}
        </p>
      </Way>
      <Way
        id="join-link"
        title="Join link"
        description="Anyone with the link can create an account."
        checked={link}
        onCheckedChange={switchTo("joinLink")}
        setAside={memberfulOverrides ? MEMBERFUL_OVERRIDES : openOverrides ? OPEN_OVERRIDES : null}
      >
        {joinLink}
      </Way>
      <MemberfulSettings
        site={settings.memberfulSite}
        webhooks={settings.memberfulWebhooks}
        checked={memberful}
        onCheckedChange={switchTo("memberfulSignIn")}
        setAside={openOverrides && !memberful ? OPEN_OVERRIDES : null}
      />
      {!open && !link && !memberful && <p className="text-start">With all of these off, no one new can join.</p>}
    </section>
  );
}

interface WayProps {
  id: string;
  title: string;
  /** Whom it lets in, in a line. */
  description: string;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  /** Why the switch can't be moved while another way overrides it, said in place of the description, or null. */
  setAside: string | null;
  /** Its settings, shown while it's on, unless it's set aside. */
  children: ReactNode;
}

/** A way to join's card: its switch, and its settings while it's on. */
function Way({ id, title, description, checked, onCheckedChange, setAside, children }: WayProps) {
  return (
    <section aria-labelledby={`${id}-heading`} className={CARD}>
      <div className="flex items-center gap-x-[1ch] gap-y-4">
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-heading`} className={cn("text-base font-semibold", setAside !== null && "text-muted-foreground")}>
            {title}
          </h3>
          <p id={`${id}-description`} className={NOTE}>
            {setAside ?? description}
          </p>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={setAside !== null}
          aria-labelledby={`${id}-heading`}
          aria-describedby={`${id}-description`}
        />
      </div>
      {checked && setAside === null && children}
    </section>
  );
}

/** How new people join, for members: open sign-up's link while it's on, and the join link while it lets people in, or a line saying why neither does. */
export function HowPeopleJoin({ joinLink }: { joinLink: ReactNode }) {
  const account = useAccount();
  const open = signsUpOpenly(account);
  const link = joinsWithLink(account);
  if (!open && !link)
    return account.memberfulSignIn ? (
      <p className="text-start">
        <strong>Members sign in with Memberful</strong>, so the join link is off.
      </p>
    ) : (
      <p className="text-start">No one new can join right now.</p>
    );
  return (
    <div className="flex flex-col gap-4">
      {open && (
        <div className="rounded-[10px] border bg-surface p-5 upto-500px:p-3.5">
          <ShareableLink id="sign_up" label="Share so anyone can sign up" url={signUpUrl()} sharing={SIGN_UP_LINK} />
        </div>
      )}
      {/* `#account_invitation`, a card on the surface. */}
      {link && <div className="rounded-[10px] border bg-surface p-5 upto-500px:p-3.5">{joinLink}</div>}
    </div>
  );
}
