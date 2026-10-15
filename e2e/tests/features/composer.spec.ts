import { feature } from "@ember/parity";
import type { Locator } from "@playwright/test";
import { ROOM_SOCKET } from "../../fixtures";
import { expect, test, type Member } from "./fixtures";

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Not visible");
  return rect;
};

/** The composer's card, around the text and its buttons. */
const card = (member: Member) => member.page.locator("form.composer > div:has([role=textbox])");

/** Formatting options, which screen readers call "Rich text", as in ember-rust. */
const formattingOptions = (member: Member) => member.page.getByRole("button", { name: "Rich text" });

/** Lexxy's formatting toolbar in the composer. */
const toolbar = (member: Member) => member.page.locator("form.composer lexxy-toolbar");

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

test.describe(feature("composer.layout"), () => {
  test("is a card at least 108px tall, with the text on top and Formatting options and a round Send button below", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    const field = ada.composer();
    const send = ada.page.getByRole("button", { name: "Send Message" });
    await expect(field).toHaveAttribute("placeholder", "Message #general");
    await expect(formattingOptions(ada)).toHaveAttribute("title", "Formatting options");
    await expect(send).toHaveAttribute("title", "Send message");

    expect((await box(card(ada))).height).toBeGreaterThanOrEqual(108);
    await expect(card(ada)).toHaveCSS("border-top-left-radius", "12px");
    const fieldBox = await box(field);
    const sendBox = await box(send);
    expect(sendBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
    expect((await box(formattingOptions(ada))).y).toBe(sendBox.y);
    expect(sendBox.width).toBe(sendBox.height);
    expect(parseFloat(await send.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(sendBox.width / 2);
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

test.describe(feature("composer.formatting-toolbar"), () => {
  test("Formatting options shows Lexxy's toolbar under the text, without the tools Campfire leaves out", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await expect(toolbar(ada)).toBeHidden();
    await formattingOptions(ada).click();
    await expect(formattingOptions(ada)).toHaveAttribute("aria-pressed", "true");
    await expect(toolbar(ada)).toBeVisible();
    await expect(ada.composer()).toBeFocused();
    expect((await box(toolbar(ada))).y).toBeGreaterThanOrEqual((await box(ada.composer())).y + (await box(ada.composer())).height);
    await expect(toolbar(ada).getByRole("button", { name: "Bold" })).toBeVisible();
    for (const name of ["Underline", "Color highlight", "Insert a table", "Insert a divider", "Undo", "Redo"]) {
      await expect(toolbar(ada).getByRole("button", { name, exact: true })).toBeHidden();
    }

    await formattingOptions(ada).click();
    await expect(toolbar(ada)).toBeHidden();
  });
});

test.describe(feature("composer.send"), () => {
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

  test("starts a new paragraph on Enter while the toolbar shows, and sends on Ctrl or Cmd+Enter, closing it", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await formattingOptions(ada).click();
    await ada.composer().pressSequentially("One");
    await ada.composer().press("Enter");
    await ada.composer().pressSequentially("Two");
    await expect(ada.composer().locator("p")).toHaveText(["One", "Two"]);
    await expect(ada.page.getByRole("article")).toHaveCount(0);

    await ada.composer().press("ControlOrMeta+Enter");
    await expect(ada.message("One").locator(".message-content p")).toHaveText(["One", "Two"]);
    await expect(toolbar(ada)).toBeHidden();
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

test.describe(feature("composer.draft"), () => {
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

test.describe(feature("messages.rich-text"), () => {
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
