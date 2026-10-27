import { feature } from "@ember/parity";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_DOMAIN_NOT_A_HOST, NOT_A_CUSTOM_DOMAIN, type Account, type AccountChanges, type CustomDomainReach, type EmberAddresses } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { AccountContext } from "@/hooks/use-account";
import { ApiError } from "@/lib/api";
import { loadPage } from "@/lib/page";
import { CustomDomainSettings, DNS_ELSEWHERE, WORKERS_DASHBOARD, workerDomains } from "./custom-domain-settings";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn() }));

/** The test environment's jsdom, whose address the section reads as the page's. */
declare const jsdom: { reconfigure(options: { url: string }): void };

const EMBER: Account = { name: "Ember", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, joinLink: true, openSignUp: false, memberfulJoin: false, memberfulSignIn: false, emailDomainSignUp: false, emailDomains: [], navigationIcons: {} };

/** Where a deploy puts Ember in most of these tests, which names its Worker. */
const DEPLOYED = "ember-production.nyllon.workers.dev";

/** Where Workspace settings would be at `host`. */
const settingsAt = (host: string) => `https://${host}/account/edit`;

/** Answers saving the custom domain as the server does, with the workspace as it then is, unless `refusal` is given. */
function serve(refusal?: { status: number; error: string }) {
  let account = EMBER;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(`${init?.method} ${String(input)}`).toBe("PATCH /api/account");
    if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });
    const { customDomain } = JSON.parse(String(init?.body)) as AccountChanges;
    account = { ...account, customDomain: customDomain ?? null };
    return Response.json({ account });
  });
}

/**
 * Answers Check DNS as the server does, with what each domain reaches in turn, once `answer` lets each
 * through, or with `refusal`, and keeps the domains asked about.
 */
function serveChecks(reaches: CustomDomainReach[], refusal?: { status: number; error: string }) {
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

/** What the section asked to save, in order. */
const saved = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as unknown);

/**
 * The section in workspace settings at `url`, for a workspace whose custom domain is `customDomain`, and
 * which knows of `addresses`, both of which it changes as the app would. `shown()` says what the
 * addresses are then.
 */
function showSection(url: string, customDomain: string | null = null, addresses: EmberAddresses = { deployed: null, others: [] }) {
  jsdom.reconfigure({ url });
  const callbacks = { onSaved: vi.fn(), onFailed: vi.fn() };
  let shown = addresses;
  function Settings() {
    const [account, setAccount] = useState<Account>({ ...EMBER, customDomain });
    const [known, setKnown] = useState(addresses);
    const [askForAccount] = useState(() => () => setAccount);
    shown = known;
    return (
      <AccountContext value={account}>
        <FlashProvider workspace>
          <CustomDomainSettings addresses={known} showAddresses={setKnown} askForAccount={askForAccount} {...callbacks} />
        </FlashProvider>
      </AccountContext>
    );
  }
  render(<Settings />);
  return { ...callbacks, user: userEvent.setup(), shown: () => shown };
}

const section = () => screen.getByRole("region", { name: "Custom domain" });

/** The other addresses that reach Ember, as the section lists them. */
const otherAddresses = () => screen.queryByRole("list", { name: "Other addresses that reach Ember" });

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadPage).mockClear();
  jsdom.reconfigure({ url: "http://localhost:3000/" });
});

