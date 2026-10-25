import { escapeHtml } from "./encoding";
import type { Email } from "./mail";

// The emails Ember sends (`platform.email`), each as plain text and as simple HTML, with nothing that
// tracks whether it was opened. All an administrator wrote in them is the workspace's name.

/** `text` on one line, as a subject must be: line breaks and other control characters become spaces. */
const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

/** An email's HTML: its paragraphs, each given as HTML, in Ember's sans-serif. */
const htmlOf = (paragraphs: string[]) =>
  `<!doctype html><html><body style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 16px; line-height: 1.5;">${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("")}</body></html>`;

/** The email Send me a test email sends an administrator, at `to`, from the workspace named `workspace`, whose Ember is at `origin`. */
export function testEmail(to: string, workspace: string, origin: string): Email {
  const name = oneLine(workspace) || "Ember";
  return {
    to,
    subject: `Test email from ${name}`,
    text: `This is a test email from ${name}, at ${origin}.\n\nIt reached you, so Ember can send email.\n`,
    html: htmlOf([`This is a test email from ${escapeHtml(name)}, at <a href="${escapeHtml(origin)}">${escapeHtml(origin)}</a>.`, "It reached you, so Ember can send email."]),
  };
}
