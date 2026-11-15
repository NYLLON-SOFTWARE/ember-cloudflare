import { invitation } from "../../fixtures";
import { expect, hasPhoneLayout, test } from "./fixtures";

test("the join screen fits the phone", async ({ page, request, session, screenIsFine }) => {
  await page.goto(`/join/${(await invitation(request, session)).joinCode}`);
  await expect(page.getByRole("heading", { name: "Join Ember" })).toBeVisible();
  await screenIsFine();
});

test("you can join with taps", async ({ page, request, session }) => {
  await page.goto(`/join/${(await invitation(request, session)).joinCode}`);
  await page.getByLabel("Name").tap();
  await page.keyboard.type("Pat on a phone");
  await page.getByLabel("Email address").tap();
  await page.keyboard.type(`pat-${crypto.randomUUID()}@example.com`);
  await page.getByLabel("Password").tap();
  await page.keyboard.type("tapped in");
  await page.getByRole("button", { name: "Create account" }).tap();
  // In, at the room home goes to, or on a phone, Home's list.
  await expect(hasPhoneLayout(page) ? page.getByRole("list", { name: "Shortcuts" }) : page.getByRole("textbox", { name: "Write a message" })).toBeVisible();
});
