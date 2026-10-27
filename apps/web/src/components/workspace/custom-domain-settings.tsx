import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  canBeCustomDomain,
  CUSTOM_DOMAIN_NOT_A_HOST,
  isHost,
  NOT_A_CUSTOM_DOMAIN,
  othersAfterMove,
  WORKSPACE_SETTINGS_PATH,
  type Account,
  type CustomDomainReach,
  type EmberAddresses,
} from "@ember/protocol";
import { FIELD_INPUT, Field } from "@/components/field";
import { Input } from "@/components/ui/input";
import { useAccount } from "@/hooks/use-account";
import { useMounted } from "@/hooks/use-mounted";
import { changeAccount, checkCustomDomain, fetchWorkspaceSettings, isSignedOut } from "@/lib/api";
import { moveTo } from "@/lib/custom-domain";
import { cn } from "@/lib/utils";

// This port's own Custom domain section of workspace settings (`accounts.custom-domain`), where ember-rust's
// address is its installer's `--domain`. Ember holds no Cloudflare token, so the administrator attaches the
// domain to the Worker in Cloudflare's dashboard, checks it reaches Ember, then opens Ember there and makes
// it Ember's address. Going back makes the Worker's workers.dev address Ember's again. A domain Ember moves
// away from keeps reaching it, sending people on, until it's removed in Cloudflare, so the section names it
// until a check finds it gone. Styled as the Rooms section is.

/** Where the Cloudflare dashboard lists an account's Workers, whichever account the person picks. */
export const WORKERS_DASHBOARD = "https://dash.cloudflare.com/?to=/:account/workers-and-pages";

/** Where the Cloudflare dashboard shows the Domains tab of the Worker named `worker`, whose Add Domain adds a custom domain. */
export const workerDomains = (worker: string) => `https://dash.cloudflare.com/?to=/:account/workers/services/view/${worker}/production/domains`;

/** Where Ember's README gives it a custom domain through Cloudflare for SaaS, for a domain whose DNS stays with another provider. */
export const DNS_ELSEWHERE = "https://github.com/NYLLON-SOFTWARE/ember-cloudflare#when-the-domains-dns-is-elsewhere";

/** A workers.dev address, `<worker>.<subdomain>.workers.dev`: the Worker's name, then its account's subdomain. */
const WORKERS_DEV = /^([a-z0-9-]+)\.[a-z0-9-]+\.workers\.dev$/;

/** The name of the Worker at `host`, a workers.dev address, which a deploy gives Ember, or null at any other. */
const workerAt = (host: string) => WORKERS_DEV.exec(host.toLowerCase())?.[1] ?? null;

/** The section's buttons, as its New room is. */
const BUTTON = "inline-flex min-h-11 max-w-full items-center justify-center rounded-[9px] border bg-background px-3.5 py-2.5 font-medium wrap-anywhere disabled:opacity-50";
const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

/** How a change, or a check, changes the addresses Ember knows reach it. */
type AddressesChange = (addresses: EmberAddresses) => EmberAddresses;

