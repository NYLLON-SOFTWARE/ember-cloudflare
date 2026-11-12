import type { Locator } from "@playwright/test";
import { ROOM_SOCKET } from "../../fixtures";
import { expect, paste, test, type Member } from "./fixtures";

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Not visible");
  return rect;
};

/** The composer's card, around the text and its buttons. */
const card = (member: Member) => member.page.locator("form.composer > div:has([role=textbox])");

/** Aa, which shows and hides the formatting toolbar, and which screen readers call "Formatting". */
const formattingOptions = (member: Member) => member.page.locator("form.composer").getByRole("button", { name: "Formatting", exact: true });

/** The composer's formatting toolbar, over the text. */
const toolbar = (member: Member) => member.page.locator("form.composer").getByRole("toolbar", { name: "Formatting" });

/** A button of the formatting toolbar, by its name. */
const tool = (member: Member, name: string) => toolbar(member).getByRole("button", { name, exact: true });

/** Replaces what's in the composer with `markup`, as Lexxy holds what's typed. */
const write = (member: Member, markup: string) =>
  member.composer().evaluate((content, markup) => {
    (content.closest("lexxy-editor") as HTMLElement & { value: string }).value = markup;
  }, markup);

/** Opens another of the test's rooms from the sidebar. */
async function openRoom(member: Member, name: string) {
  await member.page.getByRole("region", { name: "Rooms" }).getByRole("link", { name: new RegExp(name) }).click();
  await expect(member.page.getByRole("heading", { level: 1 })).toHaveText(name);
  await member.connected();
}

test.describe("Composer", () => {
  test("is a card at least 108px tall, with the toolbar over the text, and +, Aa, Emoji, @ and Send with its chevron below", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    const field = ada.composer();
    const send = ada.page.getByRole("button", { name: "Send Message" });
    const below = ["Attach", "Formatting", "Emoji", "Mention someone"].map((name) => ada.page.locator("form.composer").getByRole("button", { name, exact: true }));
    const schedule = ada.page.getByRole("button", { name: "Schedule for later" });
    await expect(field).toHaveAttribute("placeholder", "Message #general");
    await expect(send).toHaveAttribute("title", "Send message");

    expect((await box(card(ada))).height).toBeGreaterThanOrEqual(108);
    await expect(card(ada)).toHaveCSS("border-top-left-radius", "12px");
    const fieldBox = await box(field);
    const toolbarBox = await box(toolbar(ada));
    expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(fieldBox.y + 1);
    const sendBox = await box(send);
    expect(sendBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
    let x = 0;
    for (const button of below) {
      const buttonBox = await box(button);
      expect(buttonBox.y + buttonBox.height / 2).toBeCloseTo(sendBox.y + sendBox.height / 2, 0);
      expect(buttonBox.x).toBeGreaterThan(x);
      x = buttonBox.x;
    }
    expect((await box(schedule)).x).toBeGreaterThan(sendBox.x);
  });

  test("is focused as the room opens", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await expect(ada.composer()).toBeFocused();
  });

  test("loads the editor once the room's messages are in, so its code doesn't hold them up", async ({ members }) => {
    let answeredAt = Number.POSITIVE_INFINITY;
    let editorRequestedAt = Number.NEGATIVE_INFINITY;
    const ada = await members.signIn("Ada", {
      beforeOpen: async (page) => {
        page.on("request", (request) => {
          if (/\/assets\/rich-text-editor-[\w-]+\.js$/.test(request.url())) editorRequestedAt = Date.now();
        });
        await page.routeWebSocket(ROOM_SOCKET, (ws) => {
          const room = ws.connectToServer();
          let frames = Promise.resolve();
          room.onMessage((frame) => {
            frames = frames.then(async () => {
              // The room's first answer, its welcome, comes a second late, long enough for an editor that didn't wait to load first.
              if (answeredAt === Number.POSITIVE_INFINITY) {
                await new Promise((resolve) => setTimeout(resolve, 1_000));
                answeredAt = Date.now();
              }
              ws.send(frame);
            });
          });
        });
      },
    });
    await expect(ada.composer()).toBeVisible();
    expect(editorRequestedAt).toBeGreaterThanOrEqual(answeredAt);
  });

  test("grows with the text up to a third of the window", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    const field = ada.composer();
    // The text box takes the card's padding, around the room for the text.
    const room = () => field.evaluate((el) => el.clientHeight - parseFloat(getComputedStyle(el).paddingTop) - parseFloat(getComputedStyle(el).paddingBottom));
    const empty = await room();
    await write(ada, "<p>A line</p>".repeat(3));
    expect(await room()).toBeGreaterThan(empty);
    // min(32dvh, 300px) of an 800px window
    await write(ada, "<p>A line</p>".repeat(40));
    expect(await room()).toBe(256);
  });

  test("takes a tap anywhere above its buttons in the text", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: phone });
    const cardBox = await box(card(ada));
    const sendBox = await box(ada.page.getByRole("button", { name: "Send Message" }));
    await ada.page.touchscreen.tap(cardBox.x + 2, cardBox.y + 2);
    await expect(ada.composer()).toBeFocused();
    await ada.composer().blur();
    await ada.page.touchscreen.tap(cardBox.x + cardBox.width - 2, sendBox.y - 1);
    await expect(ada.composer()).toBeFocused();
  });

  test("is at least 100px tall on phones", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: phone });
    expect((await box(card(ada))).height).toBeGreaterThanOrEqual(100);
  });
});

