import { expect, Member, test } from "./fixtures";

/** The emoji a :code being typed lists, while it shows. */
const emojiList = (member: Member) => member.page.getByRole("listbox", { name: /^Emoji matching/ });

/** The emoji it lists, as each shows: the emoji, then its code. */
const offered = (member: Member) => emojiList(member).getByRole("option");

// After Slack's: a colon and two letters list the emoji whose codes or names have them.
test.describe("Emoji by their :codes", () => {
  test("lists the emoji a code finds as it's typed, and Up, Down, Tab and Enter pick one", async ({ members }) => {
    const ada = await members.signIn("Ada");

    await ada.composer().pressSequentially("Ship it :t");
    await expect(emojiList(ada)).toHaveCount(0);
    await ada.composer().pressSequentially("ad");
    await expect(emojiList(ada)).toHaveAccessibleName("Emoji matching :tad");
    await expect(offered(ada).first()).toHaveText("🎉:tada:");
    await ada.composer().press("Enter");
    await expect(emojiList(ada)).toHaveCount(0);

    await ada.composer().pressSequentially("and :hea");
    await expect(offered(ada).first()).toHaveText("❤️:heart:");
    await expect(offered(ada).first()).toHaveAttribute("aria-selected", "true");
    for (const key of ["ArrowDown", "ArrowDown", "ArrowUp"]) await ada.composer().press(key);
    await expect(offered(ada).nth(1)).toHaveAttribute("aria-selected", "true");
    const second = (await offered(ada).nth(1).textContent())!.match(/^\S+?(?=:)/u)![0];
    await ada.composer().press("Tab");

    await ada.composer().press("Enter");
    await expect(ada.message("Ship it")).toContainText(`Ship it 🎉 and ${second}`);
  });

  test("puts a code's emoji in its place as its closing colon's typed, but not in code", async ({ members }) => {
    const ada = await members.signIn("Ada");

    // The emoji load as the first code's typed, which someone typing waits for, as they read the list.
    await ada.composer().pressSequentially("Lunch :pizza");
    await expect(offered(ada).first()).toHaveText("🍕:pizza:");
    await ada.composer().pressSequentially(": and `:fire:` then :not_an_emoji:");
    await expect(ada.composer()).toHaveText("Lunch 🍕 and :fire: then :not_an_emoji:");
    await expect(ada.composer().locator("code")).toHaveText(":fire:");
  });

  test("puts a code's emoji in its place as a keyboard writes its closing colon without a key, as phones' do", async ({ members }) => {
    const ada = await members.signIn("Ada");

    await ada.composer().pressSequentially("Party :tada");
    await expect(offered(ada).first()).toHaveText("🎉:tada:");
    // Written as a soft keyboard writes it, with no key to say what it was.
    await ada.page.keyboard.insertText(":");
    await expect(ada.composer()).toHaveText("Party 🎉");
    await ada.composer().pressSequentially(" now");
    await expect(ada.composer()).toHaveText("Party 🎉 now");
  });

  test("opens no list for a time or a smiley, and Enter sends as it would", async ({ members }) => {
    const ada = await members.signIn("Ada");

    await ada.composer().pressSequentially("See you at 12:30 :)");
    await expect(emojiList(ada)).toHaveCount(0);
    await ada.composer().press("Enter");
    await expect(ada.message("See you at 12:30 :)")).toBeVisible();
  });

  test("shuts the list on Escape until the code's left, without closing a message's editor", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.send("Helo");
    await (await ada.actions("Helo")).getByRole("button", { name: "Edit" }).click();
    await expect(ada.editor()).toBeFocused();

    await ada.editor().press("End");
    await ada.editor().pressSequentially(" :wav");
    await expect(offered(ada).first()).toHaveText("👋:wave:");
    await ada.editor().press("Escape");
    await expect(emojiList(ada)).toHaveCount(0);
    await expect(ada.editor()).toBeVisible();
    await ada.editor().pressSequentially("e");
    await expect(emojiList(ada)).toHaveCount(0);

    await ada.editor().pressSequentially(" :wav");
    await expect(emojiList(ada)).toBeVisible();
    await ada.editor().press("Enter");
    await expect(ada.editor()).toContainText("Helo :wave 👋");
  });

  test("finds emoji for a custom reaction, which a second Enter adds", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const text = "Launched!";
    await ada.send(text);

    const bar = await grace.actions(text);
    await bar.getByRole("button", { name: "More reactions" }).click();
    await bar.getByRole("button", { name: "New boost" }).click();
    const field = grace.message(text).getByRole("textbox", { name: "Custom reaction" });
    await field.pressSequentially(":rock");
    await expect(offered(grace).first()).toHaveText("🪨:rock:");
    await expect(offered(grace).nth(1)).toHaveText("🚀:rocket:");
    await field.press("ArrowDown");
    await field.press("Enter");
    await expect(field).toHaveValue("🚀");

    await field.press("Enter");
    await expect(ada.message(text).getByRole("list", { name: "Reactions" }).getByRole("img", { name: "Grace boosted 🚀" })).toBeVisible();
  });

  test("puts people and hands in the skin tone you chose on your profile, in every tab of yours", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.send("Morning!");
    // Another tab of Ada's, in the room, as she chooses her tone in the first.
    const tab = new Member(await ada.page.context().newPage(), ada.session);
    await tab.page.goto(ada.page.url());
    await expect(tab.message("Morning!")).toBeVisible();

    await ada.page.goto("/users/me/profile");
    const tones = ada.page.getByRole("radiogroup", { name: "Skin tone" });
    await tones.getByTitle("Medium", { exact: true }).click();
    await expect(tones.getByRole("radio", { name: "Medium", exact: true })).toBeChecked();

    await tab.composer().pressSequentially("Hi :wav");
    await expect(offered(tab).first()).toHaveText("👋🏽:wave:");
    await tab.composer().pressSequentially("e: and :+1::skin-tone-2:");
    await expect(tab.composer()).toHaveText("Hi 👋🏽 and 👍🏻");
    await expect((await tab.actions("Morning!")).getByRole("button", { name: "Thumbs up" })).toHaveText("👍🏽Thumbs up");

    // It's saved with her account, so the page has it as it loads again.
    await ada.page.reload();
    await expect(ada.page.getByRole("radio", { name: "Medium", exact: true })).toBeChecked();
  });
});
