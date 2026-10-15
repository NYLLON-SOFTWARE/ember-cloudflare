import { feature } from "@ember/parity";
import { expect, test, type Member } from "./fixtures";

const chip = (member: Member, text: string, emoji: string) =>
  member.message(text).getByRole("list", { name: "Reactions" }).getByRole("button").filter({ hasText: emoji });

test.describe(feature("boosts.add"), () => {
  test("adds a quick reaction from the toolbar for everyone to see", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const text = "Ship it?";
    await ada.send(text);

    await (await grace.actions(text)).getByRole("button", { name: "Thumbs up" }).click();
    await expect(chip(ada, text, "👍")).toHaveText("👍1");
    await expect(chip(ada, text, "👍")).toHaveAttribute("title", "Grace");
    await expect(chip(ada, text, "👍")).toHaveAttribute("aria-pressed", "false");
    await expect(chip(grace, text, "👍")).toHaveAttribute("aria-pressed", "true");
  });

  test("adds the other reactions from the tray", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const text = "Party?";
    await ada.send(text);

    await (await grace.actions(text)).getByRole("button", { name: "More reactions" }).click();
    const tray = grace.message(text).getByRole("group", { name: "More reactions" });
    await expect(tray.getByRole("button")).toHaveText(["💪Muscle", "❤️Red heart", "😂Face with tears of joy", "🎉Party popper", "🔥Fire"]);
    await tray.getByRole("button", { name: "Party popper" }).click();
    await expect(chip(ada, text, "🎉")).toHaveText("🎉1");
  });

  test("adds to someone else's reaction by clicking its chip, and counts both", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const text = "Agreed?";
    await ada.send(text);
    await (await grace.actions(text)).getByRole("button", { name: "Clapping" }).click();
    await expect(chip(ada, text, "👏")).toHaveText("👏1");

    await chip(ada, text, "👏").click();
    await expect(chip(grace, text, "👏")).toHaveText("👏2");
    await expect(chip(grace, text, "👏")).toHaveAttribute("title", "Grace, Ada");
  });
});

test.describe(feature("boosts.remove"), () => {
  test("takes back your own reaction by clicking its chip", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const text = "Hmm";
    await ada.send(text);
    await (await grace.actions(text)).getByRole("button", { name: "Waving hand" }).click();
    await expect(chip(ada, text, "👋")).toBeVisible();

    await chip(grace, text, "👋").click();
    await expect(chip(ada, text, "👋")).toHaveCount(0);
    await expect(grace.message(text).getByRole("list", { name: "Reactions" })).toHaveCount(0);
  });
});