test.describe("Formatting toolbar", () => {
  test("shows Slack's tools over the text until Aa hides it, which this browser remembers", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await expect(toolbar(ada)).toBeVisible();
    expect(await toolbar(ada).getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual([
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Paragraph style",
      "Link",
      "Numbered list",
      "Bulleted list",
      "Blockquote",
      "Code",
      "Code block",
      "Divider",
    ]);
    await formattingOptions(ada).click();
    await expect(formattingOptions(ada)).toHaveAttribute("aria-pressed", "false");
    await expect(toolbar(ada)).toBeHidden();
    await expect(ada.composer()).toBeFocused();

    await ada.page.reload();
    await ada.connected();
    await expect(toolbar(ada)).toBeHidden();
    await formattingOptions(ada).click();
    await expect(toolbar(ada)).toBeVisible();
  });

  test("formats what's selected with each of its tools, showing it's on, and sends the formatting", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const tools = [
      ["Bold", "strong"],
      ["Italic", "em"],
      ["Underline", "u"],
      ["Strikethrough", "s"],
      ["Blockquote", "blockquote"],
      ["Code", "code"],
      ["Bulleted list", "ul > li"],
      ["Numbered list", "ol > li"],
      ["Code block", "pre"],
    ] as const;
    for (const [name, element] of tools) {
      await ada.composer().fill(`${name} text`);
      await ada.composer().press("ControlOrMeta+a");
      await tool(ada, name).click();
      await expect(tool(ada, name)).toHaveAttribute("aria-pressed", "true");
      await ada.composer().press("ControlOrMeta+Enter");
      await expect(grace.message(`${name} text`).locator(`.message-content ${element}`)).toHaveText(`${name} text`);
    }
  });

  test("has every tool working again once code is sent", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.composer().pressSequentially("```let a = 1;");
    await expect(tool(ada, "Bold")).toBeDisabled();
    await ada.page.getByRole("button", { name: "Send Message" }).click();
    await expect(ada.composer()).toHaveText("");
    for (const name of ["Bold", "Link", "Code", "Code block", "Divider"]) await expect(tool(ada, name), name).toBeEnabled();
    await expect(tool(ada, "Code block")).toHaveAttribute("aria-pressed", "false");

    await ada.composer().pressSequentially("see `x`");
    await ada.composer().press("Enter");
    await expect(ada.composer()).toHaveText("");
    for (const name of ["Bold", "Code block"]) await expect(tool(ada, name), name).toBeEnabled();
  });

  test("leaves no formatting on for the next message", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.composer().fill("Loud");
    await ada.composer().press("ControlOrMeta+a");
    await tool(ada, "Bold").click();
    await ada.composer().press("Enter");
    await expect(grace.message("Loud").locator(".message-content strong")).toHaveText("Loud");

    await expect(tool(ada, "Bold")).toHaveAttribute("aria-pressed", "false");
    await ada.composer().pressSequentially("Quiet");
    await ada.composer().press("Enter");
    await expect(grace.message("Quiet").locator(".message-content")).toHaveText("Quiet");
    await expect(grace.message("Quiet").locator(".message-content strong")).toHaveCount(0);
  });

  test("offers Normal text, Heading and Subheading under Paragraph style, in a menu that opens upward", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.composer().fill("Big news");
    await tool(ada, "Paragraph style").click();
    const menu = ada.page.getByRole("menu", { name: "Paragraph style" });
    await expect(menu.getByRole("menuitemradio")).toHaveText(["Normal text", "Heading", "Subheading"]);
    const menuBox = await box(menu);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual((await box(tool(ada, "Paragraph style"))).y);
    await menu.getByRole("menuitemradio", { name: "Heading", exact: true }).click();
    await expect(ada.composer().locator("h1")).toHaveText("Big news");
    await expect(ada.composer()).toBeFocused();
    await expect(tool(ada, "Paragraph style")).toHaveAttribute("aria-pressed", "true");

    await tool(ada, "Paragraph style").click();
    await menu.getByRole("menuitemradio", { name: "Normal text" }).click();
    await expect(ada.composer().locator("p")).toHaveText("Big news");

    await tool(ada, "Paragraph style").click();
    await menu.getByRole("menuitemradio", { name: "Subheading" }).click();
    await ada.composer().press("Enter");
    await expect(grace.message("Big news").locator(".message-content h3")).toHaveText("Big news");
  });

  test("links what's selected to the address given in Link, or Ctrl or Cmd+K, and Remove link takes it off", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.composer().fill("Ember");
    await ada.composer().press("ControlOrMeta+a");
    await tool(ada, "Link").click();
    const address = ada.page.getByRole("textbox", { name: "Link" });
    await expect(address).toBeFocused();
    await address.fill("example.com/");
    await ada.page.getByRole("button", { name: "Save" }).click();
    await expect(ada.composer().getByRole("link", { name: "Ember" })).toHaveAttribute("href", "https://example.com/");
    await expect(tool(ada, "Link")).toHaveAttribute("aria-pressed", "true");
    await expect(ada.composer()).toBeFocused();

    await tool(ada, "Link").click();
    await ada.page.getByRole("button", { name: "Remove link" }).click();
    await expect(ada.composer().getByRole("link")).toHaveCount(0);

    // An address has to be one, and Ctrl or Cmd+K opens the field too, even with the toolbar hidden.
    await formattingOptions(ada).click();
    await ada.composer().press("ControlOrMeta+a");
    await ada.composer().press("ControlOrMeta+k");
    await expect(address).toBeFocused();
    await address.fill("not an address");
    await address.press("Enter");
    await expect(ada.page.getByRole("alert")).toHaveText("Enter a web address, such as example.com.");
    await address.fill("https://example.com/");
    await address.press("Enter");
    await expect(ada.composer()).toBeFocused();
    await ada.composer().press("Enter");
    await expect(grace.message("Ember").getByRole("link", { name: "Ember" })).toHaveAttribute("href", "https://example.com/");
  });

  test("leaves only the button that ends code working inside code, which it shows as on", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.composer().pressSequentially("Run `npm test");
    await ada.composer().pressSequentially("`");
    await expect(ada.composer().locator("code")).toHaveText("npm test");
    await ada.composer().press("ArrowLeft");
    await ada.composer().press("ArrowLeft");
    await expect(tool(ada, "Code")).toHaveAttribute("aria-pressed", "true");
    for (const name of ["Bold", "Link", "Code block", "Bulleted list"]) await expect(tool(ada, name)).toBeDisabled();
    await expect(tool(ada, "Code")).toBeEnabled();
  });

  test("formats Markdown as it's typed, and Ctrl or Cmd+B, I, U and Shift+X", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const blocks = [
      ["# Heading", "h1", "Heading"],
      ["## Subheading", "h2", "Subheading"],
      ["> Quoted", "blockquote", "Quoted"],
      ["- Bulleted", "ul > li", "Bulleted"],
      ["1. Numbered", "ol > li", "Numbered"],
    ] as const;
    for (const [typed, element, text] of blocks) {
      await ada.composer().pressSequentially(typed);
      // Enter adds an item in a list, as in Slack, where Ctrl or Cmd+Enter sends.
      await ada.composer().press(element.endsWith("li") ? "ControlOrMeta+Enter" : "Enter");
      await expect(grace.message(text).locator(`.message-content ${element}`)).toHaveText(text);
    }

    // Three backticks start a code block at once, as in Slack, where Enter starts a new line.
    await ada.composer().pressSequentially("```");
    // Lexxy writes a code block as a block of code, the only code there yet.
    await expect(ada.composer().locator("code")).toBeVisible();
    await expect(tool(ada, "Code block")).toHaveAttribute("aria-pressed", "true");
    await ada.composer().pressSequentially("let x = 1");
    await ada.composer().press("Enter");
    await ada.composer().pressSequentially("let y = 2");
    await ada.composer().press("ControlOrMeta+Enter");
    const code = grace.message("let x = 1").locator(".message-content pre");
    expect(await code.innerText()).toBe("let x = 1\nlet y = 2");

    await ada.composer().pressSequentially("Some `code`, ~~struck~~ and [linked](https://example.com/) text");
    await ada.composer().press("Enter");
    const inline = grace.message("Some code").locator(".message-content");
    await expect(inline.locator("code")).toHaveText("code");
    await expect(inline.locator("s")).toHaveText("struck");
    await expect(inline.getByRole("link", { name: "linked" })).toHaveAttribute("href", "https://example.com/");

    for (const [key, element] of [
      ["b", "strong"],
      ["i", "em"],
      ["u", "u"],
      ["Shift+x", "s"],
    ] as const) {
      await ada.composer().fill(`Pressed ${key}`);
      await ada.composer().press("ControlOrMeta+a");
      await ada.composer().press(`ControlOrMeta+${key}`);
      await ada.composer().press("Enter");
      await expect(grace.message(`Pressed ${key}`).locator(`.message-content ${element}`)).toHaveText(`Pressed ${key}`);
    }

    // Divider rules off what's above from what's typed next.
    await ada.composer().pressSequentially("Above");
    await tool(ada, "Divider").click();
    await ada.composer().pressSequentially("Below");
    await ada.composer().press("Enter");
    await expect(grace.message("Above").locator(".message-content hr")).toHaveCount(1);
  });

  test("scrolls sideways on the narrowest screen rather than wrapping", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { ...phone, viewport: { width: 320, height: 568 } } });
    await formattingOptions(ada).tap();
    expect((await box(tool(ada, "Divider"))).y).toBe((await box(tool(ada, "Bold"))).y);
    expect(await toolbar(ada).evaluate((bar) => bar.scrollWidth > bar.clientWidth)).toBe(true);
    await tool(ada, "Divider").scrollIntoViewIfNeeded();
    await expect(tool(ada, "Divider")).toBeInViewport();
  });
});

