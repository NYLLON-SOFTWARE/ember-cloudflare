import { expect, test, unique, type Member } from "./fixtures";

const desktop = { viewport: { width: 1280, height: 800 } };

/** Schedules `text` in the room shown, for tomorrow, from the composer's Schedule for later. */
async function schedule(member: Member, text: string) {
  await member.composer().fill(text);
  await member.page.getByRole("button", { name: "Schedule for later" }).click();
  await member.page.getByRole("menuitem", { name: /^Tomorrow at/ }).click();
  await expect(member.page.getByText("1 scheduled message", { exact: false })).toBeVisible();
}

test.describe("Drafts & sent › Scheduled", () => {
  test("deletes one with Undo and sends one now from its row's actions, shown on hover, in a room that isn't open", async ({ members, rooms }) => {
    const ada = await members.signIn(unique("Ada"), { context: desktop });
    await schedule(ada, "lunch at noon?");
    await ada.page.goto("/drafts/scheduled");
    const row = ada.page.getByRole("listitem").filter({ hasText: "lunch at noon?" });
    await expect(row).toBeVisible();

    const remove = row.getByRole("button", { name: "Delete" });
    const actions = remove.locator("xpath=..");
    await expect(actions).toHaveCSS("opacity", "0");
    await row.hover();
    await expect(actions).toHaveCSS("opacity", "1");
    for (const name of ["Edit time", "Send now", "Delete"]) expect((await row.getByRole("button", { name }).boundingBox())?.height).toBe(32);

    await remove.click();
    await expect(ada.page.getByText("Scheduled message deleted")).toBeVisible();
    await ada.page.getByRole("button", { name: "Undo" }).click();
    await expect(row).toBeVisible();
    // Undo scheduled it again, as the server's list says too.
    await ada.page.reload();
    await expect(row).toBeVisible();

    await row.hover();
    await row.getByRole("button", { name: "Send now" }).click();
    await expect(row).toHaveCount(0);
    await expect(ada.page.getByRole("heading", { name: "Nothing scheduled" })).toBeVisible();
    await ada.page.goto(`/rooms/${rooms.general.id}`);
    await expect(ada.message("lunch at noon?")).toBeVisible();
  });
});
