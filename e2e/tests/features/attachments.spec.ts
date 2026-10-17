import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { feature } from "@ember/parity";
import { uploadPartPath, uploadsPath, type Message, type Upload } from "@ember/protocol";
import type { APIRequestContext, Locator } from "@playwright/test";
import { cookieHeader } from "../../fixtures";
import { expect, test, type Member } from "./fixtures";

/**
 * Uploads `content` as a file called `name` to `roomId` for `member`, in one part and without a preview,
 * as a bot's files come, and returns the message the room posts it as.
 */
async function upload(request: APIRequestContext, member: Member, roomId: string, name: string, content: string | Buffer, type = "text/plain"): Promise<Message> {
  const headers = { Cookie: cookieHeader(member.session) };
  const file = { name, type, size: typeof content === "string" ? new TextEncoder().encode(content).length : content.length, clientMessageId: crypto.randomUUID() };
  const started = await request.post(uploadsPath(roomId), { data: file, headers });
  expect(started.status(), await started.text()).toBe(201);
  const { id } = (await started.json()) as Upload;
  const finished = await request.put(uploadPartPath(roomId, id, 1), { data: content, headers });
  expect(finished.status(), await finished.text()).toBe(201);
  return (await finished.json()) as Message;
}

/** A picture `width` by `height`, drawn in `member`'s browser as a PNG, as Playwright picks it. */
async function picture(member: Member, name: string, width: number, height: number) {
  const bytes = await member.page.evaluate(
    async ([width, height]) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#c33";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#33c";
      context.fillRect(0, 0, width / 2, height / 2);
      return [...new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer())];
    },
    [width, height] as const,
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(bytes) };
}

/** A second of video, 320 by 180, as a WebM file that Chromium plays. */
const clip = resolve(import.meta.dirname, "files/clip.webm");

/** The width and height of the box `locator` takes up. */
async function sizeOf(locator: Locator): Promise<[number, number]> {
  const box = await locator.boundingBox();
  return [box!.width, box!.height];
}

/** The link on a file message's card that downloads its file. */
const downloadLink = (member: Member, name: string) => member.message(name).getByRole("link", { name: `Download ${name}` });

/** Composer's Attach files, its file field. */
const attachFiles = (member: Member) => member.page.getByLabel("Attach a file");

/** The files waiting in `member`'s composer, by the chips that take them back out. */
const chips = (member: Member) => member.page.getByRole("button", { name: /^Remove / });

/** A text file called `name` that says `text`, as Playwright picks it. */
const textFile = (name: string, text: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });

/** Drops a text file called `name` that says `text` on `target`, as dragging one from the desktop does. */
const dropFile = (target: Locator, name: string, text: string) =>
  target.evaluate(
    (element, [name, text]) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([text], name, { type: "text/plain" }));
      for (const type of ["dragenter", "dragover", "drop"]) element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    },
    [name, text] as const,
  );

/** Downloads the file of `member`'s file message `name`, answering what it says. */
async function downloaded(member: Member, name: string): Promise<string> {
  const [download] = await Promise.all([member.page.waitForEvent("download"), downloadLink(member, name).click()]);
  return readFile(await download.path(), "utf8");
}

