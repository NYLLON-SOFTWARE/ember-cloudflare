import { feature } from "@ember/parity";
import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { signInAsAdministrator, useOwnAddress } from "../../fixtures";

// The second test server answers at 127.0.0.1, which can't be a custom domain, and at chat.localhost,
// which can, as Chromium takes any name under localhost to this machine.

/** Stops Ember using a custom domain, from `page` wherever it's open, so the other specs find it at the server's own address. */
const stopUsingDomain = (page: Page) =>
  page.evaluate(() => fetch("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customDomain: null }) }));

test.describe(feature("accounts.custom-domain"), () => {
  test("the administrator gives Ember a custom domain, which pages then move to, and stops using it from the old address", async ({ page, baseURL }) => {
    const { port } = new URL(baseURL!);
    const domain = `chat.localhost:${port}`;
    await useOwnAddress(page);
    await page.goto("/account/edit");
    await signInAsAdministrator(page);
    const section = page.getByRole("region", { name: "Custom domain" });
    await expect(section).toContainText(`People open Ember at 127.0.0.1:${port}.`);

    try {
      await section.getByRole("textbox", { name: "Domain" }).fill(domain);
      await section.getByRole("button", { name: "Set up" }).click();
      await expect(section.getByRole("link", { name: "Open the Cloudflare dashboard" })).toHaveAttribute("href", "https://dash.cloudflare.com/?to=/:account/workers-and-pages");
      await expect(section.getByRole("link", { name: `https://${domain}/account/edit` })).toBeVisible();

      // Sessions belong to their address, so the administrator signs in there once more.
      const there = await page.context().newPage();
      await useOwnAddress(there);
      await there.goto(`https://${domain}/account/edit`);
      await signInAsAdministrator(there);
      const sectionThere = there.getByRole("region", { name: "Custom domain" });
      await expect(sectionThere).toContainText(`You're on ${domain}.`);
      await sectionThere.getByRole("button", { name: "Use this address" }).click();
      await expect(there.getByRole("alert")).toHaveText("Changes saved.");
      await expect(sectionThere).toContainText(`Ember's address is ${domain}.`);

      // The tab left at the old address hears of it, and says so on the pages that would move.
      await expect(section).toContainText(`Ember's address is ${domain}.`);
      await expect(section.getByRole("button", { name: "Use this address" })).toHaveCount(0);
      await page.getByRole("link", { name: "Go Back" }).click();
      await expect(page.getByRole("textbox", { name: "Write a message" })).toBeVisible();
      await expect(page.getByText(`Ember has moved to ${domain}.`)).toBeVisible();
      const room = new URL(page.url()).pathname;
      await expect(page.getByRole("link", { name: "Go there" })).toHaveAttribute("href", `https://${domain}${room}`);

      // A page opened at the old address moves to the same page at the new one.
      const opened = await page.context().newPage();
      await opened.goto(`${room}?from=bookmark`);
      await expect(opened).toHaveURL(`https://${domain}${room}?from=bookmark`);
      await expect(opened.getByRole("textbox", { name: "Write a message" })).toBeVisible();
      await expect(opened.getByText(/Ember has moved/)).toHaveCount(0);

      // Workspace settings stay at the old address, from where the administrator stops using it.
      await page.goto("/account/edit");
      await expect(section.getByRole("button", { name: "Stop using it" })).toBeVisible();
      expect(page.url()).toBe(`${baseURL}/account/edit`);
      await section.getByRole("button", { name: "Stop using it" }).click();
      await expect(section).toContainText(`People open Ember at 127.0.0.1:${port}.`);
      await expect(sectionThere).toContainText(`You're on ${domain}.`);
      await opened.goto(`${baseURL}${room}`);
      await expect(opened.getByRole("textbox", { name: "Write a message" })).toBeVisible();
      expect(opened.url()).toBe(`${baseURL}${room}`);
    } finally {
      await stopUsingDomain(page);
    }
  });
});
