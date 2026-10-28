import { feature } from "@ember/parity";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_DOMAIN_NOT_A_HOST,
  NOT_A_CUSTOM_DOMAIN,
  type Account,
  type AccountChanges,
  type CustomDomainLookup,
  type CustomDomainReach,
  type EmberAddresses,
} from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { AccountContext } from "@/hooks/use-account";
import { ApiError } from "@/lib/api";
import { loadPage } from "@/lib/page";
import { CLOUDFLARE_DOMAINS, CustomDomainSettings, WORKERS_DASHBOARD, workerDomains } from "./custom-domain-settings";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn() }));

/** The test environment's jsdom, whose address the section reads as the page's. */
declare const jsdom: { reconfigure(options: { url: string }): void };

const EMBER: Account = { name: "Ember", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, joinLink: true, openSignUp: false, memberfulJoin: false, memberfulSignIn: false, emailDomainSignUp: false, emailDomains: [], navigationIcons: {} };

/** Where a deploy puts Ember in most of these tests, which names its Worker. */
const DEPLOYED = "ember-production.nyllon.workers.dev";

/** Where Workspace settings would be at `host`. */
const settingsAt = (host: string) => `https://${host}/account/edit`;

/** What the server refuses with, as its problems say. */
interface Refusal {
  status: number;
  error: string;
}

/**
 * Answers as the server does: saving the custom domain with the workspace as it then is, unless
 * `refusal` says why not, and looking a domain's DNS up with `lookup`, or the refusal it gives.
 */
function serve({ refusal, lookup = { zone: "example.com", provider: "cloudflare" } }: { refusal?: Refusal; lookup?: CustomDomainLookup | Refusal } = {}) {
  let account = EMBER;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const asked = `${init?.method} ${String(input)}`;
    if (asked === "POST /api/account/custom_domain_lookups") return "error" in lookup ? Response.json({ error: lookup.error }, { status: lookup.status }) : Response.json(lookup);
    expect(asked).toBe("PATCH /api/account");
    if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });
    const { customDomain } = JSON.parse(String(init?.body)) as AccountChanges;
    account = { ...account, customDomain: customDomain ?? null };
    return Response.json({ account });
  });
}

/**
 * Answers checking an address Ember moved away from as the server does, with what each domain reaches in
 * turn, once `answer` lets each through, or with `refusal`, and keeps the domains asked about.
 */
function serveChecks(reaches: CustomDomainReach[], refusal?: Refusal) {
  const asked: unknown[] = [];
  let answer = () => {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(`${init?.method} ${String(input)}`).toBe("POST /api/account/custom_domain_checks");
    asked.push(JSON.parse(String(init?.body)));
    await new Promise<void>((resolve) => (answer = resolve));
    if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });
    return Response.json({ reaches: reaches.shift() });
  });
  return { asked, answer: () => answer() };
}

/** What the section sent `path`, in order. */
const sentTo = (path: string) =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([input]) => String(input) === path)
    .map(([, init]) => JSON.parse(String(init?.body)) as unknown);

/** What the section asked to save, in order. */
const saved = () => sentTo("/api/account");

/** The domains whose DNS the section looked up, in order. */
const lookedUp = () => sentTo("/api/account/custom_domain_lookups");

/**
 * The section in workspace settings at `url`, for a workspace whose custom domain is `customDomain`, and
 * which knows of `addresses`, both of which it changes as the app would. `shown()` says what the
 * addresses are then, and `hear` has the workspace socket say the account is another.
 */
function showSection(url: string, customDomain: string | null = null, addresses: EmberAddresses = { deployed: null, others: [] }) {
  jsdom.reconfigure({ url });
  const callbacks = { onSaved: vi.fn(), onFailed: vi.fn() };
  let shown = addresses;
  let hear = (_account: Account) => {};
  function Settings() {
    const [account, setAccount] = useState<Account>({ ...EMBER, customDomain });
    const [known, setKnown] = useState(addresses);
    const [askForAccount] = useState(() => () => setAccount);
    shown = known;
    hear = setAccount;
    return (
      <AccountContext value={account}>
        <FlashProvider workspace>
          <CustomDomainSettings addresses={known} showAddresses={setKnown} askForAccount={askForAccount} {...callbacks} />
        </FlashProvider>
      </AccountContext>
    );
  }
  render(<Settings />);
  return { ...callbacks, user: userEvent.setup(), shown: () => shown, hear: (account: Account) => act(() => hear(account)) };
}

