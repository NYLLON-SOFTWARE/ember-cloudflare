import { createHash } from "node:crypto";
import { feature } from "@ember/parity";
import { expect, test } from "./fixtures";

/**
 * The SHA-256 of each icon the manifest lists, as ember-rust has them: its own app icons
 * (crates/assets/overrides/logos/) and, for the shortcuts, Campfire's (app/assets/images/).
 */
const ICONS: Record<string, string> = {
  "/logos/app-icon-192.png": "49ff9160e2e167043fe948e7b78695c1b55270dff701479ebc6f574eedff6126",
  "/logos/app-icon.png": "d93bfb957863d1aca5ab6ca4e2f81d592e5ed101df6850b89ac792f6f67d88f3",
  "/shortcuts/add.svg": "c2432767c10fa24794ff0242addab3ddf810662e15ed837ed805394b2a131b74",
  "/shortcuts/person.svg": "48ac49f6bc4440a0f8888578e8af68f7b4fa3f7b62484a80888d5a473e02b306",
};

interface Manifest {
  icons: Array<{ src: string }>;
  shortcuts: Array<{ icons: Array<{ src: string }> }>;
}

test.describe(feature("platform.manifest"), () => {
  test("Chrome reads the manifest the page links without errors, and can install Ember", async ({ playwright, baseURL }) => {
    // Chrome installs nothing from an incognito window, which every context Playwright opens is, so
    // this opens a profile of its own.
    const context = await playwright.chromium.launchPersistentContext("", { baseURL, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const logged: string[] = [];
      page.on("console", (message) => logged.push(message.text()));
      await page.goto("/session/new");
      const cdp = await context.newCDPSession(page);
      const { url, errors } = await cdp.send("Page.getAppManifest", {});
      expect(url).toBe(new URL("/webmanifest.json", baseURL).href);
      expect(errors).toEqual([]);
      await expect.poll(async () => (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors).toEqual([]);
      // Chrome warns that apple-mobile-web-app-capable is deprecated unless mobile-web-app-capable is there too.
      expect(logged.filter((text) => text.includes("web-app-capable"))).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("lists ember-rust's icons, and Campfire's for its shortcuts, byte for byte", async ({ request }) => {
    const manifest = (await (await request.get("/webmanifest.json")).json()) as Manifest;
    const sources = [...manifest.icons, ...manifest.shortcuts.flatMap((shortcut) => shortcut.icons)].map((icon) => icon.src);
    expect(new Set(sources)).toEqual(new Set(Object.keys(ICONS)));
    for (const source of sources) {
      const response = await request.get(source);
      expect(response.status(), source).toBe(200);
      expect(createHash("sha256").update(await response.body()).digest("hex"), source).toBe(ICONS[source]);
    }
  });
});

test.describe(feature("platform.head-tags"), () => {
  test("every page links the manifest and Ember's icons, with ember-rust's theme colors", async ({ page, request }) => {
    for (const path of ["/", "/session/new", "/rooms/all-talk"]) {
      const html = await (await request.get(path)).text();
      // The page as the server sends it, since its script recolors the theme at once (ui.appearance).
      const tags = await page.evaluate((html) => {
        const head = new DOMParser().parseFromString(html, "text/html").head;
        const tags = head.querySelectorAll('meta[name="theme-color"], meta[name$="mobile-web-app-capable"], link[rel="manifest"], link[rel="icon"], link[rel="apple-touch-icon"]');
        return [...tags].map((tag) => Object.fromEntries([...tag.attributes].map(({ name, value }) => [name, value])));
      }, html);
      expect(tags, path).toEqual([
        { name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" },
        { name: "theme-color", content: "#000000", media: "(prefers-color-scheme: dark)" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "mobile-web-app-capable", content: "yes" },
        { rel: "manifest", href: "/webmanifest.json" },
        { rel: "icon", type: "image/png", sizes: "48x48", href: "/logos/app-icon-48.png" },
        { rel: "apple-touch-icon", href: "/logos/app-icon.png" },
      ]);
    }
  });
});