test.describe(feature("attachments.upload"), () => {
  test("shows a file uploaded to a room as its uploader's message, to everyone in it at once and after a reload", async ({ members, request, rooms }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await upload(request, ada, rooms.general.id, "Q3 report.txt", "Up and to the right");

    for (const member of [ada, grace]) {
      await expect(member.message("Q3 report.txt")).toContainText("Ada");
      await expect(downloadLink(member, "Q3 report.txt")).toBeVisible();
    }
    await grace.page.reload();
    await grace.connected();
    await expect(downloadLink(grace, "Q3 report.txt")).toBeVisible();
  });

  test("sends the files picked with Attach files with the text written, each as a message of its own, in order of their names", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await attachFiles(ada).setInputFiles([textFile("b.txt", "Bee"), textFile("a.txt", "Ay")]);
    await expect(chips(ada)).toHaveCount(2);
    await expect(chips(ada).first()).toHaveAccessibleName("Remove a.txt");
    await expect(chips(ada).last()).toHaveAccessibleName("Remove b.txt");

    await ada.send("Two files");
    await expect(chips(ada)).toHaveCount(0);
    for (const member of [ada, grace]) {
      await expect(downloadLink(member, "b.txt")).toBeVisible();
      const messages = await member.page.getByRole("article").allInnerTexts();
      const at = (text: string) => messages.findIndex((message) => message.includes(text));
      expect(at("Two files")).toBeGreaterThanOrEqual(0);
      expect(at("a.txt")).toBeLessThan(at("b.txt"));
    }
    expect(await downloaded(grace, "a.txt")).toBe("Ay");
  });

  test("waits to send the files pasted into the composer or dropped on it or on the room's messages", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.connected();
    await ada.composer().evaluate((content) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File(["Pasted"], "pasted.txt", { type: "text/plain" }));
      content.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await dropFile(ada.composer(), "on the composer.txt", "Dropped on the composer");
    await dropFile(ada.timeline(), "on the messages.txt", "Dropped on the messages");
    await expect(chips(ada)).toHaveCount(3);
    // None of them goes in the text.
    await expect(ada.composer()).toHaveText("");
    await expect(ada.composer().locator("img, action-text-attachment, figure")).toHaveCount(0);

    await ada.page.getByRole("button", { name: "Send Message" }).click();
    expect(await downloaded(ada, "on the messages.txt")).toBe("Dropped on the messages");
    for (const name of ["pasted.txt", "on the composer.txt"]) await expect(downloadLink(ada, name)).toBeVisible();
  });
});

test.describe(feature("attachments.previews"), () => {
  test("shows a picture by the thumbnail its uploader's browser makes, to everyone, in a box half its size up to 480px wide", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await attachFiles(ada).setInputFiles(await picture(ada, "mural.png", 2400, 1600));
    await ada.page.getByRole("button", { name: "Send Message" }).click();

    for (const member of [ada, grace]) {
      const link = member.page.getByRole("link", { name: "mural.png" });
      await expect(link).toHaveAttribute("href", /^\/files\/[0-9a-z]+\/[\w-]+\/mural\.png$/);
      const thumbnail = link.getByRole("img", { name: "mural.png" });
      await expect(thumbnail).toHaveAttribute("src", /^\/previews\/[0-9a-z]+\/[\w-]+\/mural\.png$/);
      // Scaled down to fit 1200×800, and shown at half that, 480px wide at most.
      await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1200, 800]);
      expect(await sizeOf(link)).toEqual([480, 320]);
      await expect(member.page.getByRole("link", { name: "Download mural.png" })).toHaveCount(0);
    }
    const preview = await ada.page.request.get((await ada.page.getByRole("img", { name: "mural.png" }).getAttribute("src"))!);
    expect(preview.headers()["content-type"]).toBe("image/webp");
  });

  test("plays a video in place, in a box half its size, behind the poster its uploader's browser makes, loading nothing until it's played", async ({ members, request }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await attachFiles(ada).setInputFiles(clip);
    await ada.page.getByRole("button", { name: "Send Message" }).click();

    for (const member of [ada, grace]) {
      const video = member.page.getByRole("article").locator("video");
      await expect(video).toHaveAccessibleName("clip.webm");
      await expect(video).toHaveAttribute("src", /^\/files\/[0-9a-z]+\/[\w-]+\/clip\.webm$/);
      await expect(video).toHaveAttribute("poster", /^\/previews\/[0-9a-z]+\/[\w-]+\/clip\.webm$/);
      await expect(video).toHaveAttribute("preload", "none");
      expect(await sizeOf(video)).toEqual([160, 90]);
      // HAVE_NOTHING: none of it has loaded.
      expect(await video.evaluate((element: HTMLVideoElement) => element.readyState)).toBe(0);
    }
    const poster = await request.get((await ada.page.locator("video").getAttribute("poster"))!);
    expect(poster.headers()["content-type"]).toBe("image/webp");
  });

  test("shows a picture without a thumbnail, as a bot's, as itself, and a file the browser couldn't make one of as its card", async ({ members, request, rooms }) => {
    const ada = await members.signIn("Ada");
    const { buffer } = await picture(ada, "dot.png", 40, 20);
    const { attachment } = await upload(request, ada, rooms.general.id, "dot.png", buffer, "image/png");
    const dot = ada.page.getByRole("img", { name: "dot.png" });
    await expect(dot).toHaveAttribute("src", attachment!.url);
    expect(await sizeOf(ada.page.getByRole("link", { name: "dot.png" }))).toEqual([20, 10]);

    // Chromium can't decode HEIC, so this one goes without.
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(12)]);
    await attachFiles(ada).setInputFiles({ name: "photo.heic", mimeType: "image/heic", buffer: heic });
    await ada.page.getByRole("button", { name: "Send Message" }).click();
    await expect(downloadLink(ada, "photo.heic")).toBeVisible();
    await expect(ada.page.getByRole("img", { name: "photo.heic" })).toHaveCount(0);
  });
});

