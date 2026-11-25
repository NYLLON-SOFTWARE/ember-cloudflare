import type { Locator } from "@playwright/test";
import { expect, recordsClips, test, type Member } from "./fixtures";

// Slack's clips: video and audio recorded from the composer, which go as files with the next message.

// A microphone and a camera, which a page may use without asking anyone: Chromium's made-up ones, a
// microphone that beeps and a camera with a made-up picture, or WebKit's, which a page gets once it's
// granted them, as Chromium's switches would stop WebKit opening.
test.use(
  process.env.E2E_BROWSER === "webkit"
    ? { permissions: ["camera", "microphone"] }
    : { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } },
);

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

/** The composer's card, around the text and its buttons. */
const card = (member: Member) => member.page.locator("form.composer > div:has([role=textbox])");

/** A button under the composer's text, by its name, found while a menu over the page hides it from the rest too. */
const underText = (member: Member, name: string) => card(member).getByRole("button", { name, exact: true, includeHidden: true });

/** Record video clip's dialog. */
const videoRecorder = (member: Member) => member.page.getByRole("dialog", { name: "Record video clip" });

/** Record audio clip's bar, in the card's place. */
const audioRecorder = (member: Member) => card(member).getByRole("group", { name: "Record audio clip" });

/** The choices in the menu Slack's + opens. */
const attachChoices = (member: Member) => member.page.getByRole("menu").getByRole("menuitem");

/** The chip of a clip waiting to be sent, by its kind. */
const clipChip = (member: Member, kind: "Video" | "Audio") => member.page.getByRole("button", { name: new RegExp(`^Remove ${kind} clip \\d{4}-\\d\\d-\\d\\d at .+\\.(mp4|m4a|webm)$`) });

/** How long a video or a recording of sound says it is, to the nearest second, once it has loaded what says so, or null where it doesn't say. */
async function lengthOf(media: Locator): Promise<number | null> {
  await media.evaluate((element: HTMLMediaElement) => {
    element.preload = "metadata";
    element.load();
  });
  await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.readyState)).toBeGreaterThanOrEqual(1);
  return media.evaluate((element: HTMLMediaElement) => (Number.isFinite(element.duration) ? Math.round(element.duration) : null));
}

/**
 * How long, to the nearest second, a clip the tests stop once its timer says 0:02 says it is: 2 seconds, or
 * 3 where a busy machine stops it more than half a second after the timer says so, as CI's can.
 */
const TWO_SECOND_LENGTHS = [2, 3];

/** The player of the video clip a message holds. */
const videoPlayer = (member: Member) => member.page.getByRole("article").getByRole("group", { name: /^Video clip .+\.(mp4|webm)$/ });

/** The player of the audio clip a message holds, of a file ending in one of `extensions`. */
const clipPlayer = (member: Member, extensions = "m4a|webm") => member.page.getByRole("article").getByRole("group", { name: new RegExp(`^Audio clip .+\\.(${extensions})$`) });

/** How tall each bar of a player's waveform is, in pixels. */
const barHeights = (player: Locator) => player.locator("clipPath rect").evaluateAll((bars) => bars.map((bar) => Number(bar.getAttribute("height"))));