test.describe("Insert", () => {
  test("writes an emoji from Emoji, and an @ from Mention someone, which lists the people to mention", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await members.signIn("Grace");
    await ada.composer().pressSequentially("Hi");
    await ada.page.getByRole("button", { name: "Emoji" }).click();
    // The picker's search finds an emoji by its short name, and Enter writes the first it finds.
    await ada.page.getByRole("searchbox", { name: "Search emoji" }).or(ada.page.getByRole("textbox", { name: "Search emoji" })).fill("thumbsup");
    await ada.page.keyboard.press("Enter");
    await expect(ada.composer()).toHaveText("Hi👍");
    await expect(ada.composer()).toBeFocused();

    await ada.page.getByRole("button", { name: "Mention someone" }).click();
    await expect(ada.composer()).toHaveText("Hi👍 @");
    await expect(ada.page.getByRole("option", { name: /Grace/ }).first()).toBeVisible();
  });

  test("lists the people to mention from @ at once in an empty composer that doesn't have focus", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await members.signIn("Grace");
    await ada.composer().blur();
    await ada.page.getByRole("button", { name: "Mention someone" }).click();
    await expect(ada.composer()).toHaveText("@");
    await expect(ada.page.getByRole("option", { name: /Grace/ }).first()).toBeVisible();
    await expect(ada.composer()).toBeFocused();
  });
});

