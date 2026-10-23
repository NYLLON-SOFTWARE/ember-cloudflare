import { useState, type FormEvent } from "react";
import { canBeCustomDomain, CUSTOM_DOMAIN_NOT_A_HOST, isHost, NOT_A_CUSTOM_DOMAIN, WORKSPACE_SETTINGS_PATH, type Account, type CustomDomainReach } from "@ember/protocol";
import { FIELD_INPUT, Field } from "@/components/field";
import { Input } from "@/components/ui/input";
import { useAccount } from "@/hooks/use-account";
import { useMounted } from "@/hooks/use-mounted";
import { changeAccount, checkCustomDomain, isSignedOut } from "@/lib/api";
import { cn } from "@/lib/utils";

// This port's own Custom domain section of workspace settings (`accounts.custom-domain`), where ember-rust's
// address is its installer's `--domain`. Ember holds no Cloudflare token, so the administrator attaches the
// domain to the Worker in Cloudflare's dashboard, checks it reaches Ember, then opens Ember there and makes
// it Ember's address. Styled as the Rooms section is.

/** Where the Cloudflare dashboard lists an account's Workers, whichever account the person picks. */
export const WORKERS_DASHBOARD = "https://dash.cloudflare.com/?to=/:account/workers-and-pages";

/** Where the Cloudflare dashboard shows the Domains tab of the Worker named `worker`, whose Add Domain adds a custom domain. */
export const workerDomains = (worker: string) => `https://dash.cloudflare.com/?to=/:account/workers/services/view/${worker}/production/domains`;

/** Where Ember's README gives it a custom domain through Cloudflare for SaaS, for a domain whose DNS stays with another provider. */
export const DNS_ELSEWHERE = "https://github.com/NYLLON-SOFTWARE/ember-cloudflare#when-the-domains-dns-is-elsewhere";

/** A workers.dev address, `<worker>.<subdomain>.workers.dev`: the Worker's name, then its account's subdomain. */
const WORKERS_DEV = /^([a-z0-9-]+)\.[a-z0-9-]+\.workers\.dev$/;

/** The name of the Worker at `hostname`, a workers.dev address, which a deploy gives Ember, or null at any other. */
const workerAt = (hostname: string) => WORKERS_DEV.exec(hostname.toLowerCase())?.[1] ?? null;

/** The section's buttons, as its New room is. */
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-[9px] border bg-background px-3.5 py-2.5 font-medium disabled:opacity-50";
const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

interface Props {
  /** As workspace settings asks for the workspace, which it says the server answers with. */
  askForAccount: () => (account: Account) => void;
  /** Called once a change is saved. */
  onSaved: () => void;
  /** Says why saving failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * The host typed in, with or without its scheme and path, as `location.host` would write it at that
 * address, or why it can't be Ember's custom domain.
 */
function domainTyped(text: string): { domain: string } | { refusal: string } {
  const typed = text.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    return { refusal: CUSTOM_DOMAIN_NOT_A_HOST };
  }
  if (!isHost(url.host)) return { refusal: CUSTOM_DOMAIN_NOT_A_HOST };
  return canBeCustomDomain(url.hostname) ? { domain: url.host } : { refusal: NOT_A_CUSTOM_DOMAIN };
}

/**
 * Ember's custom domain for administrators: at a workers.dev or localhost address while it has none, the
 * steps to give it one; at any other address, Use this address, which makes it Ember's; and while it has
 * one, Stop using it.
 */
