import { drawnPicture, shownPicture } from "../../fixtures";
import { expect, Member, test } from "./fixtures";

/** A name no other test's emoji has, since they all share the workspace: custom emoji are everyone's. */
const uniqueName = (name: string) => `${name}_${crypto.randomUUID().slice(0, 8)}`;

const emojiList = (member: Member) => member.page.getByRole("listbox", { name: /^Emoji matching/ });

/** An emoji's picture, wherever it shows in place of its code. */
const picture = (within: Member["page"] | ReturnType<Member["message"]>, name: string) => within.getByRole("img", { name: `:${name}:`, exact: true });

/** Adds an emoji named `name` on the Custom emoji page, from a picture larger than an emoji's. */
async function addEmoji(member: Member, name: string): Promise<void> {
  await member.page.goto("/account/emoji");
  const form = member.page.getByRole("form", { name: "Add custom emoji" });
  await form.getByLabel(/Choose an(other)? image/).setInputFiles(await drawnPicture(member.page, "Ship It.png", 600, 400));
  await expect(form.getByLabel("Preview")).toBeVisible();
  // The file's name suggests one.
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("ship_it");
  await form.getByRole("textbox", { name: "Name" }).fill(name);
  await form.getByRole("button", { name: "Add emoji" }).click();
  await expect(member.page.getByRole("listitem").filter({ hasText: `:${name}:` })).toBeVisible();
}

// After Slack's: anyone adds an emoji, a picture and a name, and everyone types it by its :name:.
test.describe("Custom emoji", () => {
  test("adds an emoji anyone can then type by its name, which shows as its picture in everyone's messages", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const name = uniqueName("shipit");

    await addEmoji(ada, name);
    await expect(ada.page.getByRole("listitem").filter({ hasText: `:${name}:` })).toContainText("Added by Ada");

    // Grace's tab heard of it, so a code finds it by its name, with its picture.
    await grace.composer().pressSequentially(`Time to :${name.slice(0, 12)}`);
    const offered = emojiList(grace).getByRole("option", { name: `:${name}:`, exact: true });
    await expect(offered).toBeVisible();
    // Its picture is beside its code, which names the option.
    await expect(offered.locator("img")).toBeVisible();
    await offered.click();
    await expect(grace.composer()).toHaveText(`Time to :${name}:`);
    await grace.composer().press("Enter");

    await expect(picture(grace.message("Time to"), name)).toBeVisible();
    // Scaled to an emoji's size before it was sent.
    expect(await shownPicture(picture(grace.message("Time to"), name))).toEqual({ type: "image/png", width: 128, height: 85 });

    await ada.page.goto(`/rooms/${rooms.general.id}`);
    await expect(picture(ada.message("Time to"), name)).toBeVisible();
    // The message keeps the code, which is what copying it copies.
    await expect(picture(ada.message("Time to"), name)).toHaveAttribute("title", `:${name}:`);
  });

  test("types a code's closing colon as it is, shows a message of only custom emoji large, and leaves code alone", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    const name = uniqueName("parrot");
    await addEmoji(ada, name);
    await ada.page.goto(`/rooms/${rooms.general.id}`);
    await ada.connected();

    await ada.composer().pressSequentially(`:${name}:`);
    await expect(ada.composer()).toHaveText(`:${name}:`);
    await ada.composer().press("Enter");
    const alone = ada.page.getByRole("article").filter({ has: picture(ada.page, name) });
    await expect(alone.locator(".message-content")).toHaveClass(/text-\[2\.4em\]/);

    // Typed, as backticks make code as they're typed.
    await ada.composer().pressSequentially(`Run \`:${name}:\` first`);
    await ada.composer().press("Enter");
    await expect(ada.message("Run").locator("code")).toHaveText(`:${name}:`);
    await expect(picture(ada.message("Run"), name)).toHaveCount(0);
  });

  test("reacts with a custom emoji, and shows its code once the emoji's removed", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const name = uniqueName("thisisfine_and_long");
    await addEmoji(ada, name);
    await ada.page.goto(`/rooms/${rooms.general.id}`);
    await ada.send("Launched!");

    const bar = await grace.actions("Launched!");
    await bar.getByRole("button", { name: "More reactions" }).click();
    await bar.getByRole("button", { name: "New boost" }).click();
    const field = grace.message("Launched!").getByRole("textbox", { name: "Custom reaction" });
    await field.pressSequentially(`:${name.slice(0, 16)}`);
    await expect(emojiList(grace).getByRole("option").first()).toHaveAccessibleName(`:${name}:`);
    await field.press("Enter");
    // Longer than a reaction's 16 characters, as a custom emoji's code may be.
    await expect(field).toHaveValue(`:${name}:`);
    await field.press("Enter");

    const reactions = ada.message("Launched!").getByRole("list", { name: "Reactions" });
    await expect(picture(reactions, name)).toBeVisible();

    // Ada added it, so she can remove it, and it's gone from everyone's app at once.
    await ada.page.goto("/account/emoji");
    ada.page.once("dialog", (dialog) => void dialog.accept());
    await ada.page.getByRole("button", { name: `Remove :${name}:` }).click();
    await expect(ada.page.getByRole("listitem").filter({ hasText: `:${name}:` })).toHaveCount(0);

    const graces = grace.message("Launched!").getByRole("list", { name: "Reactions" });
    await expect(graces).toContainText(`:${name}:`);
    await expect(picture(graces, name)).toHaveCount(0);
  });

  test("lets only whoever added an emoji, or an administrator, remove it, and refuses a name that's taken", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const linus = await members.signIn("Linus", { administrator: true });
    const name = uniqueName("mine");
    await addEmoji(ada, name);

    // Anyone finds the page among community settings, and sees everyone's emoji there.
    await grace.page.goto("/account/edit");
    await grace.page.getByRole("navigation", { name: "Community settings" }).getByRole("link", { name: "Custom emoji" }).click();
    await expect(grace.page.getByRole("heading", { level: 1, name: "Custom emoji" })).toBeVisible();
    await expect(grace.page.getByRole("listitem").filter({ hasText: `:${name}:` })).toBeVisible();
    await expect(grace.page.getByRole("button", { name: `Remove :${name}:` })).toHaveCount(0);

    const form = grace.page.getByRole("form", { name: "Add custom emoji" });
    await form.getByLabel(/Choose an(other)? image/).setInputFiles(await drawnPicture(grace.page, "copy.png", 64, 64));
    await form.getByRole("textbox", { name: "Name" }).fill(name);
    await expect(form.getByRole("alert")).toHaveText("That name is already taken by another custom emoji.");
    await expect(form.getByRole("button", { name: "Add emoji" })).toBeDisabled();
    await form.getByRole("textbox", { name: "Name" }).fill("tada");
    await expect(form.getByRole("alert")).toHaveText("That name is already taken by one of the standard emoji.");

    await linus.page.goto("/account/emoji");
    linus.page.once("dialog", (dialog) => void dialog.accept());
    await linus.page.getByRole("button", { name: `Remove :${name}:` }).click();
    await expect(linus.page.getByRole("listitem").filter({ hasText: `:${name}:` })).toHaveCount(0);
    await expect(grace.page.getByRole("listitem").filter({ hasText: `:${name}:` })).toHaveCount(0);
  });
});
