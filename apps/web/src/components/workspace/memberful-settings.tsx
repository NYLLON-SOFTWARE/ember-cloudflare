import { MEMBERFUL_CALLBACK_PATH, MEMBERFUL_WEBHOOK_PATH } from "@ember/protocol";
import { Switch } from "@/components/ui/switch";
import { useAccount } from "@/hooks/use-account";
import { cn } from "@/lib/utils";
import { WORKERS_DASHBOARD } from "./custom-domain-settings";

// This port's own Memberful card in Membership's ways to join (`auth.memberful-sign-in`): an
// administrator turns on signing in with the accounts of a Memberful site, whose custom app's keys the
// deployment keeps as Worker secrets, so until it has them the card says how to make and set them, and
// how to have Memberful's webhooks say when a membership lapses (`auth.memberful-memberships`). Styled
// as the Custom domain section is, with its switch as Hide translation buttons has one.

const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

interface Props {
  /** The Memberful site whose members can sign in, once the deployment has its keys, or null while it hasn't. */
  site: string | null;
  /** Whether the deployment also has what Memberful's webhooks take, so that a member whose membership lapses is signed out. */
  webhooks: boolean;
  /** Where the switch is: where it was moved to while that's saved, or else where the workspace has it. */
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  /** Why the switch can't be moved while another way to join is on, said in place of what it does, or null. */
  setAside?: string | null;
}

/**
 * Members sign in with Memberful, for administrators: the switch once the deployment has the keys, or
 * while it's on without them, which only turning it off mends, and the steps to get the keys until it
 * has them, then those to hear Memberful's webhooks until it does.
 */
export function MemberfulSettings({ site, webhooks, checked, onCheckedChange, setAside = null }: Props) {
  const { customDomain, memberfulSignIn } = useAccount();
  // Where Memberful sends people back to, and its webhooks: Ember's address, wherever settings are opened.
  const origin = `${location.protocol}//${customDomain ?? location.host}`;
  const redirectUrl = `${origin}${MEMBERFUL_CALLBACK_PATH}`;
  const webhookUrl = `${origin}${MEMBERFUL_WEBHOOK_PATH}`;

  return (
    <section aria-labelledby="memberful-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3">
      <h3 id="memberful-heading" className={cn("text-base font-semibold", setAside !== null && "text-muted-foreground")}>
        Memberful
      </h3>
      {(site !== null || memberfulSignIn) && (
        <div className="flex items-center gap-x-[1ch] gap-y-4">
          <div className="min-w-0 flex-1">
            <div>Members sign in with Memberful</div>
            <p id="memberful-description" className={cn(NOTE, site === null && "text-negative")}>
              {site === null ? (
                "It's on, but this deployment no longer has its Memberful keys, so nobody can sign in with Memberful."
              ) : setAside !== null ? (
                setAside
              ) : (
                <>
                  Members of <strong className="wrap-anywhere">{site}</strong> sign in with their Memberful account. While it's on, nobody else can join, and
                  only administrators sign in with a password. Members who have one connect their Memberful account as they next sign in.
                  {webhooks && " A member whose membership lapses is signed out until it's renewed."}
                </>
              )}
            </p>
          </div>
          <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={setAside !== null}
            aria-label="Members sign in with Memberful"
            aria-describedby="memberful-description"
          />
        </div>
      )}
      {site === null ? (
        <Steps redirectUrl={redirectUrl} webhookUrl={webhookUrl} />
      ) : (
        <>
          {!webhooks && <WebhookSteps webhookUrl={webhookUrl} />}
          <p className={NOTE}>
            {webhooks ? (
              <>
                Memberful sends people back to <span className="wrap-anywhere">{redirectUrl}</span>, the OAuth redirect URL of its custom app, and its webhook
                to <span className="wrap-anywhere">{webhookUrl}</span>. If Ember's address changes, change both there too.
              </>
            ) : (
              <>
                Memberful sends people back to <span className="wrap-anywhere">{redirectUrl}</span>, the OAuth redirect URL of its custom app. If Ember's
                address changes, change it there too.
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}

/** A link to the Cloudflare dashboard, where the Worker's secrets are set. */
function DashboardLink() {
  return (
    <a href={WORKERS_DASHBOARD} target="_blank" rel="noopener" className="underline">
      Open the Cloudflare dashboard
    </a>
  );
}

/**
 * The steps to let a Memberful site's members sign in: a custom app in Memberful, then its keys as the
 * Worker's secrets, and a webhook with the two secrets that hearing it takes.
 */
function Steps({ redirectUrl, webhookUrl }: { redirectUrl: string; webhookUrl: string }) {
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
          <DashboardLink />
        </li>
        <li>
          So that a member whose membership lapses is signed out, not only kept from signing in again: <AddWebhook webhookUrl={webhookUrl} /> Then give this
          Worker two more secrets: <WebhookSecrets />.
        </li>
        <li>
          Open workspace settings again, and turn on <em>Members sign in with Memberful</em>.
        </li>
      </ol>
    </>
  );
}

/** The steps to hear Memberful's webhooks, once members can sign in, until the deployment has what it takes. */
function WebhookSteps({ webhookUrl }: { webhookUrl: string }) {
  return (
    <>
      <p>A member whose membership lapses can't sign in again, but stays signed in where they are until Ember hears Memberful's webhooks.</p>
      <ol aria-label="Steps to sign out members whose membership lapses" className="flex list-decimal flex-col gap-2 ps-5">
        <li>
          <AddWebhook webhookUrl={webhookUrl} />
        </li>
        <li>
          Give this Worker two more secrets: <WebhookSecrets />. <DashboardLink />
        </li>
      </ol>
    </>
  );
}

/** Adding the webhook in Memberful, which says when a member's account, subscription or order changes. */
function AddWebhook({ webhookUrl }: { webhookUrl: string }) {
  return (
    <>
      In Memberful, open <em>Settings</em>, <em>Webhooks</em>, and add one that sends the member, subscription and order events to{" "}
      <strong className="wrap-anywhere">{webhookUrl}</strong>.
    </>
  );
}

/** The two secrets that hearing the webhook takes: its own, to check it came from Memberful, and the API key, to check what it says. */
function WebhookSecrets() {
  return (
    <>
      the webhook's secret key as <code>MEMBERFUL_WEBHOOK_SECRET</code>, and the custom app's API key as <code>MEMBERFUL_API_KEY</code>
    </>
  );
}
