import { feature } from "@ember/parity";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_DOMAIN_NOT_A_HOST, NOT_A_CUSTOM_DOMAIN, type Account, type AccountChanges } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { AccountContext } from "@/hooks/use-account";
import { ApiError } from "@/lib/api";
import { CustomDomainSettings, WORKERS_DASHBOARD } from "./custom-domain-settings";

/** The test environment's jsdom, whose address the section reads as the page's. */
declare const jsdom: { reconfigure(options: { url: string }): void };

const EMBER: Account = { name: "Ember", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null };

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
    const [cloudflare, ember] = within(steps).getAllByRole("listitem");
    expect(cloudflare).toHaveTextContent("Under Settings, Domains & Routes, choose Add, then Custom domain, and enter chat.example.com.");
    expect(within(cloudflare!).getByRole("link", { name: "Open the Cloudflare dashboard" })).toHaveAttribute("href", WORKERS_DASHBOARD);
    expect(ember).toHaveTextContent("Once Cloudflare has added it, open https://chat.example.com/account/edit, sign in, and choose Use this address.");
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