test.describe("Pasting into the composer", () => {
  test("pastes an address as a link, and over selected text, links the text to it", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await paste(ada, "https://example.com/article");
    await expect(ada.composer().getByRole("link", { name: "https://example.com/article" })).toHaveAttribute("href", "https://example.com/article");

    await ada.composer().press("ControlOrMeta+a");
    await ada.composer().press("Delete");
    await ada.composer().pressSequentially("Ember");
    await ada.composer().press("ControlOrMeta+a");
    await paste(ada, "https://example.com/");
    await expect(ada.composer()).toHaveText("Ember");
    await ada.composer().press("Enter");
    await expect(grace.message("Ember").getByRole("link", { name: "Ember" })).toHaveAttribute("href", "https://example.com/");
  });

  test("converts pasted Markdown, keeping its line breaks, and pastes other text as it is", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await paste(ada, "**Bold** and _italic_\nsecond line\n\n- one\n- two");
    await expect(ada.composer().locator("strong")).toHaveText("Bold");
    await expect(ada.composer().locator("em")).toHaveText("italic");
    await expect(ada.composer().locator("li")).toHaveText(["one", "two"]);
    // The cursor ends in the list, where Enter would add an item.
    await ada.composer().press("ControlOrMeta+Enter");
    const message = grace.message("Bold and italic").locator(".message-content");
    await expect(message.locator("p")).toHaveText("Bold and italic\nsecond line", { useInnerText: true });
    await expect(message.locator("p > br")).toHaveCount(1);
    await expect(message.locator("ul > li")).toHaveText(["one", "two"]);

    // Without Markdown, nothing is changed: not runs of spaces, nor backslashes.
    await paste(ada, "C:\\Users\\ada\\my  notes.txt");
    await ada.composer().press("Enter");
    await expect(grace.message("notes.txt")).toBeVisible();
    expect(await grace.message("notes.txt").locator(".message-content").textContent()).toBe("C:\\Users\\ada\\my  notes.txt");
  });

  test("keeps text pasted into a code block as it is", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.composer().pressSequentially("```");
    await paste(ada, "**not bold**\n  indented");
    await ada.composer().press("ControlOrMeta+Enter");
    const code = grace.message("not bold").locator(".message-content pre");
    await expect(code).toBeVisible();
    expect(await code.innerText()).toBe("**not bold**\n  indented");
  });

  test("keeps pasted formatting, tables included", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await paste(ada, "Name Points\nJason 10", "<table><tr><th>Name</th><th>Points</th></tr><tr><td>Jason</td><td>10</td></tr></table>");
    await expect(ada.composer().locator("table")).toBeVisible();
    await ada.composer().press("Enter");
    const table = grace.message("Jason").locator(".message-content table");
    await expect(table.locator("th")).toHaveText(["Name", "Points"]);
    await expect(table.locator("td")).toHaveText(["Jason", "10"]);

    await paste(ada, "Bold, struck and linked", '<p><b>Bold</b>, <s>struck</s> and <a href="https://example.com/">linked</a></p>');
    await ada.composer().press("Enter");
    const formatted = grace.message("struck and linked").locator(".message-content");
    await expect(formatted.locator("strong")).toHaveText("Bold");
    await expect(formatted.locator("s")).toHaveText("struck");
    await expect(formatted.getByRole("link", { name: "linked" })).toHaveAttribute("href", "https://example.com/");
  });

  test("waits to send pasted files rather than putting them in the text", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.composer().pressSequentially("Look");
    await ada.composer().evaluate((content) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", { type: "image/png" }));
      content.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(ada.composer()).toHaveText("Look");
    await expect(ada.composer().locator("img, action-text-attachment, figure")).toHaveCount(0);
    await expect(ada.page.getByRole("button", { name: "Remove screenshot.png" })).toBeVisible();
  });
});