describe(feature("accounts.custom-domain"), () => {
  it("asks for the domain at an address that can't be one, then says how to make it Ember's", async () => {
    serve();
    const { user } = showSection(settingsAt("ember.kro.workers.dev"));
    expect(section()).toHaveTextContent("People open Ember at ember.kro.workers.dev.");
    for (const name of ["Use this address", /^Go back/, "Move to another domain", "Stop using it"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Domain" });
    expect(field).toHaveAttribute("placeholder", "chat.example.com");
    expect(field).not.toHaveFocus();

    // As pasted from the address bar.
    await user.type(field, " https://Chat.Example.com/account/edit ");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    const steps = screen.getByRole("list", { name: "Steps to make chat.example.com Ember's address" });
    const [cloudflare, check, ember] = within(steps).getAllByRole("listitem");
    // The Worker's workers.dev address names it, so the dashboard opens at its Domains tab.
    expect(cloudflare).toHaveTextContent(
      "In the Cloudflare dashboard, open the Domains tab of ember, the Worker that runs Ember. Under Custom Domains and Routes, choose Add Domain and enter chat.example.com.",
    );
    expect(within(cloudflare!).getByRole("link", { name: "Open ember's domains" })).toHaveAttribute(
      "href",
      "https://dash.cloudflare.com/?to=/:account/workers/services/view/ember/production/domains",
    );
    // Workers take only a domain whose DNS Cloudflare runs, so the step says what to do with one it doesn't.
    expect(cloudflare).toHaveTextContent(
      "If the domain's DNS is with another provider, Cloudflare offers to take it over for free, copying its records. To leave it there, follow Ember's steps for Cloudflare for SaaS instead.",
    );
    expect(within(cloudflare!).getByRole("link", { name: "Ember's steps for Cloudflare for SaaS" })).toHaveAttribute("href", DNS_ELSEWHERE);
    expect(check).toHaveTextContent("Check that chat.example.com reaches Ember.");
    expect(within(check!).getByRole("button", { name: "Check DNS" })).toBeEnabled();
    expect(ember).toHaveTextContent("Once it does, open https://chat.example.com/account/edit, sign in, and choose Use this address.");
    expect(within(ember!).getByRole("link", { name: settingsAt("chat.example.com") })).toHaveAttribute("href", settingsAt("chat.example.com"));

    // Changing the domain takes the steps away until it's set up again.
    await user.type(field, "x");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(saved()).toEqual([]);
  });

  it("keeps a port, and says why an address can't be Ember's", async () => {
    const { user } = showSection("http://localhost:8787/account/edit");
    expect(section()).toHaveTextContent("People open Ember at localhost:8787.");
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
    await user.clear(field);
    await user.type(field, "chat.localhost:8787");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("link", { name: "http://chat.localhost:8787/account/edit" })).toBeInTheDocument();
    // No workers.dev address names the Worker here, so the dashboard opens at the list of Workers.
    const [cloudflare] = screen.getAllByRole("listitem");
    expect(cloudflare).toHaveTextContent("In the Cloudflare dashboard, open Workers & Pages, choose this Worker and open its Domains tab. Under Custom Domains and Routes, choose Add Domain");
    expect(within(cloudflare!).getByRole("link", { name: "Open the Cloudflare dashboard" })).toHaveAttribute("href", WORKERS_DASHBOARD);
  });

  it("checks the domain reaches Ember, saying what answers there instead until it does", async () => {
    const { asked, answer } = serveChecks(["nothing", "elsewhere", "ember"]);
    const { user, onFailed } = showSection(settingsAt(DEPLOYED));
    await user.type(screen.getByRole("textbox", { name: "Domain" }), "chat.example.com");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    expect(screen.getByRole("link", { name: "Open ember-production's domains" })).toHaveAttribute("href", workerDomains("ember-production"));
    const check = screen.getByRole("button", { name: "Check DNS" });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/^$/);

    for (const said of [
      "Nothing answers at chat.example.com yet. Cloudflare can take a few minutes to add a domain, so check again soon.",
      "Something else answers at chat.example.com. Check that it's added to ember-production, not another.",
      "chat.example.com reaches Ember.",
    ]) {
      await user.click(check);
      expect(check).toBeDisabled();
      expect(status).toHaveTextContent("Checking chat.example.com…");
      answer();
      await waitFor(() => expect(status).toHaveTextContent(said));
      expect(check).toBeEnabled();
    }
    expect(asked).toEqual([{ domain: "chat.example.com" }, { domain: "chat.example.com" }, { domain: "chat.example.com" }]);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("says where else a domain may have gone where no workers.dev address names the Worker", async () => {
    const { answer } = serveChecks(["elsewhere"]);
    const { user } = showSection("http://localhost:8787/account/edit");
    await user.type(screen.getByRole("textbox", { name: "Domain" }), "chat.localhost:8787");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    await user.click(screen.getByRole("button", { name: "Check DNS" }));
    answer();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Something else answers at chat.localhost:8787. Check that it's added to the Worker that runs Ember, not another."),
    );
  });

  it("says why a check failed, and can be asked again", async () => {
    const { answer } = serveChecks([], { status: 403, error: "Only administrators can change the workspace" });
    const { user, onFailed } = showSection(settingsAt("ember.kro.workers.dev"));
    await user.type(screen.getByRole("textbox", { name: "Domain" }), "chat.example.com");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    const check = screen.getByRole("button", { name: "Check DNS" });
    await user.click(check);
    answer();
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(403, "Only administrators can change the workspace")));
    expect(check).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(/^$/);
  });

  it("forgets what a check found once the domain changes", async () => {
    const { answer } = serveChecks(["ember"]);
    const { user } = showSection(settingsAt("ember.kro.workers.dev"));
    const field = screen.getByRole("textbox", { name: "Domain" });
    await user.type(field, "chat.example.com");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    await user.click(screen.getByRole("button", { name: "Check DNS" }));
    answer();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("chat.example.com reaches Ember."));

    await user.clear(field);
    await user.type(field, "team.example.com");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    expect(screen.getByRole("list", { name: "Steps to make team.example.com Ember's address" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^$/);
  });

  it("makes the address the page is open at Ember's", async () => {
    serve();
    const { user, onSaved, shown } = showSection(settingsAt("chat.example.com:8443"), null, { deployed: DEPLOYED, others: [] });
    expect(section()).toHaveTextContent("You're on chat.example.com:8443. Make it Ember's address, and other addresses send people here, where everyone signs in once more.");
    expect(screen.queryByRole("textbox", { name: "Domain" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use this address" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(saved()).toEqual([{ customDomain: "chat.example.com:8443" }]);
    expect(section()).toHaveTextContent(`Ember's address is chat.example.com:8443. Other addresses, ${DEPLOYED} included, send people here.`);
    expect(screen.queryByRole("button", { name: "Use this address" })).not.toBeInTheDocument();
    expect(shown()).toEqual({ deployed: DEPLOYED, others: [] });
  });

  it("goes back to where a deploy puts Ember from its custom domain, taking workspace settings along", async () => {
    serve();
    const { user, onSaved, shown } = showSection(settingsAt("chat.example.com"), "chat.example.com", { deployed: DEPLOYED, others: ["old.example.com"] });
    expect(section()).toHaveTextContent(`Ember's address is chat.example.com. Other addresses, ${DEPLOYED} included, send people here.`);
    const [old] = within(otherAddresses()!).getAllByRole("listitem");
    expect(old).toHaveTextContent("old.example.com still reaches Ember and sends people here until it's removed from ember-production in Cloudflare.");
    expect(within(section()).getByRole("link", { name: "Open ember-production's domains" })).toHaveAttribute("href", workerDomains("ember-production"));
    expect(section()).toHaveTextContent(
      `Workspace settings open at every address that reaches Ember, so if chat.example.com stops reaching it, open them at ${DEPLOYED} and go back there.`,
    );
    expect(screen.queryByRole("button", { name: "Use this address" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop using it" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Go back to ${DEPLOYED}` }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(saved()).toEqual([{ customDomain: DEPLOYED }]);
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith(settingsAt(DEPLOYED)));
    expect(shown()).toEqual({ deployed: DEPLOYED, others: ["chat.example.com", "old.example.com"] });
    // Until the page there loads, this one says what this address does now.
    expect(section()).toHaveTextContent(`Ember's address is ${DEPLOYED}. Other addresses send people there.`);
    expect(section()).toHaveTextContent(
      "You're on chat.example.com, which still reaches Ember and sends people there. To stop it, remove it from ember-production in Cloudflare, or make it Ember's address instead.",
    );
    expect(within(otherAddresses()!).getByRole("listitem")).toHaveTextContent(`old.example.com still reaches Ember and sends people to ${DEPLOYED} until`);
  });

  it("goes back at the address a deploy puts Ember at, staying there, and offers a domain once more", async () => {
    serve();
    const { user, shown } = showSection(settingsAt("ember.kro.workers.dev"), "chat.example.com");
    expect(section()).toHaveTextContent("Ember's address is chat.example.com. Other addresses, this one included, send people there.");
    expect(screen.queryByRole("textbox", { name: "Domain" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use this address" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go back to ember.kro.workers.dev" }));
    await waitFor(() => expect(section()).toHaveTextContent("Ember's address is ember.kro.workers.dev. Other addresses send people here."));
    expect(saved()).toEqual([{ customDomain: "ember.kro.workers.dev" }]);
    expect(loadPage).not.toHaveBeenCalled();
    expect(shown()).toEqual({ deployed: null, others: ["chat.example.com"] });
    expect(within(otherAddresses()!).getByRole("listitem")).toHaveTextContent("chat.example.com still reaches Ember and sends people here until it's removed from ember in Cloudflare.");
    expect(section()).toHaveTextContent("It can have an address on a domain of yours instead.");
    expect(screen.getByRole("textbox", { name: "Domain" })).toBeInTheDocument();
    expect(section()).toHaveTextContent(
      "Workspace settings open at every address that reaches Ember, so if ember.kro.workers.dev stops reaching it, open them at another and choose Use this address.",
    );
    for (const name of [/^Go back/, "Move to another domain", "Stop using it"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });

  it("checks that an address Ember moved away from still reaches it, forgetting it once it doesn't", async () => {
    const { asked, answer } = serveChecks(["ember", "nothing"]);
    const { user, shown } = showSection(settingsAt(DEPLOYED), DEPLOYED, { deployed: DEPLOYED, others: ["chat.example.com", "old.example.com"] });
    const list = otherAddresses()!;
    const status = within(section()).getAllByRole("status").at(-1)!;
    const check = within(list).getByRole("button", { name: "Check chat.example.com" });

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
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringMatching(/^old\.example\.com still reaches Ember/)]);
    expect(shown()).toEqual({ deployed: DEPLOYED, others: ["old.example.com"] });
    expect(asked).toEqual([{ domain: "chat.example.com" }, { domain: "chat.example.com" }]);
  });

  it("forgets an address Ember moved away from once Check DNS finds it no longer reaches Ember too", async () => {
    const { answer } = serveChecks(["ember", "nothing"]);
    const { user, shown } = showSection(settingsAt(DEPLOYED), DEPLOYED, { deployed: DEPLOYED, others: ["chat.example.com", "old.example.com"] });
    await user.type(screen.getByRole("textbox", { name: "Domain" }), "chat.example.com");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    const steps = screen.getByRole("list", { name: "Steps to make chat.example.com Ember's address" });
    const check = within(steps).getByRole("button", { name: "Check DNS" });

    await user.click(check);
    answer();
    await waitFor(() => expect(within(steps).getByRole("status")).toHaveTextContent("chat.example.com reaches Ember."));
    expect(within(otherAddresses()!).getAllByRole("listitem")).toHaveLength(2);

    await user.click(check);
    answer();
    await waitFor(() => expect(within(steps).getByRole("status")).toHaveTextContent(/^Nothing answers at chat\.example\.com yet\./));
    expect(within(otherAddresses()!).getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringMatching(/^old\.example\.com still reaches Ember/)]);
    expect(shown()).toEqual({ deployed: DEPLOYED, others: ["old.example.com"] });
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
    const { user } = showSection(settingsAt("chat.example.com"), "chat.example.com", { deployed: DEPLOYED, others: [] });
    expect(screen.queryByRole("textbox", { name: "Domain" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move to another domain" }));
    const field = screen.getByRole("textbox", { name: "Domain" });
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Move to another domain" })).not.toBeInTheDocument();

    await user.type(field, "team.example.com");
    await user.click(screen.getByRole("button", { name: "Set up" }));
    const [cloudflare, , ember] = within(screen.getByRole("list", { name: "Steps to make team.example.com Ember's address" })).getAllByRole("listitem");
    // The address a deploy puts Ember at names the Worker, wherever the page is.
    expect(within(cloudflare!).getByRole("link", { name: "Open ember-production's domains" })).toHaveAttribute("href", workerDomains("ember-production"));
    expect(within(ember!).getByRole("link", { name: settingsAt("team.example.com") })).toBeInTheDocument();
  });

  it("offers another address that could be Ember's in its place, saying it still sends people on", async () => {
    serve();
    const { user, shown } = showSection(settingsAt("chat.example.com"), "ember.example.org", { deployed: DEPLOYED, others: ["chat.example.com"] });
    expect(section()).toHaveTextContent("Ember's address is ember.example.org. Other addresses send people there.");
    expect(section()).toHaveTextContent(
      "You're on chat.example.com, which still reaches Ember and sends people there. To stop it, remove it from ember-production in Cloudflare, or make it Ember's address instead.",
    );
    // The page's own address needs no check: it reaches Ember, or the page couldn't ask.
    expect(otherAddresses()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Go back to ${DEPLOYED}` })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use this address" }));
    await waitFor(() => expect(section()).toHaveTextContent("Ember's address is chat.example.com."));
    expect(saved()).toEqual([{ customDomain: "chat.example.com" }]);
    expect(shown()).toEqual({ deployed: DEPLOYED, others: ["ember.example.org"] });
    expect(within(otherAddresses()!).getByRole("listitem")).toHaveTextContent("ember.example.org still reaches Ember and sends people here");
  });

  it("goes back from an address while Ember has none of its own", async () => {
    serve();
    const { user, shown } = showSection(settingsAt("chat.example.com"), null, { deployed: DEPLOYED, others: [] });
    for (const name of ["Use this address", `Go back to ${DEPLOYED}`, "Move to another domain"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `Go back to ${DEPLOYED}` }));
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith(settingsAt(DEPLOYED)));
    expect(saved()).toEqual([{ customDomain: DEPLOYED }]);
    expect(shown()).toEqual({ deployed: DEPLOYED, others: ["chat.example.com"] });
  });

  it("stops using it until Ember knows where a deploy puts it, after which it's used wherever it's opened", async () => {
    serve();
    const { user, onSaved, shown } = showSection(settingsAt("chat.example.com"), "ember.example.org");
    expect(screen.queryByRole("button", { name: /^Go back/ })).not.toBeInTheDocument();
    expect(section()).toHaveTextContent("remove it from the Worker in Cloudflare");
    expect(within(section()).getByRole("link", { name: "Open the Cloudflare dashboard" })).toHaveAttribute("href", WORKERS_DASHBOARD);
    expect(section()).toHaveTextContent(
      "Workspace settings open at every address that reaches Ember, so if ember.example.org stops reaching it, open them at another and choose Stop using it.",
    );

    await user.click(screen.getByRole("button", { name: "Stop using it" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(saved()).toEqual([{ customDomain: null }]);
    expect(section()).toHaveTextContent("You're on chat.example.com. Make it Ember's address");
    expect(shown()).toEqual({ deployed: null, others: ["ember.example.org", "chat.example.com"] });
    expect(within(otherAddresses()!).getByRole("listitem")).toHaveTextContent("ember.example.org still reaches Ember until it's removed from the Worker in Cloudflare.");
  });

  it("says why a change failed, and can be asked again", async () => {
    serve({ status: 422, error: "Open Ember at that address to make it Ember's" });
    const { user, onSaved, onFailed } = showSection(settingsAt("chat.example.com"));
    const use = screen.getByRole("button", { name: "Use this address" });
    await user.click(use);
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(422, "Open Ember at that address to make it Ember's")));
    expect(use).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(section()).toHaveTextContent("You're on chat.example.com.");
  });

  it("stays where it is when going back is refused", async () => {
    const refusal = `Ember doesn't answer at ${DEPLOYED} now, so it can't go back there.`;
    serve({ status: 422, error: refusal });
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
