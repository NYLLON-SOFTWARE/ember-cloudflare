import { Launcher } from "chrome-launcher";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import type { Session } from "../room-client.ts";

/** Chrome from CHROME_PATH, or wherever chrome-launcher finds an installed one. */
export function chromePath(): string {
  const found = Launcher.getFirstInstallation();
  if (!found) throw new Error("No Chrome found. Install Chrome, or set CHROME_PATH to a Chrome or Chromium binary.");
  return found;
}

export function launchChrome(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    // Chrome's sandbox refuses to run as root, which is how containers usually run.
    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
    defaultViewport: { width: 1280, height: 800 },
  });
}

/**
 * Signs the page in the way the app remembers a session, by visiting a JSON endpoint on the same
 * origin rather than the app itself, so the app's assets stay out of the HTTP cache.
 */
export async function signInPage(page: Page, origin: string, session: Session): Promise<void> {
  await page.goto(new URL("/api/health", origin).href);
  await page.evaluate((value) => localStorage.setItem("ember:session", value), JSON.stringify(session));
}