const section = () => screen.getByRole("region", { name: "Custom domain" });

/** The other addresses that reach Ember, as the section lists them. */
const otherAddresses = () => screen.queryByRole("list", { name: "Other addresses that reach Ember" });

/** Types `domain` as the domain to give Ember and sets it up, which looks its DNS up, returning the steps then shown. */
async function setUp(user: UserEvent, domain: string) {
  await user.type(screen.getByRole("textbox", { name: "Domain" }), domain);
  await user.click(screen.getByRole("button", { name: "Set up" }));
  return screen.findByRole("list", { name: /^Steps to make / });
}

/** Clicks `link`, which opens a new tab, as someone would, but goes nowhere, as jsdom can't. */
async function follow(user: UserEvent, link: HTMLElement) {
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  await user.click(link);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadPage).mockClear();
  jsdom.reconfigure({ url: "http://localhost:3000/" });
});

describe(feature("accounts.custom-domain"), () => {
  it("asks for the domain where a deploy puts Ember, then says how to add it in Cloudflare, where its DNS is", async () => {
    serve();
    const { user } = showSection(settingsAt("ember.kro.workers.dev"));
    expect(section()).toHaveTextContent(/^Custom domainEmber's address is ember\.kro\.workers\.dev\.Domain/);
    for (const name of [/^Use/, /^Go back/, "Move to another domain", "Stop using it"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Domain" });
    expect(field).toHaveAttribute("placeholder", "chat.example.com");
    expect(field).not.toHaveFocus();

    // As pasted from the address bar.
    const steps = await setUp(user, " https://Chat.Example.com/account/edit ");
    expect(lookedUp()).toEqual([{ domain: "chat.example.com" }]);
    expect(steps).toHaveAccessibleName("Steps to make chat.example.com Ember's address");
    const provider = screen.getByRole("combobox", { name: "DNS provider" });
    expect(provider).toHaveValue("cloudflare");
    expect(within(provider).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Cloudflare",
      "GoDaddy",
      "Namecheap",
      "Squarespace",
      "Porkbun",
      "Amazon Route 53",
      "Hover",
      "IONOS",
      "Another provider",
    ]);
    const [cloudflare, use] = within(steps).getAllByRole("listitem");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(2);
    expect(cloudflare).toHaveTextContent(/^Open Cloudflare, choose Add Domain, and paste chat\.example\.com\.Open Cloudflare$/);
    // The Worker's workers.dev address names it, so Cloudflare opens at its Domains tab.
    const open = within(cloudflare!).getByRole("link", { name: "Open Cloudflare" });
    expect(open).toHaveAttribute("href", "https://dash.cloudflare.com/?to=/:account/workers/services/view/ember/production/domains");
    expect(open).toHaveAttribute("target", "_blank");
    expect(use).toHaveTextContent("Everyone signs in again there.");
    expect(within(use!).getByRole("button", { name: "Use chat.example.com" })).toBeEnabled();

    // Opening Cloudflare copies the domain to paste there.
    expect(within(cloudflare!).getByRole("status")).toHaveTextContent(/^$/);
    await follow(user, open);
    expect(await navigator.clipboard.readText()).toBe("chat.example.com");
    expect(within(cloudflare!).getByRole("status")).toHaveTextContent("Copied chat.example.com.");

    // Changing the domain takes the steps away until it's set up again.
    await user.type(field, "x");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(saved()).toEqual([]);
  });

  it("keeps a port, and says why an address can't be Ember's", async () => {
    serve({ lookup: { zone: null, provider: null } });
    const { user } = showSection("http://localhost:8787/account/edit");
    expect(section()).toHaveTextContent("Ember's address is localhost:8787.");
    const field = screen.getByRole("textbox", { name: "Domain" });
    for (const [typed, refusal] of [
      ["ember.kro.workers.dev", NOT_A_CUSTOM_DOMAIN],
      ["localhost:8787", NOT_A_CUSTOM_DOMAIN],
      ["not a domain", CUSTOM_DOMAIN_NOT_A_HOST],
      ["", CUSTOM_DOMAIN_NOT_A_HOST],
    ]) {
      await user.clear(field);
      if (typed) await user.type(field, typed);
      await user.click(screen.getByRole("button", { name: "Set up" }));
      expect(screen.getByRole("alert")).toHaveTextContent(refusal!);
      expect(field).toHaveAccessibleDescription(refusal!);
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    }
    expect(lookedUp()).toEqual([]);
    await user.clear(field);
    const steps = await setUp(user, "chat.localhost:8787");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute("aria-invalid", "true");
    // DNS doesn't say where a name under localhost is, so the steps start at Cloudflare.
    expect(screen.getByRole("combobox", { name: "DNS provider" })).toHaveValue("cloudflare");
    // No workers.dev address names the Worker here, so Cloudflare opens at the list of Workers. Cloudflare takes the domain without its port.
    const [cloudflare] = within(steps).getAllByRole("listitem");
    expect(cloudflare).toHaveTextContent("Open Cloudflare, choose the Worker that runs Ember, then Domains > Add Domain, and paste chat.localhost.");
    expect(within(cloudflare!).getByRole("link", { name: "Open Cloudflare" })).toHaveAttribute("href", WORKERS_DASHBOARD);
    expect(within(steps).getByRole("button", { name: "Use chat.localhost:8787" })).toBeInTheDocument();
  });

  it("starts at the provider DNS says has the domain, saying where its nameservers change, and at any other provider chosen", async () => {
    serve({ lookup: { zone: "example.com", provider: "godaddy" } });
    const { user } = showSection(settingsAt(DEPLOYED));
    const steps = await setUp(user, "chat.example.com");
    const provider = screen.getByRole("combobox", { name: "DNS provider" });
    expect(provider).toHaveValue("godaddy");
    const [onboard, nameservers, cloudflare, use] = within(steps).getAllByRole("listitem");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(onboard).toHaveTextContent(/^Open Cloudflare, choose Onboard a domain, and paste example\.com\.Open Cloudflare$/);
    const open = within(onboard!).getByRole("link", { name: "Open Cloudflare" });
    expect(open).toHaveAttribute("href", CLOUDFLARE_DOMAINS);
    expect(nameservers).toHaveTextContent(
      "At GoDaddy, open Domain Portfolio, choose example.com, then DNS > Nameservers. Choose I'll use my own nameservers and enter Cloudflare's two nameservers.",
    );
    expect(cloudflare).toHaveTextContent(/^Once Cloudflare says example\.com is active, open Cloudflare, choose Add Domain, and paste chat\.example\.com\.Open Cloudflare$/);
    expect(within(cloudflare!).getByRole("link", { name: "Open Cloudflare" })).toHaveAttribute("href", workerDomains("ember-production"));
    expect(within(use!).getByRole("button", { name: "Use chat.example.com" })).toBeInTheDocument();
    // Onboarding takes the domain someone registered, which DNS says the name is in.
    await follow(user, open);
    expect(await navigator.clipboard.readText()).toBe("example.com");
    expect(within(onboard!).getByRole("status")).toHaveTextContent("Copied example.com.");

    for (const [chosen, said] of [
      ["namecheap", "At Namecheap, open Domain List and choose Manage beside example.com. Under Nameservers, choose Custom DNS, enter Cloudflare's two nameservers, and save with the check mark."],
      ["squarespace", "At Squarespace, open Domains, choose example.com, then DNS > Domain Nameservers > Use Custom Nameservers, and enter Cloudflare's two nameservers."],
      ["porkbun", "At Porkbun, open Domain Management, then Details beside example.com, and edit Nameservers. Replace them with Cloudflare's two."],
      ["route53", "Where you registered example.com, replace its nameservers with Cloudflare's two. If that's Route 53, open Registered domains in its console, choose example.com, then Actions > Edit name servers."],
      ["hover", "At Hover, choose example.com, then Edit beside Nameservers, and enter Cloudflare's two nameservers."],
      ["ionos", "At IONOS, choose the gear beside example.com under Actions, then Name Server > Use Custom Name Servers, and enter Cloudflare's two nameservers."],
      ["other", "Where you registered example.com, replace its nameservers with Cloudflare's two."],
    ] as const) {
      await user.selectOptions(provider, chosen);
      expect(within(steps).getAllByRole("listitem")[1]).toHaveTextContent(said);
    }
    // At Cloudflare already, only the Worker's step is left.
    await user.selectOptions(provider, "cloudflare");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(2);
    expect(within(steps).getAllByRole("listitem")[0]).toHaveTextContent(/^Open Cloudflare, choose Add Domain/);
  });

  it("names the domain above, and starts at Cloudflare, where DNS doesn't say", async () => {
    serve({ lookup: { status: 500, error: "Internal Server Error" } });
    const { user, onFailed } = showSection(settingsAt(DEPLOYED));
    const steps = await setUp(user, "chat.example.co.uk");
    const provider = screen.getByRole("combobox", { name: "DNS provider" });
    expect(provider).toHaveValue("cloudflare");
    await user.selectOptions(provider, "other");
    const [onboard, nameservers] = within(steps).getAllByRole("listitem");
    expect(onboard).toHaveTextContent("paste example.co.uk.");
    expect(nameservers).toHaveTextContent("Where you registered example.co.uk, replace its nameservers with Cloudflare's two.");
    // Failing to look it up says no more than DNS not answering.
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("says why it couldn't look a domain up when it's signed out, as the workspace's alerts do", async () => {
    serve({ lookup: { status: 401, error: "Not signed in" } });
    const { user, onFailed } = showSection(settingsAt(DEPLOYED));
    await user.type(screen.getByRole("textbox", { name: "Domain" }), "chat.example.com");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(401, "Not signed in")));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up" })).toBeEnabled();
  });

  it("shows nothing of a lookup once the domain it was for has changed", async () => {
    let answer = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise<void>((resolve) => (answer = resolve));
      return Response.json({ zone: "example.com", provider: "godaddy" } satisfies CustomDomainLookup);
    });
    const { user } = showSection(settingsAt(DEPLOYED));
    const field = screen.getByRole("textbox", { name: "Domain" });
    await user.type(field, "chat.example.com");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    expect(screen.getByRole("button", { name: "Set up" })).toBeDisabled();
    await user.type(field, "x");
    expect(screen.getByRole("button", { name: "Set up" })).toBeEnabled();
    await act(async () => {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("makes the domain Ember's address once it reaches Ember, and goes there, taking workspace settings along", async () => {
    serve();
    const { user, onSaved, shown } = showSection(settingsAt(DEPLOYED), null, { deployed: DEPLOYED, others: [] });
    const steps = await setUp(user, "chat.example.com");
    await user.click(within(steps).getByRole("button", { name: "Use chat.example.com" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(saved()).toEqual([{ customDomain: "chat.example.com" }]);
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith(settingsAt("chat.example.com")));
    expect(shown()).toEqual({ deployed: DEPLOYED, others: [] });
    // Until the page there loads, this one says what this address does now.
    expect(section()).toHaveTextContent("Ember's address is chat.example.com.");
    expect(section()).toHaveTextContent(`If chat.example.com stops working, open ${DEPLOYED}/account/edit and go back.`);
  });

  it("says why the domain can't be Ember's yet, and can be asked again", async () => {
    const refusal = "Nothing answers at chat.example.com yet. Cloudflare can take a minute to add it, so try again soon.";
    serve({ refusal: { status: 422, error: refusal } });
    const { user, onSaved, onFailed } = showSection(settingsAt(DEPLOYED), null, { deployed: DEPLOYED, others: [] });
    const steps = await setUp(user, "chat.example.com");
    const use = within(steps).getByRole("button", { name: "Use chat.example.com" });
    await user.click(use);
    await waitFor(() => expect(within(steps).getByRole("alert")).toHaveTextContent(refusal));
    expect(use).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(loadPage).not.toHaveBeenCalled();
    expect(section()).toHaveTextContent(`Ember's address is ${DEPLOYED}.`);

    await user.click(use);
    expect(saved()).toEqual([{ customDomain: "chat.example.com" }, { customDomain: "chat.example.com" }]);
  });

  it("says why using the domain failed otherwise as the workspace's alerts do", async () => {
    serve({ refusal: { status: 403, error: "Only administrators can change the workspace" } });
    const { user, onFailed } = showSection(settingsAt(DEPLOYED));
    const steps = await setUp(user, "chat.example.com");
    await user.click(within(steps).getByRole("button", { name: "Use chat.example.com" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(403, "Only administrators can change the workspace")));
    expect(within(steps).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("makes the address the page is open at Ember's", async () => {
    serve();
    const { user, onSaved, shown } = showSection(settingsAt("chat.example.com:8443"), null, { deployed: DEPLOYED, others: [] });
    expect(section()).not.toHaveTextContent("Ember's address is");
    expect(screen.queryByRole("textbox", { name: "Domain" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use chat.example.com:8443" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(saved()).toEqual([{ customDomain: "chat.example.com:8443" }]);
    expect(loadPage).not.toHaveBeenCalled();
    expect(section()).toHaveTextContent("Ember's address is chat.example.com:8443.");
    expect(screen.queryByRole("button", { name: /^Use/ })).not.toBeInTheDocument();
    expect(shown()).toEqual({ deployed: DEPLOYED, others: [] });
    expect(within(section()).getByRole("link", { name: `${DEPLOYED}/account/edit` })).toHaveAttribute("href", settingsAt(DEPLOYED));
  });

  it("goes back to where a deploy puts Ember from its custom domain, taking workspace settings along", async () => {
    serve();
    const { user, onSaved, shown } = showSection(settingsAt("chat.example.com"), "chat.example.com", { deployed: DEPLOYED, others: ["old.example.com"] });
    expect(section()).toHaveTextContent("Ember's address is chat.example.com.");
    const [old] = within(otherAddresses()!).getAllByRole("listitem");
    expect(old).toHaveTextContent(/^old\.example\.com still forwards here\.Check$/);
    expect(section()).toHaveTextContent("To turn one off, remove it from ember-production in Cloudflare.");
    expect(within(section()).getByRole("link", { name: "Open ember-production's domains" })).toHaveAttribute("href", workerDomains("ember-production"));
    expect(section()).toHaveTextContent(`If chat.example.com stops working, open ${DEPLOYED}/account/edit and go back.`);
    expect(screen.queryByRole("button", { name: /^Use/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop using it" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Go back to ${DEPLOYED}` }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(saved()).toEqual([{ customDomain: DEPLOYED }]);
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith(settingsAt(DEPLOYED)));
    expect(shown()).toEqual({ deployed: DEPLOYED, others: ["chat.example.com", "old.example.com"] });
    // Until the page there loads, this one says what this address does now, which needs no check.
    expect(section()).toHaveTextContent(`Ember's address is ${DEPLOYED}.`);
    const [here, older] = within(otherAddresses()!).getAllByRole("listitem");
    expect(here).toHaveTextContent(new RegExp(`^chat\\.example\\.com still forwards to ${DEPLOYED.replace(/\./g, "\\.")}\\.$`));
    expect(older).toHaveTextContent(`old.example.com still forwards to ${DEPLOYED}.`);
    expect(screen.getByRole("button", { name: "Use chat.example.com" })).toBeInTheDocument();
  });

  it("goes back at the address a deploy puts Ember at, staying there, and offers a domain once more", async () => {
    serve();
    const { user, shown } = showSection(settingsAt("ember.kro.workers.dev"), "chat.example.com");
    expect(section()).toHaveTextContent("Ember's address is chat.example.com.");
    expect(section()).toHaveTextContent("If chat.example.com stops working, open ember.kro.workers.dev/account/edit and go back.");
    expect(screen.queryByRole("textbox", { name: "Domain" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Use/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go back to ember.kro.workers.dev" }));
    await waitFor(() => expect(section()).toHaveTextContent("Ember's address is ember.kro.workers.dev."));
    expect(saved()).toEqual([{ customDomain: "ember.kro.workers.dev" }]);
    expect(loadPage).not.toHaveBeenCalled();
    expect(shown()).toEqual({ deployed: null, others: ["chat.example.com"] });
    expect(within(otherAddresses()!).getByRole("listitem")).toHaveTextContent("chat.example.com still forwards here.");
    expect(section()).toHaveTextContent("To turn one off, remove it from ember in Cloudflare.");
    expect(screen.getByRole("textbox", { name: "Domain" })).toBeInTheDocument();
    expect(section()).not.toHaveTextContent("stops working");
    for (const name of [/^Go back/, "Move to another domain", "Stop using it"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });

  it("checks that an address Ember moved away from still reaches it, forgetting it once it doesn't", async () => {
    const { asked, answer } = serveChecks(["ember", "nothing"]);
    const { user, shown } = showSection(settingsAt(DEPLOYED), DEPLOYED, { deployed: DEPLOYED, others: ["chat.example.com", "old.example.com"] });
    const list = otherAddresses()!;
    const status = within(section()).getAllByRole("status").at(-1)!;
    const check = within(list).getByRole("button", { name: "Check chat.example.com" });
    expect(check).toHaveTextContent(/^Check$/);

    await user.click(check);
    expect(status).toHaveTextContent("Checking chat.example.com…");
    expect(within(list).getByRole("button", { name: "Check old.example.com" })).toBeDisabled();
    answer();
    await waitFor(() => expect(status).toHaveTextContent("chat.example.com still reaches Ember."));
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    // Once it's removed in Cloudflare, nothing of Ember answers there.
    await user.click(check);
    answer();
    await waitFor(() => expect(status).toHaveTextContent("chat.example.com no longer reaches Ember."));
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringMatching(/^old\.example\.com still forwards here/)]);
    expect(shown()).toEqual({ deployed: DEPLOYED, others: ["old.example.com"] });
    expect(asked).toEqual([{ domain: "chat.example.com" }, { domain: "chat.example.com" }]);
  });

  it("says why a check failed, and can be asked again", async () => {
    const { answer } = serveChecks([], { status: 403, error: "Only administrators can change the workspace" });
    const { user, onFailed } = showSection(settingsAt(DEPLOYED), DEPLOYED, { deployed: DEPLOYED, others: ["chat.example.com"] });
    const check = screen.getByRole("button", { name: "Check chat.example.com" });
    await user.click(check);
    answer();
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(403, "Only administrators can change the workspace")));
    expect(check).toBeEnabled();
    expect(within(section()).getAllByRole("status").at(-1)).toHaveTextContent(/^$/);
  });

  it("asks for the addresses again once another tab moves Ember, which only the server can say it left", async () => {
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(`${init?.method ?? "GET"} ${String(input)}`).toBe("GET /api/account");
      return Response.json({ addresses: { deployed: DEPLOYED, others: ["chat.example.com"] } });
    });
    const { hear, shown } = showSection(settingsAt(DEPLOYED), "chat.example.com", { deployed: DEPLOYED, others: [] });
    expect(otherAddresses()).not.toBeInTheDocument();

    hear({ ...EMBER, customDomain: "team.example.com" });
    await waitFor(() => expect(otherAddresses()).toHaveTextContent("chat.example.com still forwards to team.example.com."));
    expect(shown()).toEqual({ deployed: DEPLOYED, others: ["chat.example.com"] });
    // Hearing it again asks nothing more.
    hear({ ...EMBER, customDomain: "team.example.com", name: "Campfire" });
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("makes what a check here changes to addresses it asked for, which may have been read before", async () => {
    let answerSettings = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const asked = `${init?.method ?? "GET"} ${String(input)}`;
      if (asked === "POST /api/account/custom_domain_checks") return Response.json({ reaches: "nothing" });
      expect(asked).toBe("GET /api/account");
      await new Promise<void>((resolve) => (answerSettings = resolve));
      // As read once another tab moved Ember, but before the check here forgot old.example.com.
      return Response.json({ addresses: { deployed: DEPLOYED, others: ["chat.example.com", "old.example.com"] } });
    });
    const { user, hear, shown } = showSection(settingsAt(DEPLOYED), "chat.example.com", { deployed: DEPLOYED, others: ["old.example.com"] });
    hear({ ...EMBER, customDomain: "team.example.com" });
    await user.click(screen.getByRole("button", { name: "Check old.example.com" }));
    await waitFor(() => expect(otherAddresses()).not.toBeInTheDocument());

    answerSettings();
    await waitFor(() => expect(shown()).toEqual({ deployed: DEPLOYED, others: ["chat.example.com"] }));
    expect(within(otherAddresses()!).getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringMatching(/^chat\.example\.com still forwards/)]);
  });

  it("shows only the addresses it asked for last, when Ember moves again before they come", async () => {
    const answers: (() => void)[] = [];
    const read: EmberAddresses[] = [
      { deployed: DEPLOYED, others: ["chat.example.com"] },
      { deployed: DEPLOYED, others: ["team.example.com", "chat.example.com"] },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(`${init?.method ?? "GET"} ${String(input)}`).toBe("GET /api/account");
      const addresses = read.shift();
      await new Promise<void>((resolve) => answers.push(resolve));
      return Response.json({ addresses });
    });
    const { hear, shown } = showSection(settingsAt(DEPLOYED), "chat.example.com", { deployed: DEPLOYED, others: [] });
    hear({ ...EMBER, customDomain: "team.example.com" });
    hear({ ...EMBER, customDomain: "new.example.com" });
    await waitFor(() => expect(answers).toHaveLength(2));

    answers[1]!();
    await waitFor(() => expect(shown().others).toEqual(["team.example.com", "chat.example.com"]));
    // The first answer, read before the second move, comes last.
    await act(async () => {
      answers[0]!();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(shown().others).toEqual(["team.example.com", "chat.example.com"]);
  });

  it("says so when the last address Ember moved away from is gone", async () => {
    const { answer } = serveChecks(["elsewhere"]);
    const { user } = showSection(settingsAt(DEPLOYED), DEPLOYED, { deployed: DEPLOYED, others: ["chat.example.com"] });
    await user.click(screen.getByRole("button", { name: "Check chat.example.com" }));
    answer();
    await waitFor(() => expect(within(section()).getAllByRole("status").at(-1)).toHaveTextContent("chat.example.com no longer reaches Ember."));
    expect(otherAddresses()).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open ember-production's domains" })).not.toBeInTheDocument();
  });

  it("moves to another domain from any address, with the same steps", async () => {
    serve();
    const { user } = showSection(settingsAt("chat.example.com"), "chat.example.com", { deployed: DEPLOYED, others: [] });
    expect(screen.queryByRole("textbox", { name: "Domain" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move to another domain" }));
    expect(screen.getByRole("textbox", { name: "Domain" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Move to another domain" })).not.toBeInTheDocument();

    const steps = await setUp(user, "team.example.com");
    expect(steps).toHaveAccessibleName("Steps to make team.example.com Ember's address");
    // The address a deploy puts Ember at names the Worker, wherever the page is.
    expect(within(steps).getByRole("link", { name: "Open Cloudflare" })).toHaveAttribute("href", workerDomains("ember-production"));
    expect(within(steps).getByRole("button", { name: "Use team.example.com" })).toBeInTheDocument();
  });

  it("offers another address that could be Ember's in its place, saying it still sends people on", async () => {
    serve();
    const { user, shown } = showSection(settingsAt("chat.example.com"), "ember.example.org", { deployed: DEPLOYED, others: ["chat.example.com"] });
    expect(section()).toHaveTextContent("Ember's address is ember.example.org.");
    // The page's own address needs no check: it reaches Ember, or the page couldn't ask.
    const [here] = within(otherAddresses()!).getAllByRole("listitem");
    expect(within(otherAddresses()!).getAllByRole("listitem")).toHaveLength(1);
    expect(here).toHaveTextContent(/^chat\.example\.com still forwards to ember\.example\.org\.$/);
    expect(screen.getByRole("button", { name: `Go back to ${DEPLOYED}` })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use chat.example.com" }));
    await waitFor(() => expect(section()).toHaveTextContent("Ember's address is chat.example.com."));
    expect(saved()).toEqual([{ customDomain: "chat.example.com" }]);
    expect(loadPage).not.toHaveBeenCalled();
    expect(shown()).toEqual({ deployed: DEPLOYED, others: ["ember.example.org"] });
    expect(within(otherAddresses()!).getByRole("listitem")).toHaveTextContent("ember.example.org still forwards here.");
  });

  it("goes back from an address while Ember has none of its own", async () => {
    serve();
    const { user, shown } = showSection(settingsAt("chat.example.com"), null, { deployed: DEPLOYED, others: [] });
    for (const name of ["Use chat.example.com", `Go back to ${DEPLOYED}`, "Move to another domain"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `Go back to ${DEPLOYED}` }));
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith(settingsAt(DEPLOYED)));
    expect(saved()).toEqual([{ customDomain: DEPLOYED }]);
    expect(shown()).toEqual({ deployed: DEPLOYED, others: ["chat.example.com"] });
  });

  it("stops using it until Ember knows where a deploy puts it, after which it's used wherever it's opened", async () => {
    serve();
    const { user, onSaved, shown } = showSection(settingsAt("chat.example.com"), "ember.example.org");
    expect(screen.queryByRole("button", { name: /^Go back/ })).not.toBeInTheDocument();
    expect(section()).toHaveTextContent("chat.example.com still forwards to ember.example.org.To turn one off, remove it from the Worker in Cloudflare.");
    expect(within(section()).getByRole("link", { name: "Open the Cloudflare dashboard" })).toHaveAttribute("href", WORKERS_DASHBOARD);
    expect(section()).not.toHaveTextContent("stops working");

    await user.click(screen.getByRole("button", { name: "Stop using it" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(saved()).toEqual([{ customDomain: null }]);
    expect(section()).not.toHaveTextContent("Ember's address is");
    expect(screen.getByRole("button", { name: "Use chat.example.com" })).toBeInTheDocument();
    expect(shown()).toEqual({ deployed: null, others: ["ember.example.org", "chat.example.com"] });
    expect(within(otherAddresses()!).getByRole("listitem")).toHaveTextContent("ember.example.org still reaches Ember.");
  });

  it("says why a change failed, and can be asked again", async () => {
    serve({ refusal: { status: 422, error: "Open Ember at that address to make it Ember's" } });
    const { user, onSaved, onFailed } = showSection(settingsAt("chat.example.com"));
    const use = screen.getByRole("button", { name: "Use chat.example.com" });
    await user.click(use);
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(422, "Open Ember at that address to make it Ember's")));
    expect(use).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(section()).not.toHaveTextContent("Ember's address is");
  });

  it("stays where it is when going back is refused", async () => {
    const refusal = `Ember doesn't answer at ${DEPLOYED} now, so it can't go back there.`;
    serve({ refusal: { status: 422, error: refusal } });
    const { user, onFailed, shown } = showSection(settingsAt("chat.example.com"), "chat.example.com", { deployed: DEPLOYED, others: [] });
    const back = screen.getByRole("button", { name: `Go back to ${DEPLOYED}` });
    await user.click(back);
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(422, refusal)));
    expect(back).toBeEnabled();
    expect(loadPage).not.toHaveBeenCalled();
    expect(section()).toHaveTextContent("Ember's address is chat.example.com.");
    expect(shown()).toEqual({ deployed: DEPLOYED, others: [] });
  });
});
