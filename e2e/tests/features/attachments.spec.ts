import { readFile } from "node:fs/promises";
import { feature } from "@ember/parity";
import { uploadPartPath, uploadsPath, type Message, type Upload } from "@ember/protocol";
import type { APIRequestContext, Locator } from "@playwright/test";
import { cookieHeader } from "../../fixtures";
import { expect, test, type Member } from "./fixtures";

/**
 * Uploads `text` as a text file called `name` to `roomId` for `member`, in one part, as the composer
 * will, and returns the message the room posts it as.
 */
async function upload(request: APIRequestContext, member: Member, roomId: string, name: string, text: string): Promise<Message> {
  const headers = { Cookie: cookieHeader(member.session) };
  const file = { name, type: "text/plain", size: new TextEncoder().encode(text).length, clientMessageId: crypto.randomUUID() };
  const started = await request.post(uploadsPath(roomId), { data: file, headers });
  expect(started.status(), await started.text()).toBe(201);
  const { id } = (await started.json()) as Upload;
  const finished = await request.put(uploadPartPath(roomId, id, 1), { data: text, headers });
  expect(finished.status(), await finished.text()).toBe(201);
  return (await finished.json()) as Message;
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