interface Props {
  /** The addresses Ember knows reach it besides its own, as workspace settings has them. */
  addresses: EmberAddresses;
  /** Shows the addresses as a change, or a check, changes them, which only workspace settings shows. */
  showAddresses: (change: AddressesChange) => void;
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
 * Ember's address for administrators. Where a deploy puts it, while that's its address or it has none,
 * the steps to give it a custom domain, which Move to another domain shows anywhere else. At an address
 * that could be a custom domain, Use this address, which makes it Ember's, and while it has one, Go back
 * to where a deploy puts it, or Stop using it until Ember knows where that is. The domains Ember moved
 * away from, each with a check.
 */
export function CustomDomainSettings({ addresses, showAddresses, askForAccount, onSaved, onFailed }: Props) {
  const { customDomain } = useAccount();
  const [changing, setChanging] = useState(false);
  // Whether Move to another domain has shown the steps.
  const [moving, setMoving] = useState(false);
  const mounted = useMounted();
  const here = location.host;
  const hereCanBe = isHost(here) && canBeCustomDomain(location.hostname);
  // This page's address is where a deploy puts Ember before a page there has told it so.
  const deployed = addresses.deployed ?? (isHost(here) && !hereCanBe ? here : null);
  const worker = workerAt(deployed ?? here);
  const others = addresses.others.filter((address) => address !== here && address !== customDomain);
  // Where a deploy puts Ember, the steps to a custom domain are what it offers.
  const settingUpHere = !hereCanBe && (customDomain === null || customDomain === here);
  // Ember's address when the addresses were last shown. Another tab moving Ember changes them too, as only
  // the server can say, so they're asked for again then.
  const shownFor = useRef(customDomain);
  // While they're asked for, what's changed them here since, which the answer may have been read before,
  // so it's made to the answer too. Only the latest ask's answer shows.
  const asking = useRef<AddressesChange[] | null>(null);
  const changeAddresses = (change: AddressesChange) => {
    asking.current?.push(change);
    showAddresses(change);
  };
  useEffect(() => {
    if (customDomain === shownFor.current) return;
    shownFor.current = customDomain;
    const since: AddressesChange[] = [];
    asking.current = since;
    fetchWorkspaceSettings().then(
      ({ addresses }) => {
        if (asking.current !== since) return;
        asking.current = null;
        showAddresses(() => since.reduce((shown, change) => change(shown), addresses));
      },
      (error: unknown) => {
        if (asking.current === since) asking.current = null;
        if (mounted.current || isSignedOut(error)) onFailed(error);
      },
    );
  }, [customDomain, showAddresses, mounted, onFailed]);

  const change = (address: string | null, then?: () => void) => {
    setChanging(true);
    const answered = askForAccount();
    changeAccount({ customDomain: address }).then(
      (account) => {
        shownFor.current = account.customDomain;
        answered(account);
        if (account.customDomain !== customDomain) changeAddresses((known) => ({ ...known, others: othersAfterMove(known.others, [customDomain, here], account.customDomain) }));
        if (!mounted.current) return;
        setChanging(false);
        setMoving(false);
        onSaved();
        then?.();
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setChanging(false);
        onFailed(error);
      },
    );
  };
  // Workspace settings stay wherever they're opened, so going back from another address takes them along.
  const goBack = (address: string) => change(address, address === here ? undefined : () => void moveTo(address));
  const forget = (address: string) => changeAddresses((known) => ({ ...known, others: known.others.filter((other) => other !== address) }));
  const elsewhere = customDomain !== null && customDomain !== here && here !== deployed;
  const actions = [
    hereCanBe && customDomain !== here && (
      <button key="use" type="button" onClick={() => change(here)} disabled={changing} className={BUTTON}>
        Use this address
      </button>
    ),
    // Where a deploy puts Ember, with no address of its own, the steps are all it offers.
    deployed !== null && customDomain !== deployed && !(customDomain === null && settingUpHere) && (
      <button key="back" type="button" onClick={() => goBack(deployed)} disabled={changing} className={BUTTON}>
        Go back to {deployed}
      </button>
    ),
    deployed === null && customDomain !== null && (
      <button key="stop" type="button" onClick={() => change(null)} disabled={changing} className={BUTTON}>
        Stop using it
      </button>
    ),
    !settingUpHere && !moving && (
      <button key="move" type="button" onClick={() => setMoving(true)} className={BUTTON}>
        Move to another domain
      </button>
    ),
  ].filter(Boolean);

  return (
    <section aria-labelledby="custom-domain-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3">
      <h2 id="custom-domain-heading" className="text-base font-semibold">
        Custom domain
      </h2>
      {customDomain === null ? (
        !settingUpHere && (
          <p>
            You're on <strong className="wrap-anywhere">{here}</strong>. Make it Ember's address, and other addresses send people here, where everyone signs in once more.
          </p>
        )
      ) : (
        <p>
          Ember's address is <strong className="wrap-anywhere">{customDomain}</strong>. <SentOn address={customDomain} here={here} deployed={deployed} />
        </p>
      )}
      {elsewhere && (
        <p>
          You're on <strong className="wrap-anywhere">{here}</strong>, which still reaches Ember and sends people there. To stop it, remove it from {worker ?? "the Worker"} in
          Cloudflare{hereCanBe && ", or make it Ember's address instead"}. <DomainsLink worker={worker} />
        </p>
      )}
      <OtherAddresses
        others={others}
        sendsPeople={customDomain === null ? null : customDomain === here ? "here" : customDomain}
        worker={worker}
        onGone={forget}
        onFailed={onFailed}
      />
      {actions.length > 0 && <div className="flex flex-wrap gap-3">{actions}</div>}
      {(settingUpHere || moving) && (
        <SetUp
          intro={
            settingUpHere &&
            (customDomain === null ? (
              <>
                People open Ember at <strong className="wrap-anywhere">{here}</strong>. It can have an address on a domain of yours instead.
              </>
            ) : (
              "It can have an address on a domain of yours instead."
            ))
          }
          autoFocus={moving}
          worker={worker}
          onGone={forget}
          onFailed={onFailed}
        />
      )}
      {customDomain !== null && (
        <p className={cn(NOTE, "wrap-anywhere")}>
          Workspace settings open at every address that reaches Ember, so if {customDomain} stops reaching it, open them at{" "}
          {deployed === null ? "another and choose Stop using it" : customDomain === deployed ? "another and choose Use this address" : `${deployed} and go back there`}.
        </p>
      )}
    </section>
  );
}

/** Where other addresses send people, as said at `here`, while Ember's address is `address`. */
function SentOn({ address, here, deployed }: { address: string; here: string; deployed: string | null }) {
  if (address !== here) return here === deployed ? "Other addresses, this one included, send people there." : "Other addresses send people there.";
  if (deployed === null || deployed === address) return "Other addresses send people here.";
  return (
    <>
      Other addresses, <span className="wrap-anywhere">{deployed}</span> included, send people here.
    </>
  );
}

/** A link to the Domains tab of the Worker named `worker` in Cloudflare's dashboard, or to the list of Workers where its name isn't known. */
function DomainsLink({ worker }: { worker: string | null }) {
  return (
    <a href={worker === null ? WORKERS_DASHBOARD : workerDomains(worker)} target="_blank" rel="noopener" className="wrap-anywhere underline">
      {worker === null ? "Open the Cloudflare dashboard" : `Open ${worker}'s domains`}
    </a>
  );
}

/** What checking `address`, a custom domain Ember moved away from, found there. */
const checkedNote = (address: string, reaches: CustomDomainReach) => (reaches === "ember" ? `${address} still reaches Ember.` : `${address} no longer reaches Ember.`);

/**
 * The custom domains Ember moved away from, `others`, which keep reaching it until they're removed from
 * the Worker named `worker`, sending people to `sendsPeople`, "here" or an address, or showing Ember
 * while it has no address, null. Each has a check, after which one that no longer reaches Ember is gone.
 */
function OtherAddresses({
  others,
  sendsPeople,
  worker,
  onGone,
  onFailed,
}: {
  others: string[];
  sendsPeople: string | null;
  worker: string | null;
  onGone: (address: string) => void;
  onFailed: Props["onFailed"];
}) {
  // What the latest check found, or "checking" while it asks.
  const [checked, setChecked] = useState<{ address: string; reaches: CustomDomainReach | "checking" } | null>(null);
  const mounted = useMounted();

  const check = (address: string) => {
    setChecked({ address, reaches: "checking" });
    checkCustomDomain(address).then(
      (reaches) => {
        if (reaches !== "ember") onGone(address);
        if (mounted.current) setChecked({ address, reaches });
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setChecked(null);
        onFailed(error);
      },
    );
  };

  if (others.length === 0 && checked === null) return null;
  return (
    <div className="flex flex-col gap-2">
      {others.length > 0 && (
        <>
          <ul aria-label="Other addresses that reach Ember" className="flex flex-col gap-2">
            {others.map((address) => (
              <li key={address} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="min-w-0 flex-1 basis-[16em]">
                  <strong className="wrap-anywhere">{address}</strong> still reaches Ember
                  {sendsPeople === null ? "" : sendsPeople === "here" ? " and sends people here" : ` and sends people to ${sendsPeople}`} until it's removed from{" "}
                  {worker ?? "the Worker"} in Cloudflare.
                </p>
                <button type="button" onClick={() => check(address)} disabled={checked?.reaches === "checking"} className={BUTTON}>
                  Check {address}
                </button>
              </li>
            ))}
          </ul>
          <p>
            <DomainsLink worker={worker} />
          </p>
        </>
      )}
      <p role="status" className={cn("wrap-anywhere", checked?.reaches === "ember" && "text-negative", checked !== null && checked.reaches !== "ember" && checked.reaches !== "checking" && "text-positive")}>
        {checked !== null && (checked.reaches === "checking" ? `Checking ${checked.address}…` : checkedNote(checked.address, checked.reaches))}
      </p>
    </div>
  );
}

/**
 * The domain to give Ember, and then how, after `intro`, if any: its field takes the focus at once when
 * `autoFocus` says, as when Move to another domain shows it. `worker` names the Worker that runs Ember,
 * where that's known, and `onGone` forgets a domain Check DNS finds no longer reaches Ember.
 */
function SetUp({
  intro,
  autoFocus,
  worker,
  onGone,
  onFailed,
}: {
  intro: ReactNode;
  autoFocus: boolean;
  worker: string | null;
  onGone: (address: string) => void;
  onFailed: Props["onFailed"];
}) {
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
      {intro && <p>{intro}</p>}
      <form onSubmit={setUp} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-[16em]">
          <Field id="custom_domain" label="Domain">
            <Input
              id="custom_domain"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus={autoFocus}
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
      {domain !== null && <Steps key={domain} domain={domain} worker={worker} onGone={onGone} onFailed={onFailed} />}
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
 * The steps to make `domain` Ember's address: Cloudflare's, on the Domains tab of the Worker named
 * `worker`, which its workers.dev address names, or the README's for a domain whose DNS stays
 * elsewhere; a check that the domain reaches Ember, after which one Ember moved away from that no longer
 * does is gone, as the server forgets it; then Ember's.
 */
function Steps({ domain, worker, onGone, onFailed }: { domain: string; worker: string | null; onGone: (address: string) => void; onFailed: Props["onFailed"] }) {
  // What Check DNS found, or "checking" while it asks.
  const [reaches, setReaches] = useState<CustomDomainReach | "checking" | null>(null);
  const mounted = useMounted();
  const settings = `${location.protocol}//${domain}${WORKSPACE_SETTINGS_PATH}`;

  const check = () => {
    setReaches("checking");
    checkCustomDomain(domain).then(
      (found) => {
        if (found !== "ember") onGone(domain);
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
        Cloudflare, in the account that runs Ember. <DomainsLink worker={worker} />
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