test.describe("Send from the keyboard", () => {
  test("sends on Enter, starts a new line on Shift+Enter and never sends a blank message", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.composer().pressSequentially("   ");
    await ada.composer().press("Enter");

    await ada.composer().fill("First line");
    await ada.composer().press("Shift+Enter");
    await ada.composer().pressSequentially("second line");
    await expect(ada.composer()).toHaveText("First line\nsecond line", { useInnerText: true });
    await ada.composer().press("Enter");

    await expect(grace.message("First line")).toContainText("second line");
    await expect(grace.page.getByRole("article")).toHaveCount(1);
    await expect(ada.composer()).toHaveText("");
    await expect(ada.composer()).toBeFocused();
  });

  test("quotes line by line, as Slack does: Backspace on an empty quoted line ends the quote, and > quotes just its line", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");

    // A quote, then what's said about it, on a line Backspace takes out of the quote.
    await ada.composer().pressSequentially("> Not obvious who is in this room?");
    await ada.composer().press("Shift+Enter");
    await ada.composer().press("Backspace");
    await ada.composer().pressSequentially("Agreed, it needs a people list.");
    await ada.composer().press("Enter");
    const reply = grace.message("Agreed").locator(".message-content");
    await expect(reply.locator("blockquote")).toHaveText("Not obvious who is in this room?");
    await expect(reply.locator(":scope > p")).toHaveText("Agreed, it needs a people list.");

    // > at the start of a line added above what's written quotes that line alone.
    await ada.composer().press("Shift+Enter");
    await ada.composer().pressSequentially("What was said");
    await expect(ada.composer()).toHaveText("\nWhat was said", { useInnerText: true });
    await ada.composer().press("ArrowUp");
    // Lexical hears the caret move with the selectionchange after the key, as a frame goes by.
    await ada.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await ada.composer().pressSequentially("> The quote");
    await ada.composer().press("Enter");
    const quoted = grace.message("The quote").locator(".message-content");
    await expect(quoted.locator("blockquote")).toHaveText("The quote");
    await expect(quoted.locator(":scope > p")).toHaveText("What was said");

    // > on a later line quotes that line, leaving the ones before it as they are.
    await ada.composer().pressSequentially("Before");
    await ada.composer().press("Shift+Enter");
    await ada.composer().pressSequentially("> Middle");
    await ada.composer().press("Enter");
    const middle = grace.message("Before").locator(".message-content");
    await expect(middle.locator("blockquote")).toHaveText("Middle");
    await expect(middle.locator(":scope > p").first()).toHaveText("Before");
  });

  test("sends on Enter while the toolbar shows, as Slack does, but starts a new line in a code block", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await expect(toolbar(ada)).toBeVisible();
    await ada.composer().pressSequentially("One");
    await ada.composer().press("Enter");
    await expect(ada.message("One")).toBeVisible();

    await tool(ada, "Code block").click();
    await ada.composer().pressSequentially("a");
    await ada.composer().press("Enter");
    await ada.composer().pressSequentially("b");
    await expect(ada.page.getByRole("article")).toHaveCount(1);
    await ada.composer().press("ControlOrMeta+Enter");
    await expect(ada.page.getByRole("article")).toHaveCount(2);
  });

  test("starts a list with - on any line, Shift+Enter's too, where Enter adds an item rather than sending", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.composer().pressSequentially("Then");
    await ada.composer().press("Shift+Enter");
    await ada.composer().pressSequentially("- first");
    await ada.composer().press("Enter");
    await ada.composer().pressSequentially("second");
    await expect(ada.page.getByRole("article")).toHaveCount(0);
    await expect(ada.composer().locator("ul > li")).toHaveText(["first", "second"]);
    await ada.composer().press("ControlOrMeta+Enter");
    await expect(grace.message("Then").locator(".message-content li")).toHaveText(["first", "second"]);
  });

  test("sends from the Send button with Link left open, unfinished", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.composer().fill("Never mind the link");
    await ada.composer().press("ControlOrMeta+k");
    await ada.page.getByRole("textbox", { name: "Link" }).fill("example");
    await ada.page.getByRole("button", { name: "Send Message" }).click();
    await expect(ada.message("Never mind the link")).toBeVisible();
  });

  test("says a message over 10,000 characters is too long instead of sending it, keeping it to be cut down", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await write(ada, `<p>${"x".repeat(10_001)}</p>`);
    await ada.composer().press("Enter");
    await expect(ada.page.getByRole("alert")).toHaveText("Messages can be up to 10,000 characters.");
    await expect(ada.composer()).toHaveText("x".repeat(10_001));
    await expect(ada.page.getByRole("article")).toHaveCount(0);
  });

  test("starts a new paragraph on Enter on a touch screen, where only the Send button sends", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: phone });
    await ada.composer().tap();
    await ada.page.keyboard.type("First line");
    await ada.page.keyboard.press("Enter");
    await ada.page.keyboard.type("second line");
    await expect(ada.composer().locator("p")).toHaveText(["First line", "second line"]);
    await expect(ada.page.getByRole("article")).toHaveCount(0);

    await ada.page.getByRole("button", { name: "Send Message" }).tap();
    await expect(ada.message("First line")).toContainText("second line");
    await expect(ada.composer()).toBeFocused();
  });
});

