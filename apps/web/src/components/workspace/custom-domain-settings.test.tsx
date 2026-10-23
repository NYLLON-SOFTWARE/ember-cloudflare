import { feature } from "@ember/parity";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_DOMAIN_NOT_A_HOST, NOT_A_CUSTOM_DOMAIN, type Account, type AccountChanges, type CustomDomainReach } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { AccountContext } from "@/hooks/use-account";
import { ApiError } from "@/lib/api";
import { CustomDomainSettings, WORKERS_DASHBOARD, workerDomains } from "./custom-domain-settings";

/** The test environment's jsdom, whose address the section reads as the page's. */
declare const jsdom: { reconfigure(options: { url: string }): void };

const EMBER: Account = { name: "Ember", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, memberfulSignIn: false };

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

/** The section in workspace settings at `url`, for a workspace whose custom domain is `customDomain`, which it changes as the app would. */
function showSection(url: string, customDomain: string | null = null) {
  jsdom.reconfigure({ url });
  const callbacks = { onSaved: vi.fn(), onFailed: vi.fn() };
  function Settings() {
    const [account, setAccount] = useState<Account>({ ...EMBER, customDomain });
    const [askForAccount] = useState(() => () => setAccount);
    return (
      <AccountContext value={account}>
        <FlashProvider workspace>
          <CustomDomainSettings askForAccount={askForAccount} {...callbacks} />
        </FlashProvider>
      </AccountContext>
    );
  }
  render(<Settings />);
  return { ...callbacks, user: userEvent.setup() };
}

const section = () => screen.getByRole("region", { name: "Custom domain" });

afterEach(() => {
  vi.restoreAllMocks();
  jsdom.reconfigure({ url: "http://localhost:3000/" });
});

describe(feature("accounts.custom-domain"), () => {
  it("asks for the domain at an address that can't be one, then says how to make it Ember's", async () => {
    serve();
    const { user } = showSection(settingsAt("ember.kro.workers.dev"));
    expect(section()).toHaveTextContent("People open Ember at ember.kro.workers.dev.");
    expect(screen.queryByRole("button", { name: "Use this address" })).not.toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Domain" });
    expect(field).toHaveAttribute("placeholder", "chat.example.com");

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
    const { user, onFailed } = showSection(settingsAt("ember-production.nyllon.workers.dev"));
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
    const { user, onSaved } = showSection(settingsAt("chat.example.com:8443"));
    expect(section()).toHaveTextContent("You're on chat.example.com:8443. Make it Ember's address, and other addresses send people here, where everyone signs in once more.");
    expect(screen.queryByRole("textbox", { name: "Domain" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use this address" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(saved()).toEqual([{ customDomain: "chat.example.com:8443" }]);
    expect(section()).toHaveTextContent("Ember's address is chat.example.com:8443. Other addresses send people there.");
    expect(screen.queryByRole("button", { name: "Use this address" })).not.toBeInTheDocument();
  });

  it("stops using it from any address, after which it's used wherever it's opened", async () => {
    serve();
    const { user, onSaved } = showSection(settingsAt("ember.kro.workers.dev"), "chat.example.com");
    expect(section()).toHaveTextContent("Ember's address is chat.example.com. Other addresses send people there.");
    expect(section()).toHaveTextContent("Workspace settings open at any of Ember's addresses, so if this one stops reaching Ember, open them at another and choose Stop using it.");
    expect(screen.queryByRole("button", { name: "Use this address" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop using it" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(saved()).toEqual([{ customDomain: null }]);
    expect(section()).toHaveTextContent("People open Ember at ember.kro.workers.dev.");
  });

  it("offers another address that could be Ember's in its place", async () => {
    serve();
    const { user } = showSection(settingsAt("chat.example.com"), "ember.example.org");
    expect(section()).toHaveTextContent("Ember's address is ember.example.org.");
    expect(section()).toHaveTextContent("You're on chat.example.com, which could be its address instead.");
    expect(screen.getByRole("button", { name: "Stop using it" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use this address" }));
    await waitFor(() => expect(section()).toHaveTextContent("Ember's address is chat.example.com."));
    expect(saved()).toEqual([{ customDomain: "chat.example.com" }]);
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
});
