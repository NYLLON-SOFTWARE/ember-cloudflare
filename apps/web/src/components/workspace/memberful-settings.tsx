import { MEMBERFUL_CALLBACK_PATH } from "@ember/protocol";
import { Switch } from "@/components/ui/switch";
import { useAccount } from "@/hooks/use-account";
import { cn } from "@/lib/utils";
import { WORKERS_DASHBOARD } from "./custom-domain-settings";

// This port's own Memberful section of workspace settings (`auth.memberful-sign-in`): an administrator
// turns on signing in with the accounts of a Memberful site, whose custom app's keys the deployment
// keeps as Worker secrets, so until it has them the section says how to make and set them. Styled as
// the Custom domain section is, with its switch as Hide translation buttons has one.

const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

interface Props {
  /** The Memberful site whose members can sign in, once the deployment has its keys, or null while it hasn't. */
  site: string | null;
  /** Where the switch is: where it was moved to while that's saved, or else where the workspace has it. */
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}

/**
 * Members sign in with Memberful, for administrators: the switch once the deployment has the keys, or
 * while it's on without them, which only turning it off mends, and the steps to get the keys until it has them.
 */
export function MemberfulSettings({ site, checked, onCheckedChange }: Props) {
  const { customDomain, memberfulSignIn } = useAccount();
  // Where Memberful sends people back to: Ember's address, wherever settings are opened.
  const redirectUrl = `${location.protocol}//${customDomain ?? location.host}${MEMBERFUL_CALLBACK_PATH}`;

  return (
    <section aria-labelledby="memberful-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3">
      <h2 id="memberful-heading" className="text-base font-semibold">
        Memberful
      </h2>
      {(site !== null || memberfulSignIn) && (
        <div className="flex items-center gap-x-[1ch] gap-y-4">
          <div className="min-w-0 flex-1">
            <div>Members sign in with Memberful</div>
            <p id="memberful-description" className={cn(NOTE, site === null && "text-negative")}>
              {site === null ? (
                "It's on, but this deployment no longer has its Memberful keys, so nobody can sign in with Memberful."
              ) : (
                <>
                  Members of <strong className="wrap-anywhere">{site}</strong> sign in with their Memberful account. While it's on, the join link is off, and
                  only administrators sign in with a password.
                </>
              )}
            </p>
          </div>
          <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label="Members sign in with Memberful" aria-describedby="memberful-description" />
        </div>
      )}
      {site === null ? (
        <Steps redirectUrl={redirectUrl} />
      ) : (
        <p className={NOTE}>
          Memberful sends people back to <span className="wrap-anywhere">{redirectUrl}</span>, the OAuth redirect URL of its custom app. If Ember's address
          changes, change it there too.
        </p>
      )}
    </section>
  );
}

/** The steps to let a Memberful site's members sign in: a custom app in Memberful, then its keys as the Worker's secrets. */
function Steps({ redirectUrl }: { redirectUrl: string }) {
  return (
    <>
      <p>Members of a Memberful site can sign in with their Memberful account instead of a password.</p>
      <ol aria-label="Steps to let Memberful members sign in" className="flex list-decimal flex-col gap-2 ps-5">
        <li>
          In Memberful, open <em>Settings</em>, <em>Custom applications</em>, and add one. Check <em>Include OAuth tokens with this application</em>, choose{" "}
          <em>Server-side</em>, and give it the OAuth redirect URL <strong className="wrap-anywhere">{redirectUrl}</strong>.
        </li>
        <li>
          Give this Worker three secrets: <code>MEMBERFUL_URL</code>, your site's address, such as https://example.memberful.com, and the app's OAuth identifier
          and client secret as <code>MEMBERFUL_CLIENT_ID</code> and <code>MEMBERFUL_CLIENT_SECRET</code>, with <code>wrangler secret put</code>, or as the type{" "}
          <em>Secret</em> under <em>Settings</em>, <em>Variables and Secrets</em> in the Cloudflare dashboard, since a deploy takes away plain text ones.{" "}
          <a href={WORKERS_DASHBOARD} target="_blank" rel="noopener" className="underline">
            Open the Cloudflare dashboard
          </a>
        </li>
        <li>
          Open workspace settings again, and turn on <em>Members sign in with Memberful</em>.
        </li>
      </ol>
    </>
  );
}
