import { feature } from "@ember/parity";
import { HISTORY_PAGE_SIZE } from "@ember/protocol";
import { expect, test } from "./fixtures";

// Every test here starts in a room with more history than fits on one page.
const COUNT = HISTORY_PAGE_SIZE + 20;

/** The body of message `n`, zero-padded so that #1 doesn't also match #10 to #19. */
const body = (n: number) => `History #${String(n).padStart(3, "0")}`;

test.beforeEach(async ({ participant }) => {
  const archivist = await participant("Archivist");
  for (let n = 1; n <= COUNT; n++) await archivist.say(body(n));
});

test.describe(feature("messages.history"), () => {
  test("opens on the newest page and loads earlier messages when you scroll up, keeping your place", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const log = ada.page.getByRole("log");

    await expect(ada.message(body(COUNT))).toBeInViewport();
    const firstLoaded = COUNT - HISTORY_PAGE_SIZE + 1;
    await expect(ada.message(body(firstLoaded))).toBeAttached();
    await expect(ada.message(body(firstLoaded - 1))).toHaveCount(0);

    await log.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(ada.message(body(1))).toBeAttached();
    await expect(ada.message(body(firstLoaded - 1))).toBeAttached();
    // The message that was at the top is still in view, rather than the view jumping to the oldest.
    await expect(ada.message(body(firstLoaded))).toBeInViewport();
    await expect(ada.message(body(1))).not.toBeInViewport();
    await expect(ada.page.getByText("Loading earlier messages…")).toHaveCount(0);
  });
});

test.describe(feature("messages.day-separators"), () => {
  test("starts today's messages under a Today separator", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await expect(ada.page.getByRole("log").getByRole("separator").last()).toHaveText("Today");
  });
});

test.describe(feature("ui.scroll"), () => {
  test("follows new messages while you're at the bottom", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await grace.send("Latest news");
    await expect(ada.message("Latest news")).toBeInViewport();
  });

  test("stays put when you've scrolled up, and offers a way back to the latest", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const latest = ada.page.getByRole("button", { name: "Return to latest messages" });
    await expect(latest).toHaveCount(0);

    await ada.page.getByRole("log").evaluate((el) => el.scrollTo({ top: el.scrollHeight - el.clientHeight - 800 }));
    await expect(latest).toBeVisible();

    await grace.send("While you were reading");
    await expect(ada.message("While you were reading")).toBeAttached();
    await expect(ada.message("While you were reading")).not.toBeInViewport();

    await latest.click();
    await expect(ada.message("While you were reading")).toBeInViewport();
    await expect(latest).toHaveCount(0);
  });
});
