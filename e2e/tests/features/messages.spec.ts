import { feature } from "@ember/parity";
import type { Locator } from "@playwright/test";
import { administratorOn, editorField, ROOM_SOCKET } from "../../fixtures";
import { expect, test } from "./fixtures";

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Not visible");
  return rect;
};

test.describe(feature("messages.create"), () => {
  test("delivers a message to everyone in the room as it's sent", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");

    await ada.send("Hello, Grace");
    await expect(ada.composer()).toHaveText("");
    await expect(grace.message("Hello, Grace")).toContainText("Ada");
    await expect(ada.message("Hello, Grace")).toBeVisible();
  });

  test("keeps messages for people who come in later", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.send("For whoever's next");
    await expect(ada.message("For whoever's next")).not.toHaveAttribute("aria-busy");

    const grace = await members.signIn("Grace");
    await expect(grace.message("For whoever's next")).toBeVisible();
  });
});

test.describe(feature("messages.optimistic"), () => {
  test("shows your message straight away and settles it when the room confirms", async ({ members }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const ada = await members.signIn("Ada", {
      // Hold the room's confirmation back until the test has looked at the unconfirmed message.
      beforeOpen: (page) =>
        page.routeWebSocket(ROOM_SOCKET, (ws) => {
          const server = ws.connectToServer();
          server.onMessage(async (frame) => {
            if (String(frame).includes('"message.created"')) await held;
            ws.send(frame);
          });
        }),
    });
    await ada.send("Sending…");
    await expect(ada.message("Sending…")).toHaveAttribute("aria-busy", "true");

    release();
    await expect(ada.message("Sending…")).not.toHaveAttribute("aria-busy");
  });

  test("says when the room refuses a message", async ({ members }) => {
    const ada = await members.signIn("Ada", {
      beforeOpen: (page) =>
        page.routeWebSocket(ROOM_SOCKET, (ws) => {
          const server = ws.connectToServer();
          ws.onMessage((frame) => {
            const parsed = JSON.parse(String(frame)) as { type: string; clientMessageId?: string };
            if (parsed.type !== "message.create") return server.send(frame);
            ws.send(JSON.stringify({ type: "error", message: "Something went wrong", clientMessageId: parsed.clientMessageId }));
          });
        }),
    });
    await ada.send("Doomed");
    await expect(ada.message("Doomed")).toContainText("Not sent");
    await expect(ada.page.getByRole("alert")).toContainText("Something went wrong");
    await ada.page.getByRole("alert").getByRole("button", { name: "Dismiss" }).click();
    await expect(ada.page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe(feature("messages.layout"), () => {
  test("lines every message up the same way, your own included", async ({ members, participant }) => {
    await (await participant("Grace")).say("From Grace");
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    await ada.send("From Ada");
    await expect(ada.message("From Ada")).not.toHaveAttribute("aria-busy");
    const log = await box(ada.page.getByRole("log"));

    for (const [text, author] of [
      ["From Grace", "Grace"],
      ["From Ada", "Ada"],
    ] as const) {
      const row = ada.message(text);
      const avatar = await box(row.locator("[aria-hidden=true]").first());
      expect(avatar.width).toBe(36);
      expect(avatar.height).toBe(36);
      expect(avatar.x - log.x).toBe(20);
      await expect(row.locator("[aria-hidden=true]").first()).toHaveCSS("border-radius", "6px");

      const name = row.getByText(author, { exact: true });
      expect((await box(name)).x - (avatar.x + avatar.width)).toBe(8);
      await expect(name).toHaveCSS("font-size", "15px");
      await expect(name).toHaveCSS("font-weight", "700");
      await expect(row.locator("time")).toHaveCSS("font-size", "12px");
      const body = row.getByText(text, { exact: true });
      await expect(body).toHaveCSS("font-size", "15px");
      await expect(body).toHaveCSS("line-height", "22px");
    }
  });

  test("tints the row under the pointer without moving anything, in light and dark", async ({ members, participant }) => {
    await (await participant("Grace")).say("Point at me");
    for (const [colorScheme, tint] of [
      ["light", "rgb(248, 248, 248)"],
      ["dark", "rgb(32, 32, 32)"],
    ] as const) {
      const ada = await members.signIn("Ada", { context: { colorScheme } });
      const row = ada.message("Point at me");
      const body = row.getByText("Point at me", { exact: true });
      const before = await box(body);
      await expect(row).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

      await row.hover();
      await expect(row, colorScheme).toHaveCSS("background-color", tint);
      expect(await box(body)).toEqual(before);
    }
  });

  test("uses a smaller avatar on phones and wraps long words", async ({ members, participant }) => {
    const long = "x".repeat(300);
    await (await participant("Grace")).say(long);
    const ada = await members.signIn("Ada", { context: phone });
    const row = ada.message(long);
    const avatar = await box(row.locator("[aria-hidden=true]").first());
    expect(avatar.width).toBe(30);
    expect(avatar.x).toBe(12);
    expect((await box(row.getByText("Grace", { exact: true }))).x - (avatar.x + avatar.width)).toBe(10);

    const text = await box(row.getByText(long, { exact: true }));
    expect(text.x + text.width).toBeLessThanOrEqual(390);
    expect(await ada.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe(feature("messages.rich-text"), () => {
  test("shows each line of a message on a line of its own", async ({ members, participant }) => {
    await (await participant("Grace")).say("First line\nSecond line");
    const ada = await members.signIn("Ada");
    const paragraph = ada.message("First line").locator(".message-content p");
    await expect(paragraph).toHaveCount(1);
    expect(await paragraph.evaluate((p) => (p as HTMLElement).innerText)).toBe("First line\nSecond line");
    expect((await box(paragraph)).height).toBe(44);
  });
});

test.describe(feature("messages.autolink"), () => {
  test("links addresses, opening other sites in a new tab and this site's pages in place", async ({ members, rooms, baseURL }) => {
    const ada = await members.signIn("Ada");
    const random = `${baseURL}/rooms/${rooms.random.id}`;
    await ada.send(`Read https://example.com/docs, then ${random}`);
    const message = ada.message("Read https://example.com/docs");
    const external = message.getByRole("link", { name: "https://example.com/docs" });
    await expect(external).toHaveAttribute("href", "https://example.com/docs");
    await expect(external).toHaveAttribute("target", "_blank");
    await expect(external).toHaveCSS("text-decoration-line", "underline");

    // A page load would forget this.
    await ada.page.evaluate(() => Object.assign(window, { stayed: true }));
    await message.getByRole("link", { name: random }).click();
    await expect(ada.page).toHaveURL(random);
    await expect(ada.page.getByRole("log", { name: `Messages in ${rooms.random.name}` })).toBeVisible();
    expect(await ada.page.evaluate(() => "stayed" in window)).toBe(true);
  });
});

test.describe(feature("messages.emoji-only"), () => {
  test("shows a message of nothing but emoji large", async ({ members, participant }) => {
    const grace = await participant("Grace");
    await grace.say("😄🤘");
    await grace.say("Haha! 😄🤘");
    const ada = await members.signIn("Ada");
    const content = (text: RegExp) => ada.page.locator(".message-content").filter({ hasText: text });
    await expect(content(/^😄🤘$/)).toHaveCSS("font-size", "33.6px");
    await expect(content(/^Haha! 😄🤘$/)).toHaveCSS("font-size", "15px");
  });
});

test.describe(feature("messages.follow-up-times"), () => {
  test("shows a follow-up's time only on hover or focus, and always shows the first message's", async ({ members, participant }) => {
    const grace = await participant("Grace");
    await grace.say("First");
    const followUp = await grace.say("Follow-up");
    await grace.boost(followUp.id, "👍");
    const ada = await members.signIn("Ada");

    // The time's wrapper fades it in, so check what it shows rather than whether it's in the page.
    const shown = (text: string) => ada.message(text).locator("time").locator("..");
    await expect(shown("First")).toHaveCSS("opacity", "1");
    await expect(shown("Follow-up")).toHaveCSS("opacity", "0");

    const body = ada.message("Follow-up").getByText("Follow-up", { exact: true });
    const before = await box(body);
    await ada.message("Follow-up").hover();
    await expect(shown("Follow-up")).toHaveCSS("opacity", "1");
    expect(await box(body)).toEqual(before);

    await ada.composer().hover();
    await expect(shown("Follow-up")).toHaveCSS("opacity", "0");
    await ada.message("Follow-up").getByRole("list", { name: "Reactions" }).getByRole("button").focus();
    await expect(shown("Follow-up")).toHaveCSS("opacity", "1");
  });
});

test.describe(feature("messages.actions"), () => {
  test("shows a message's bar while it's hovered, one message at a time", async ({ members, participant }) => {
    await (await participant("Grace")).say("Grace's message");
    const ada = await members.signIn("Ada");
    await ada.send("Ada's message");
    await expect(ada.message("Ada's message")).not.toHaveAttribute("aria-busy");
    const bar = (text: string) => ada.message(text).getByRole("group", { name: "Message actions" });
    await expect(bar("Grace's message")).toBeHidden();

    await ada.message("Grace's message").hover();
    await expect(bar("Grace's message").getByRole("button")).toHaveCount(4);
    for (const [i, name] of ["Thumbs up", "Clapping", "Waving hand", "More reactions"].entries()) {
      await expect(bar("Grace's message").getByRole("button").nth(i)).toHaveAccessibleName(name);
    }

    await ada.message("Ada's message").hover();
    await expect(bar("Grace's message")).toBeHidden();
    await expect(bar("Ada's message")).toBeVisible();
    await expect(bar("Ada's message").getByRole("button", { name: "Edit" })).toBeVisible();

    await ada.composer().hover();
    await expect(bar("Ada's message")).toBeHidden();
  });

  test("lets the keyboard reach the bar through Message options", async ({ members, participant }) => {
    await (await participant("Grace")).say("Reach me by keyboard");
    const ada = await members.signIn("Ada");
    const message = ada.message("Reach me by keyboard");
    const bar = message.getByRole("group", { name: "Message actions" });

    await ada.composer().focus();
    await ada.page.keyboard.press("Shift+Tab");
    await expect(message.getByRole("button", { name: "Message options" })).toBeFocused();
    await expect(bar).toBeVisible();
    await ada.page.keyboard.press("Tab");
    await expect(bar.getByRole("button", { name: "Thumbs up" })).toBeFocused();
    await ada.page.keyboard.press("Enter");
    await expect(message.getByRole("list", { name: "Reactions" })).toContainText("👍");
    // As in ember-rust, sending a reaction hands focus back to Message options.
    await expect(message.getByRole("button", { name: "Message options" })).toBeFocused();
  });

  test("closes a bar opened from Message options on a click elsewhere, so only one is open", async ({ members, participant }) => {
    const grace = await participant("Grace");
    await grace.say("First");
    await grace.say("Second");
    const ada = await members.signIn("Ada");
    const options = (text: string) => ada.message(text).getByRole("button", { name: "Message options" });
    const bar = (text: string) => ada.message(text).getByRole("group", { name: "Message actions" });

    await ada.message("First").hover();
    await options("First").click();
    // Opened from its button, the bar stays when the pointer leaves, until a click anywhere else.
    await ada.composer().hover();
    await expect(bar("First")).toBeVisible();
    await ada.page.getByRole("heading", { level: 1 }).click();
    await expect(bar("First")).toBeHidden();
    await expect(options("First")).toHaveAttribute("aria-expanded", "false");

    await ada.message("First").hover();
    await options("First").click();
    await ada.message("Second").hover();
    await options("Second").click();
    await expect(options("First")).toHaveAttribute("aria-expanded", "false");
    await expect(bar("First")).toBeHidden();
    await expect(bar("Second")).toBeVisible();
  });

  test("opens the bar from a 44px Message options button on touch screens, on screen at 320px", async ({ members, participant }) => {
    await (await participant("Grace")).say("Tap for options");
    const ada = await members.signIn("Ada", { context: { ...phone, viewport: { width: 320, height: 640 } } });
    const message = ada.message("Tap for options");
    const options = message.getByRole("button", { name: "Message options" });
    // Found on the page rather than in the message, so it doesn't matter where the bar is drawn.
    const bar = ada.page.getByRole("group", { name: "Message actions" });
    expect(await box(options)).toMatchObject({ width: 44, height: 44 });
    await expect(options).toHaveAttribute("aria-expanded", "false");
    await expect(bar).toBeHidden();

    await options.tap();
    await expect(bar).toBeVisible();
    await expect(options).toHaveAttribute("aria-expanded", "true");
    const { x, width } = await box(bar);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(320);
  });

  test("closes the bar on touch screens with a second tap, a tap elsewhere or a reaction", async ({ members, participant }) => {
    await (await participant("Grace")).say("Tap me twice");
    const ada = await members.signIn("Ada", { context: phone });
    const message = ada.message("Tap me twice");
    const options = message.getByRole("button", { name: "Message options" });
    const bar = ada.page.getByRole("group", { name: "Message actions" });

    await options.tap();
    await expect(bar).toBeVisible();
    await options.tap();
    await expect(bar).toBeHidden();
    await expect(options).toHaveAttribute("aria-expanded", "false");

    await options.tap();
    await expect(bar).toBeVisible();
    await ada.page.getByRole("heading", { level: 1 }).tap();
    await expect(bar).toBeHidden();

    await options.tap();
    await bar.getByRole("button", { name: "Thumbs up" }).tap();
    await expect(message.getByRole("list", { name: "Reactions" })).toContainText("👍");
    await expect(bar).toBeHidden();
  });
});

test.describe(feature("messages.edit"), () => {
  test("lets the author edit a message, for everyone, saving on Ctrl or Cmd+Enter", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.send("Helo");

    await (await ada.actions("Helo")).getByRole("button", { name: "Edit" }).click();
    await expect(ada.editor()).toBeFocused();
    await expect(ada.editor()).toHaveText("Helo");
    await ada.editor().fill("Hello");
    await ada.editor().press("ControlOrMeta+Enter");

    await expect(grace.message("Hello")).toContainText("(edited)");
    await expect(grace.message("Helo")).toHaveCount(0);
    await expect(ada.message("Hello")).toContainText("(edited)");
    // Where ember-rust loses focus, it goes back to the composer.
    await expect(ada.composer()).toBeFocused();
  });

  test("edits the formatting along with the text, starting a new paragraph on Enter", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.composer().pressSequentially("A **bold** claim");
    await ada.composer().press("Enter");
    await (await ada.actions("A bold claim")).getByRole("button", { name: "Edit" }).click();
    await expect(ada.editor().locator("strong")).toHaveText("bold");
    // The cursor is after the text.
    await ada.page.keyboard.type(", revised");
    await ada.editor().press("Enter");
    await ada.page.keyboard.type("Second thoughts");
    await ada.editor().press("ControlOrMeta+Enter");
    const content = ada.message("A bold claim, revised").locator(".message-content");
    await expect(ada.message("A bold claim, revised")).toContainText("(edited)");
    await expect(content.locator("strong")).toHaveText("bold");
    await expect(content.locator("p")).toHaveText(["A bold claim, revised", "Second thoughts"]);
  });

  test("keeps the editor and what's written when the edit is too long to save", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.send("Short");
    await (await ada.actions("Short")).getByRole("button", { name: "Edit" }).click();
    await ada.editor().evaluate((content) => {
      (content.closest("lexxy-editor") as HTMLElement & { value: string }).value = `<p>${"x".repeat(10_001)}</p>`;
    });
    await ada.editor().press("ControlOrMeta+Enter");
    await expect(ada.page.getByRole("alert")).toHaveText("Messages can be up to 10,000 characters.");
    await expect(ada.editor().locator("p")).toHaveText(["x".repeat(10_001)]);
    await expect(ada.page.getByRole("article")).not.toContainText("(edited)");
  });

  test("shows the formatting toolbar above the text on a wide screen with a mouse", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.send("Format me");
    await (await ada.actions("Format me")).getByRole("button", { name: "Edit" }).click();
    const bold = ada.message("Format me").getByRole("toolbar").getByRole("button", { name: "Bold" });
    await expect(bold).toBeVisible();
    expect((await box(bold)).y).toBeLessThan((await box(ada.editor())).y);
  });

  test("saves from Save changes with the Link field open, as Lexxy checks that itself", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.send("Draft");
    await (await ada.actions("Draft")).getByRole("button", { name: "Edit" }).click();
    await ada.editor().fill("Final");
    await ada.editor().press("ControlOrMeta+k");
    await ada.page.getByRole("button", { name: "Save changes" }).click();
    await expect(ada.message("Final")).toContainText("(edited)");
  });

  test("discards an edit with Escape or Close editor and discard changes", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.send("Unchanged");
    await (await ada.actions("Unchanged")).getByRole("button", { name: "Edit" }).click();
    await ada.editor().fill("Something else");
    await ada.editor().press("Escape");
    await expect(ada.editor()).toHaveCount(0);
    await expect(ada.composer()).toBeFocused();

    await (await ada.actions("Unchanged")).getByRole("button", { name: "Edit" }).click();
    await ada.editor().fill("Something else");
    await ada.page.getByRole("button", { name: "Close editor and discard changes" }).click();
    await expect(ada.editor()).toHaveCount(0);
    await expect(ada.message("Unchanged")).not.toContainText("(edited)");
    await expect(ada.composer()).toBeFocused();
  });

  test("edits your newest message on Up Arrow, from an empty composer", async ({ members, participant }) => {
    const ada = await members.signIn("Ada");
    await ada.send("My first");
    await ada.send("My newest");
    await expect(ada.message("My newest")).not.toHaveAttribute("aria-busy");
    await (await participant("Grace")).say("Grace's, after mine");

    await ada.composer().pressSequentially("Half written");
    await ada.composer().press("ArrowUp");
    await expect(ada.editor()).toHaveCount(0);

    await ada.composer().fill("");
    await ada.composer().press("ArrowUp");
    await expect(editorField(ada.message("My newest"), "Edit message")).toBeFocused();
    await expect(ada.editor()).toHaveText("My newest");
  });

  test("takes no files", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.send("Look");
    await (await ada.actions("Look")).getByRole("button", { name: "Edit" }).click();
    await ada.editor().evaluate((content) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", { type: "image/png" }));
      content.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(ada.editor()).toHaveText("Look");
    await expect(ada.editor().locator("img, action-text-attachment, figure")).toHaveCount(0);
  });

  test("offers no Edit on other people's messages", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.send("Ada's");

    const toolbar = await grace.actions("Ada's");
    await expect(toolbar.getByRole("button", { name: "Thumbs up" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  test("lets an administrator edit anyone's message, for everyone", async ({ browser, baseURL, members, rooms }) => {
    const grace = await members.signIn("Grace");
    await grace.send("Grace's typo");
    await expect(grace.message("Grace's typo")).not.toHaveAttribute("aria-busy");
    const administrator = await administratorOn(browser, baseURL!, rooms.general);
    const message = administrator.getByRole("article").filter({ hasText: "Grace's typo" });

    await message.hover();
    await message.getByRole("button", { name: "Edit" }).click();
    const editor = editorField(administrator, "Edit message");
    await editor.fill("Grace's fix");
    await editor.press("ControlOrMeta+Enter");
    await expect(grace.message("Grace's fix")).toContainText("(edited)");
    await expect(grace.message("Grace's fix")).toContainText("Grace");
    await administrator.context().close();
  });
});

test.describe(feature("messages.delete"), () => {
  test("deletes a message for everyone from its editor, after asking", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.send("Oops");
    await expect(grace.message("Oops")).toBeVisible();
    await (await ada.actions("Oops")).getByRole("button", { name: "Edit" }).click();

    ada.page.once("dialog", (dialog) => dialog.dismiss());
    await ada.page.getByRole("button", { name: "Delete message" }).click();
    await expect(ada.editor()).toBeVisible();

    ada.page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe("Are you sure you want to delete this message?");
      void dialog.accept();
    });
    await ada.page.getByRole("button", { name: "Delete message" }).click();
    await expect(grace.message("Oops")).toHaveCount(0);
    await expect(ada.message("Oops")).toHaveCount(0);
    await expect(ada.composer()).toBeFocused();
  });

  test("lets an administrator delete anyone's message, for everyone", async ({ browser, baseURL, members, rooms }) => {
    const grace = await members.signIn("Grace");
    await grace.send("Grace's mistake");
    await expect(grace.message("Grace's mistake")).not.toHaveAttribute("aria-busy");
    const administrator = await administratorOn(browser, baseURL!, rooms.general);
    const message = administrator.getByRole("article").filter({ hasText: "Grace's mistake" });

    await message.hover();
    await message.getByRole("button", { name: "Edit" }).click();
    administrator.once("dialog", (dialog) => void dialog.accept());
    await administrator.getByRole("button", { name: "Delete message" }).click();
    await expect(grace.message("Grace's mistake")).toHaveCount(0);
    await expect(message).toHaveCount(0);
    await administrator.context().close();
  });

  test("offers Delete in the editor, not on the action bar", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.send("Mine to delete");
    const bar = await ada.actions("Mine to delete");
    await expect(bar.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(bar.getByRole("button", { name: /Delete/ })).toHaveCount(0);
  });
});

test.describe(feature("messages.grouping"), () => {
  test("shows quick follow-ups from the same person without repeating their name", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.send("First");
    await ada.send("Follow-up");

    await expect(grace.message("First").getByText("Ada", { exact: true })).toBeVisible();
    await expect(grace.message("Follow-up")).toBeVisible();
    await expect(grace.message("Follow-up").getByText("Ada", { exact: true })).toHaveCount(0);

    await grace.send("Grace replies");
    await expect(ada.message("Grace replies").getByText("Grace", { exact: true })).toBeVisible();
  });
});

test.describe(feature("mentions.highlight"), () => {
  test("highlights messages that mention you", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await grace.send("Thanks @Ada");
    await grace.send("No mention here");

    const highlight = (text: string) => ada.message(text).locator(".border-mention");
    await expect(highlight("Thanks @Ada")).toBeVisible();
    await expect(highlight("Thanks @Ada")).toHaveCSS("border-left-width", "2px");
    await expect(ada.message("No mention here")).toBeVisible();
    await expect(highlight("No mention here")).toHaveCount(0);
    await expect(grace.message("Thanks @Ada").locator(".border-mention")).toHaveCount(0);
  });
});

test.describe(feature("users.avatars"), () => {
  test("shows each person's avatar from the address the directory gives, the same everywhere", async ({ members }) => {
    const ada = await members.signIn("Ada Lovelace");
    const grace = await members.signIn("Grace");
    await ada.send("Avatar check");

    const avatar = (member: typeof ada) => member.message("Avatar check").locator("img[aria-hidden=true]").first();
    const address = new RegExp(`^/users/${ada.session.user.id}\\.[\\w-]{22}/avatar\\?v=\\d{14}$`);
    for (const member of [ada, grace]) {
      await expect(avatar(member)).toHaveAttribute("src", address);
      // Loaded from the Worker, not just named.
      await expect.poll(() => avatar(member).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    expect(await avatar(grace).getAttribute("src")).toBe(await avatar(ada).getAttribute("src"));
  });
});
