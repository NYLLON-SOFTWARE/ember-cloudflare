import type { Locator } from "@playwright/test";
import { openRoom, signInAs } from "../../fixtures";
import { expect, test } from "./fixtures";

/** A word in no other test's messages or searches, since every test shares the server and its open rooms. */
const uniqueWord = (word: string) => `${word}${crypto.randomUUID().slice(0, 8)}`;

const middleOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Not visible");
  return box.y + box.height / 2;
};

test.beforeEach(async ({ page, session }) => {
  await signInAs(page, session);
});

test("the search page fits the phone, with recent searches, a long result and its room, and the field beside Exit", async ({ page, room, participant, screenIsFine }) => {
  const ada = await participant("Ada");
  const word = uniqueWord("zebra");
  await ada.say(`The ${word} at https://example.com/${"analytical-engine-".repeat(8)} ran on and on through the whole afternoon`);
  await openRoom(page, room);

  // A phone has Search in the room's top bar, since the rail is in the drawer.
  await page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "Search messages" }).tap();
  await expect(page.getByRole("heading", { name: "Find a conversation" })).toBeVisible();
  await screenIsFine();

  const field = page.getByRole("searchbox", { name: "search" });
  for (const query of [uniqueWord("difference engine"), uniqueWord("bernoulli"), uniqueWord("jacquard loom")]) {
    await field.fill(query);
    await field.press("Enter");
    // The page goes to a search's address once it has answered. Until then the field's button is
    // disabled, so Enter there does nothing.
    await expect(page).toHaveURL(`/searches?q=${encodeURIComponent(query).replaceAll("%20", "+")}`);
    await expect(page.getByRole("heading", { name: "No messages found" })).toBeVisible();
  }
  const found = page.getByRole("region", { name: "Search results" }).getByRole("article");
  await expect(async () => {
    await field.fill(word);
    await field.press("Enter");
    await expect(found).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(found.getByRole("link", { name: room.name, exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Recent searches" }).getByRole("link")).toHaveCount(4);
  await screenIsFine();

  // Exit and the field are centred on one line.
  const exit = page.getByRole("link", { name: "Exit search" });
  expect(Math.abs((await middleOf(exit)) - (await middleOf(field.locator(".."))))).toBeLessThanOrEqual(1);
});
