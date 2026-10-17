import { readFile } from "node:fs/promises";
import { feature } from "@ember/parity";
import { uploadPartPath, uploadsPath, type Message, type Upload } from "@ember/protocol";
import type { APIRequestContext } from "@playwright/test";
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