export function CustomDomainSettings({ askForAccount, onSaved, onFailed }: Props) {
  const { customDomain } = useAccount();
  const [changing, setChanging] = useState(false);
  const mounted = useMounted();
  const here = location.host;
  const hereCanBe = isHost(here) && canBeCustomDomain(location.hostname);

  const change = (domain: string | null) => {
    setChanging(true);
    const answered = askForAccount();
    changeAccount({ customDomain: domain }).then(
      (account) => {
        answered(account);
        if (!mounted.current) return;
        setChanging(false);
        onSaved();
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setChanging(false);
        onFailed(error);
      },
    );
  };
  const thisAddressButton = (
    <button type="button" onClick={() => change(here)} disabled={changing} className={BUTTON}>
      Use this address
    </button>
  );

  return (
    <section aria-labelledby="custom-domain-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3">
      <h2 id="custom-domain-heading" className="text-base font-semibold">
        Custom domain
      </h2>
      {customDomain !== null ? (
        <>
          <p>
            Ember's address is <strong className="wrap-anywhere">{customDomain}</strong>. Other addresses send people there.
          </p>
          {customDomain !== here && hereCanBe && (
            <p>
              You're on <strong className="wrap-anywhere">{here}</strong>, which could be its address instead.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => change(null)} disabled={changing} className={BUTTON}>
              Stop using it
            </button>
            {customDomain !== here && hereCanBe && thisAddressButton}
          </div>
          <p className={NOTE}>Workspace settings open at any of Ember's addresses, so if this one stops reaching Ember, open them at another and choose Stop using it.</p>
        </>
      ) : hereCanBe ? (
        <>
          <p>
            You're on <strong className="wrap-anywhere">{here}</strong>. Make it Ember's address, and other addresses send people here, where everyone signs in once more.
          </p>
          <div>{thisAddressButton}</div>
        </>
      ) : (
        <SetUp here={here} onFailed={onFailed} />
      )}
    </section>
  );
}

/** At an address that can't be Ember's custom domain: the domain to give it, and then how. */
function SetUp({ here, onFailed }: { here: string; onFailed: Props["onFailed"] }) {
  const [typed, setTyped] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  // The domain the steps are for, once Set up shows them.
  const [domain, setDomain] = useState<string | null>(null);

  const setUp = (event: FormEvent) => {
    event.preventDefault();
    const checked = domainTyped(typed);
    setRefusal("refusal" in checked ? checked.refusal : null);
    setDomain("domain" in checked ? checked.domain : null);
  };

  return (
    <>
      <p>
        People open Ember at <strong className="wrap-anywhere">{here}</strong>. It can have an address on a domain of yours instead.
      </p>
      <form onSubmit={setUp} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-[16em]">
          <Field id="custom_domain" label="Domain">
            <Input
              id="custom_domain"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="chat.example.com"
              value={typed}
              aria-invalid={refusal !== null}
              aria-describedby={refusal === null ? undefined : "custom-domain-refusal"}
              onChange={(event) => {
                setTyped(event.target.value);
                setDomain(null);
              }}
              className={FIELD_INPUT}
            />
          </Field>
        </div>
        <button type="submit" className={BUTTON}>
          Set up
        </button>
      </form>
      {refusal !== null && (
        <p id="custom-domain-refusal" role="alert" className={cn(NOTE, "text-negative")}>
          {refusal}
        </p>
      )}
      {domain !== null && <Steps key={domain} domain={domain} onFailed={onFailed} />}
    </>
  );
}

/** What Check DNS says it found at `domain`, which should be added to the Worker named `worker`, where that's known. */
function reachNote(reaches: CustomDomainReach, domain: string, worker: string | null): string {
  if (reaches === "ember") return `${domain} reaches Ember.`;
  if (reaches === "elsewhere") return `Something else answers at ${domain}. Check that it's added to ${worker ?? "the Worker that runs Ember"}, not another.`;
  return `Nothing answers at ${domain} yet. Cloudflare can take a few minutes to add a domain, so check again soon.`;
}

/**
 * The steps to make `domain` Ember's address: Cloudflare's, on the Domains tab of the Worker this page
 * is open at, where its workers.dev address names it, or the README's for a domain whose DNS stays
 * elsewhere; a check that the domain reaches Ember; then Ember's.
 */
function Steps({ domain, onFailed }: { domain: string; onFailed: Props["onFailed"] }) {
  // What Check DNS found, or "checking" while it asks.
  const [reaches, setReaches] = useState<CustomDomainReach | "checking" | null>(null);
  const mounted = useMounted();
  const worker = workerAt(location.hostname);
  const settings = `${location.protocol}//${domain}${WORKSPACE_SETTINGS_PATH}`;

  const check = () => {
    setReaches("checking");
    checkCustomDomain(domain).then(
      (found) => {
        if (mounted.current) setReaches(found);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setReaches(null);
        onFailed(error);
      },
    );
  };

  return (
    <ol aria-label={`Steps to make ${domain} Ember's address`} className="flex list-decimal flex-col gap-2 ps-5">
      <li>
        {worker === null ? (
          <>
            In the Cloudflare dashboard, open <em>Workers &amp; Pages</em>, choose this Worker and open its <em>Domains</em> tab.
          </>
        ) : (
          <>
            In the Cloudflare dashboard, open the <em>Domains</em> tab of <strong className="wrap-anywhere">{worker}</strong>, the Worker that runs Ember.
          </>
        )}{" "}
        Under <em>Custom Domains and Routes</em>, choose <em>Add Domain</em> and enter <strong className="wrap-anywhere">{domain}</strong>. Its domain must be on
        Cloudflare, in the account that runs Ember.{" "}
        <a href={worker === null ? WORKERS_DASHBOARD : workerDomains(worker)} target="_blank" rel="noopener" className="wrap-anywhere underline">
          {worker === null ? "Open the Cloudflare dashboard" : `Open ${worker}'s domains`}
        </a>
        <p className={cn(NOTE, "mt-1")}>
          If the domain's DNS is with another provider, Cloudflare offers to take it over for free, copying its records. To leave it there, follow{" "}
          <a href={DNS_ELSEWHERE} target="_blank" rel="noopener" className="underline">
            Ember's steps for Cloudflare for SaaS
          </a>{" "}
          instead.
        </p>
      </li>
      <li>
        Check that <strong className="wrap-anywhere">{domain}</strong> reaches Ember.
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" onClick={check} disabled={reaches === "checking"} className={BUTTON}>
            Check DNS
          </button>
          <p role="status" className={cn("min-w-0 flex-1 basis-[16em] wrap-anywhere", reaches === "ember" && "text-positive", (reaches === "elsewhere" || reaches === "nothing") && "text-negative")}>
            {reaches === "checking" ? `Checking ${domain}…` : reaches !== null && reachNote(reaches, domain, worker)}
          </p>
        </div>
      </li>
      <li>
        Once it does, open{" "}
        <a href={settings} className="wrap-anywhere underline">
          {settings}
        </a>
        , sign in, and choose <em>Use this address</em>.
      </li>
    </ol>
  );
}