test.describe(feature("attachments.progress"), () => {
  test("shows each upload's card until the room posts its file, and why one failed", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const parts = "**/uploads/*/parts/*";
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await ada.page.route(parts, async (route) => {
      await held;
      await route.continue();
    });
    await attachFiles(ada).setInputFiles(textFile("slow.txt", "Slow"));
    await ada.page.getByRole("button", { name: "Send Message" }).click();
    const card = ada.page.getByRole("group", { name: "Upload slow.txt" });
    await expect(card).toContainText("slow.txt1 KB");
    await expect(card.getByRole("progressbar", { name: "Upload progress for slow.txt" })).toBeVisible();
    await expect(grace.message("slow.txt")).toHaveCount(0);

    release();
    await expect(card).toHaveCount(0);
    for (const member of [ada, grace]) await expect(downloadLink(member, "slow.txt")).toBeVisible();

    // A part the Worker won't take fails its upload, whose card stays saying why.
    await ada.page.unroute(parts);
    await ada.page.route(parts, (route) => route.fulfill({ status: 500 }));
    await attachFiles(ada).setInputFiles(textFile("broken.txt", "Broken"));
    await ada.page.getByRole("button", { name: "Send Message" }).click();
    const failed = ada.page.getByRole("group", { name: "Upload broken.txt" });
    await expect(failed.getByRole("alert")).toHaveText("Upload failed. Please attach the file and try again.");
    await expect(failed.getByRole("status")).toHaveText("Upload failed");
    await expect(grace.message("broken.txt")).toHaveCount(0);
  });
});

test.describe(feature("attachments.download-share"), () => {
  test("downloads a file message's file from its card, and offers Download on its action bar in place of Reply", async ({ members, request, rooms }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const { attachment } = await upload(request, ada, rooms.general.id, "Q3 report.txt", "Up and to the right");

    const [download] = await Promise.all([grace.page.waitForEvent("download"), downloadLink(grace, "Q3 report.txt").click()]);
    expect(download.suggestedFilename()).toBe("Q3 report.txt");
    expect(await readFile(await download.path(), "utf8")).toBe("Up and to the right");

    const bar = await grace.actions("Q3 report.txt");
    await expect(bar.getByRole("link", { name: "Download" })).toHaveAttribute("href", attachment!.downloadUrl);
    await expect(bar.getByRole("button", { name: "Reply" })).toHaveCount(0);
  });
});

test.describe(feature("messages.delete"), () => {
  test("deletes a file message from its editor, which shows its file where a message's text would be", async ({ members, request, rooms }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await upload(request, ada, rooms.general.id, "Draft.txt", "Not yet");
    await expect(grace.message("Draft.txt")).toBeVisible();

    await (await ada.actions("Draft.txt")).getByRole("button", { name: "Edit" }).click();
    await expect(ada.page.getByRole("button", { name: "Delete message" })).toBeFocused();
    await expect(ada.editor()).toHaveCount(0);
    await expect(downloadLink(ada, "Draft.txt")).toBeVisible();

    ada.page.once("dialog", (dialog) => void dialog.accept());
    await ada.page.getByRole("button", { name: "Delete message" }).click();
    await expect(grace.message("Draft.txt")).toHaveCount(0);
    await expect(ada.message("Draft.txt")).toHaveCount(0);
  });
});