test.describe("Clips", () => {
  test.skip(({ browserName }) => !recordsClips(browserName), "Playwright's WebKit for Linux has no MediaRecorder, so it records no clips, and offers none");

  test("records a video clip from the camera, as a mirror shows you, choosing its thumbnail, to go with the next message, which plays in place for everyone, saying when it was recorded and how long it is", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    const grace = await members.signIn("Grace");
    await underText(ada, "Record video clip").click();
    const dialog = videoRecorder(ada);
    const camera = dialog.getByLabel("Your camera");
    await expect.poll(() => camera.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    expect(await camera.evaluate((video) => parseFloat(getComputedStyle(video).scale))).toBeLessThan(0);

    await dialog.getByRole("button", { name: "Record", exact: true }).click();
    await expect(dialog.getByLabel("Camera", { exact: true })).toBeDisabled();
    await expect(dialog.getByRole("timer")).toHaveAccessibleName("Recording, 0:02 of 5:00");
    await dialog.getByRole("button", { name: "Stop recording" }).click();
    await expect(dialog.getByLabel("Your clip")).toBeVisible();
    // Once the browser knows how long the clip is.
    const thumbnail = dialog.getByLabel("Thumbnail");
    await expect(thumbnail).toHaveAttribute("max", /^\d/);
    expect(TWO_SECOND_LENGTHS).toContain(Math.round(Number(await thumbnail.getAttribute("max"))));
    await thumbnail.fill("1");
    await expect(thumbnail).toHaveAttribute("aria-valuetext", "0:01");
    await expect.poll(() => dialog.getByLabel("Your clip").evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(1);

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    // Its chip shows the thumbnail chosen, as its message will.
    await expect(clipChip(ada, "Video").locator("img")).toBeVisible();
    await expect(ada.composer()).toBeFocused();
    await ada.page.getByRole("button", { name: "Send Message" }).click();

    for (const member of [ada, grace]) {
      const player = videoPlayer(member);
      // Its card says when it was recorded and how long it is, which Ada's browser read as she sent it, loading none of it.
      await expect(player.getByText("Video clip", { exact: true })).toBeVisible();
      await expect(player.getByText(/^Recorded \w+ \d+ at .+ · 0:0[23]$/)).toBeVisible();
      const video = player.locator("video");
      await expect(video).toHaveAttribute("poster", /^\/previews\//);
      expect(await video.evaluate((element: HTMLVideoElement) => element.readyState)).toBe(0);
      expect(TWO_SECOND_LENGTHS).toContain(await lengthOf(video));
    }

    // It plays in place, filling its line, then it's ready to play again from its start.
    const player = videoPlayer(grace);
    await player.getByRole("button", { name: "Play", exact: true }).click();
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect(player.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^0:01 of /);
    await expect(player.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(player.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^0:00 of /);
  });

  test("records an audio clip from the microphone at once, in the composer's place, keeping what's written, to go with it, which plays for everyone, saying how long it is, with the waveform its sender's browser worked out", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    // Grace's browser fetches no clip to work a waveform out from, as it came with the message.
    const fetched: string[] = [];
    grace.page.on("request", (request) => void (request.resourceType() === "fetch" && new URL(request.url()).pathname.startsWith("/files/") && fetched.push(request.url())));
    await ada.composer().pressSequentially("Hear this");
    await underText(ada, "Record audio clip").click();
    const recorder = audioRecorder(ada);
    await expect(recorder.getByRole("button", { name: "Done" })).toBeFocused();
    // The text is out of sight and reach under it, and its buttons too.
    await expect(ada.composer()).toBeHidden();
    await expect(underText(ada, "Send Message")).toBeHidden();
    await expect(recorder.getByRole("timer")).toHaveAccessibleName("Recording, 0:02 of 5:00");

    await ada.page.keyboard.press("Enter");
    await expect(recorder).toBeHidden();
    await expect(clipChip(ada, "Audio")).toBeVisible();
    await expect(ada.composer()).toBeFocused();
    await expect(ada.composer()).toHaveText("Hear this");
    await ada.composer().press("Enter");

    await expect(grace.message("Hear this")).toBeVisible();
    const waveforms: number[][] = [];
    for (const member of [ada, grace]) {
      const player = clipPlayer(member);
      // At its full width, though it follows its text as a message of its own, in a column only as wide as what it holds.
      expect((await player.boundingBox())?.width).toBe(380);
      expect(TWO_SECOND_LENGTHS).toContain(await lengthOf(player.locator("audio")));
      await expect(player.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^0:00 of 0:0[23]$/);
      // The fake microphone's beeps, between silences.
      const heights = await barHeights(player);
      expect(Math.max(...heights)).toBe(30);
      expect(Math.min(...heights)).toBe(3);
      waveforms.push(heights);
    }
    expect(waveforms[1]).toEqual(waveforms[0]);
    expect(fetched).toEqual([]);

    // It plays, filling its waveform, then it's ready to play again from its start.
    const player = clipPlayer(grace);
    await player.getByRole("button", { name: "Play", exact: true }).click();
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect(player.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^0:01 of /);
    await expect(player.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(player.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^0:00 of /);
  });

  test("writes how long a clip is into it where the browser records WebM alone, as Firefox does, as the browser leaves it out, so its player can say", async ({ members }) => {
    const ada = await members.signIn("Ada");
    // The recorder takes the first type the browser records, so here it takes WebM.
    await ada.page.evaluate(() => {
      const records = MediaRecorder.isTypeSupported.bind(MediaRecorder);
      MediaRecorder.isTypeSupported = (type: string) => !type.includes("mp4") && records(type);
    });
    await underText(ada, "Record audio clip").click();
    await expect(audioRecorder(ada).getByRole("timer")).toHaveAccessibleName("Recording, 0:02 of 5:00");
    await ada.page.keyboard.press("Enter");
    await expect(clipChip(ada, "Audio")).toHaveAccessibleName(/\.webm$/);
    await ada.page.getByRole("button", { name: "Send Message" }).click();

    const player = clipPlayer(ada, "webm");
    expect(TWO_SECOND_LENGTHS).toContain(await lengthOf(player.locator("audio")));
    await expect(player.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^0:00 of 0:0[23]$/);
  });

  test("discards an audio clip on Escape, and a video clip on Cancel, putting focus back in the text", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await underText(ada, "Record audio clip").click();
    await expect(audioRecorder(ada).getByRole("button", { name: "Done" })).toBeFocused();
    await ada.page.keyboard.press("Escape");
    await expect(audioRecorder(ada)).toBeHidden();
    await expect(ada.composer()).toBeFocused();

    await underText(ada, "Record video clip").click();
    await videoRecorder(ada).getByRole("button", { name: "Record", exact: true }).click();
    await expect(videoRecorder(ada).getByRole("timer")).toBeVisible();
    await videoRecorder(ada).getByRole("button", { name: "Cancel" }).click();
    await expect(videoRecorder(ada)).toBeHidden();
    await expect(ada.composer()).toBeFocused();
    await expect(ada.page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  });

  test("offers the clips from + where the row has no room for their buttons: in a narrow composer, and on a phone, as Slack's app does", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    await expect(underText(ada, "Record video clip")).toBeVisible();
    await underText(ada, "Attach").click();
    await expect(attachChoices(ada)).toHaveText([/^Text snippet/, /^Upload from your computer/]);
    await ada.page.keyboard.press("Escape");
    // Gone, rather than fading out, when it opens again, taller, from where it was.
    await expect(ada.page.getByRole("menu")).toHaveCount(0);

    // As narrow as a huddle's thread, the row keeps to one line without them.
    await ada.page.locator("form.composer").evaluate((form) => (form.style.inlineSize = "280px"));
    await expect(underText(ada, "Record video clip")).toBeHidden();
    await expect(underText(ada, "Record audio clip")).toBeHidden();
    const [attach, send] = [await underText(ada, "Attach").boundingBox(), await underText(ada, "Send Message").boundingBox()];
    expect(send!.y).toBe(attach!.y);
    await underText(ada, "Attach").click();
    await expect(attachChoices(ada)).toHaveText([/^Text snippet/, /^Upload from your computer/, "Record a video clip", "Record an audio clip"]);
    await attachChoices(ada).filter({ hasText: "Record a video clip" }).click();
    await expect(videoRecorder(ada)).toBeVisible();
    await videoRecorder(ada).getByRole("button", { name: "Close" }).click();

    const grace = await members.signIn("Grace", { context: phone });
    await expect(underText(grace, "Record video clip")).toBeHidden();
    await underText(grace, "Attach").tap();
    await expect(attachChoices(grace)).toHaveText([/^Text snippet/, /^Upload from your computer/, "Record a video clip", "Record an audio clip"]);
    await attachChoices(grace).filter({ hasText: "Record an audio clip" }).tap();
    const done = audioRecorder(grace).getByRole("button", { name: "Done" });
    await expect(done).toBeEnabled();
    // Big enough for a fingertip.
    expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await done.tap();
    await expect(clipChip(grace, "Audio")).toBeVisible();
  });

  test("fits Record video clip on a phone", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: phone });
    await underText(ada, "Attach").tap();
    await attachChoices(ada).filter({ hasText: "Record a video clip" }).tap();
    const dialog = videoRecorder(ada);
    await expect(dialog.getByLabel("Your camera")).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(phone.viewport.width);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const name of ["Cancel", "Record"]) expect((await dialog.getByRole("button", { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
