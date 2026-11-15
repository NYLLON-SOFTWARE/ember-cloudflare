import { expect, test, unique } from "./fixtures";

test.describe("Preferences › Notifications", () => {
  test("changes what you're notified about everywhere you haven't picked a level, pauses notifications, and opens from your profile", async ({ members, rooms }) => {
    const ada = await members.signIn(unique("Ada"), { context: { viewport: { width: 1280, height: 800 } } });
    await ada.page.goto("/users/me/profile");
    await ada.page.getByRole("link", { name: "Notifications" }).click();
    await expect(ada.page).toHaveURL(/\/users\/me\/notifications$/);

    const general = ada.page.getByRole("combobox", { name: `Notifications for ${rooms.general.name}` });
    await expect(general).toHaveValue("default");
    await ada.page.getByRole("radio", { name: "Nothing" }).check();
    await expect(general.locator("option").first()).toHaveText("Default (Nothing)");
    await ada.page.reload();
    await expect(ada.page.getByRole("radio", { name: "Nothing" })).toBeChecked();

    await ada.page.getByRole("combobox", { name: `Notifications for ${rooms.random.name}` }).selectOption("everything");
    await expect(ada.page.getByRole("button", { name: "Reset all" })).toBeVisible();

    await ada.page.getByRole("button", { name: "Pause" }).click();
    await ada.page.getByRole("menuitem", { name: "1 hour" }).click();
    await expect(ada.page.getByRole("status").filter({ hasText: "Paused until" })).toBeVisible();
    await ada.page.screenshot({ path: test.info().outputPath("notifications-desktop.png") });
    await ada.page.reload();
    await expect(ada.page.getByRole("status").filter({ hasText: "Paused until" })).toBeVisible();
  });

  test("shows full screen on a phone, each row its level's picker, leaving room names their width at 320px", async ({ members, rooms }) => {
    const ada = await members.signIn(unique("Ada"), { context: { viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true } });
    await ada.page.goto("/users/me/notifications");
    await expect(ada.page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    await expect(ada.page.getByRole("group", { name: "Notify me about" })).toBeVisible();
    const picker = ada.page.getByRole("combobox", { name: `Notifications for ${rooms.general.name}` });
    const row = ada.page.locator("li").filter({ has: picker });
    const [pickerBox, rowBox] = [await picker.boundingBox(), await row.boundingBox()];
    // The picker covers the whole row, and the level at its end leaves the name most of it.
    // (all but the row's 1px rule under it)
    expect({ ...pickerBox!, height: pickerBox!.height + 1 }).toEqual(rowBox);
    expect((await row.getByText(rooms.general.name, { exact: true }).boundingBox())!.width).toBeGreaterThan(150);
    await ada.page.screenshot({ path: test.info().outputPath("notifications-phone.png") });
  });
});
