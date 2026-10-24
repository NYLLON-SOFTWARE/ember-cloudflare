import { feature } from "@ember/parity";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** A word in no other test's messages or searches, since every test shares the server and its open rooms. */
const uniqueWord = (word: string) => `${word}${crypto.randomUUID().slice(0, 8)}`;

const field = (page: Page) => page.getByRole("searchbox", { name: "search" });
const results = (page: Page) => page.getByRole("region", { name: "Search results" });
const recentSearches = (page: Page) => page.getByRole("group", { name: "Recent searches" });

/** Searches for `query` from the search page's field, as you type it. */
async function search(page: Page, query: string) {
  await field(page).fill(query);
  await field(page).press("Enter");
  await expect(page).toHaveURL(`/searches?q=${encodeURIComponent(query).replaceAll("%20", "+")}`);
}

/** Searches for `query` until `found` shows, since a message can be found only a moment after it's sent. */
async function searchUntil(page: Page, query: string, found: Locator) {
  await expect(async () => {
    await search(page, query);
    await expect(found).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

test.describe(feature("search.messages"), () => {
  test("finds messages from the rail's Search, oldest first and the newest in view, each linking to the message from its room's name", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    const word = uniqueWord("zebra");
    for (const text of [`First ${word}`, `Second ${word}`]) {
      await ada.send(text);
      await expect(ada.message(text)).not.toHaveAttribute("aria-busy");
    }

    await ada.page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Search", exact: true }).click();
    await expect(ada.page).toHaveURL("/searches");
    await expect(ada.page.getByRole("heading", { name: "Find a conversation" })).toBeVisible();
    await expect(field(ada.page)).toBeFocused();
    await expect(ada.page).toHaveTitle("Search");

    const found = results(ada.page).getByRole("article");
    await searchUntil(ada.page, word, found.nth(1));
    await expect(found).toHaveText([new RegExp(`First ${word}`), new RegExp(`Second ${word}`)]);
    await expect(ada.page.getByRole("navigation", { name: "Page" })).toContainText(`“${word}”2`);
    await expect(found.last()).toBeInViewport();
    // Results can't be changed here: hovering shows no actions.
    await found.first().hover();
    await expect(ada.page.getByRole("group", { name: "Message actions" })).toBeHidden();

    await found.first().getByRole("link", { name: rooms.general.name, exact: true }).click();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}/@`));
    await expect(ada.message(`First ${word}`)).toBeInViewport();
  });

  test("searches the words in what's typed, as its address says", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const [one, two] = [uniqueWord("analytical"), uniqueWord("engine")];
    await ada.send(`The ${one} ${two}`);
    await ada.page.goto("/searches");
    const found = results(ada.page).getByRole("article");
    // Punctuation turns to spaces, as ember-rust's search does, and the address keeps them.
    await expect(async () => {
      await field(ada.page).fill(`${two}, ${one}!`);
      await field(ada.page).press("Enter");
      await expect(ada.page).toHaveURL(`/searches?q=${two}++${one}+`);
      await expect(found).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(found).toContainText(`The ${one} ${two}`);
    await expect(field(ada.page)).toHaveValue(`${two}  ${one} `);

    // The address alone shows the search again, as a link or a reload does.
    await ada.page.reload();
    await expect(found).toContainText(`The ${one} ${two}`);
  });
});

test.describe(feature("search.page"), () => {
  test("opens from a room's header, clears the field with its × or Escape, and goes back to the room on Exit", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    await ada.page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "Search messages" }).click();
    await expect(ada.page).toHaveURL("/searches");
    const clear = ada.page.getByRole("button", { name: "Clear search field" });
    // As Campfire's, the × shows only once something's written.
    await expect(clear).toBeHidden();
    const nothing = uniqueWord("nothing");
    await field(ada.page).fill(nothing);
    await expect(clear).toBeVisible();
    await field(ada.page).press("Enter");
    await expect(ada.page.getByRole("heading", { name: "No messages found" })).toBeVisible();
    await expect(ada.page.getByRole("navigation", { name: "Page" })).toContainText(`“${nothing}”0`);

    await clear.click();
    await expect(ada.page).toHaveURL("/searches");
    await expect(ada.page.getByRole("heading", { name: "Find a conversation" })).toBeVisible();
    await expect(field(ada.page)).toHaveValue("");
    await expect(field(ada.page)).toBeFocused();

    await search(ada.page, nothing);
    await field(ada.page).press("Escape");
    await expect(ada.page).toHaveURL("/searches");
    await expect(field(ada.page)).toHaveValue("");

    await ada.page.getByRole("link", { name: "Exit search" }).click();
    await expect(ada.page).toHaveURL(`/rooms/${rooms.general.id}`);
    await ada.connected();
  });

});

test.describe(feature("search.recent"), () => {
  test("keeps your own recent searches, newest first, to search again, until you clear them", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.page.goto("/searches");
    await expect(recentSearches(ada.page)).toBeHidden();
    const [eel, newt] = [uniqueWord("eel"), uniqueWord("newt")];
    await search(ada.page, eel);
    await search(ada.page, newt);
    const recent = recentSearches(ada.page).getByRole("link");
    await expect(recent).toHaveText([`“${newt}”`, `“${eel}”`]);

    // Following one searches again without moving it, as the Worker says once the page is loaded again;
    // searching for it from the field does.
    await recent.last().click();
    await expect(ada.page).toHaveURL(`/searches?q=${eel}`);
    await expect(field(ada.page)).toHaveValue(eel);
    await ada.page.reload();
    await expect(recent).toHaveText([`“${newt}”`, `“${eel}”`]);
    await field(ada.page).press("Enter");
    await expect(recent).toHaveText([`“${eel}”`, `“${newt}”`]);
    await ada.page.reload();
    await expect(recent).toHaveText([`“${eel}”`, `“${newt}”`]);

    const grace = await members.signIn("Grace");
    await grace.page.goto("/searches");
    await expect(grace.page.getByRole("heading", { name: "Find a conversation" })).toBeVisible();
    await expect(recentSearches(grace.page)).toBeHidden();

    const clear = recentSearches(ada.page).getByRole("button", { name: "Clear recent searches" });
    ada.page.once("dialog", (dialog) => void dialog.dismiss());
    await clear.click();
    await expect(recent).toHaveCount(2);
    const asked = new Promise<string>((resolve) =>
      ada.page.once("dialog", (dialog) => {
        resolve(dialog.message());
        void dialog.accept();
      }),
    );
    await clear.click();
    expect(await asked).toBe("Are you sure you want to clear your recent searches?");
    await expect(ada.page).toHaveURL("/searches");
    await expect(recentSearches(ada.page)).toBeHidden();
    await ada.page.reload();
    await expect(ada.page.getByRole("heading", { name: "Find a conversation" })).toBeVisible();
    await expect(recentSearches(ada.page)).toBeHidden();
  });
});