test.describe("Keep drafts", () => {
  test("keeps what's written in a room, formatting and all, until it's sent", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.composer().pressSequentially("Half a **thought** so far");
    await expect(ada.composer().locator("strong")).toHaveText("thought");

    await ada.page.reload();
    await ada.connected();
    await expect(ada.composer().locator("strong")).toHaveText("thought");
    await expect(ada.composer()).toBeFocused();
    // The cursor is after what was written.
    await ada.page.keyboard.type(" and more");
    await expect(ada.composer()).toHaveText("Half a thought so far and more");

    await ada.composer().press("Enter");
    await expect(ada.message("Half a thought so far and more").locator(".message-content strong")).toHaveText("thought");
    await ada.page.reload();
    await ada.connected();
    await expect(ada.composer()).toHaveText("");
  });

  test("keeps each room's to itself", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.composer().pressSequentially("For general");
    await openRoom(ada, "random");
    await expect(ada.composer()).toHaveText("");
    await ada.composer().pressSequentially("For random");

    await openRoom(ada, "general");
    await expect(ada.composer()).toHaveText("For general");
    await openRoom(ada, "random");
    await expect(ada.composer()).toHaveText("For random");
  });
});

test.describe("Rich text, safely", () => {
  test("sends the formatting Markdown makes as it's typed", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.composer().pressSequentially("Some **bold** and _italic_ text");
    await ada.composer().press("Enter");
    const text = grace.message("Some bold").locator(".message-content");
    await expect(text.locator("strong")).toHaveText("bold");
    await expect(text.locator("em")).toHaveText("italic");
  });

  test("sends what's typed as text, never as markup", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.composer().pressSequentially("<b>1</b> < 2 & 3");
    await ada.composer().press("Enter");
    await expect(ada.message("<b>1</b> < 2 & 3")).toBeVisible();
    await expect(ada.message("< 2 & 3").locator(".message-content b")).toHaveCount(0);
  });
});
