import { auditScreen } from "./audits";
import { expect, test } from "./fixtures";

// Every other test leans on the audits, so check they catch what they should and nothing else.

/** A page laid out at the phone's width, as the app is. */
const phonePage = (body: string) => `<meta name="viewport" content="width=device-width, initial-scale=1">${body}`;

test("a control cut off for good fails, but not one scrolled partly out of view", async ({ page, safeArea }) => {
  await page.setContent(
    phonePage(`
      <div style="height: 24px; overflow: hidden"><button aria-label="Cut off" style="width: 44px; height: 44px"></button></div>
      <div style="height: 100px; overflow-y: auto">
        <div style="height: 80px"></div>
        <button aria-label="Scrolled" style="width: 44px; height: 44px"></button>
        <div style="height: 80px"></div>
      </div>
    `),
  );
  const { overflow, touchTargets } = await auditScreen(page, safeArea);
  expect(overflow).toEqual([expect.stringContaining('<button> "Cut off" spans')]);
  expect(touchTargets).toEqual([expect.stringContaining('<button> "Cut off" is 44px×44px (44px×24px of it shows)')]);
});

test("a control covered for good by something floating over its list fails, but not one the list can scroll clear", async ({ page, safeArea }) => {
  // The last button in each list sits under a floating notice; only the second list has room to
  // scroll it out from under.
  const list = (label: string, room: number) => `
    <div style="position: relative; flex: 1; height: 200px">
      <div class="list" style="height: 100%; overflow-y: auto">
        <div style="height: 200px"></div>
        <button aria-label="${label}" style="display: block; width: 100%; height: 48px"></button>
        <div style="height: ${room}px"></div>
      </div>
      <div style="position: absolute; inset: auto 0 0; height: 60px; background: Canvas">Floating notice</div>
    </div>`;
  await page.setContent(phonePage(`<div style="display: flex; gap: 8px">${list("Covered", 0)}${list("Clear", 60)}</div>`));
  await page.evaluate(() => document.querySelectorAll(".list").forEach((list) => (list.scrollTop = 48)));
  const { touchTargets } = await auditScreen(page, safeArea);
  expect(touchTargets).toEqual([expect.stringContaining('<button> "Covered" is')]);
});

test("text cut off for good fails, but not text clamped on purpose", async ({ page, safeArea }) => {
  await page.setContent(
    phonePage(`
      <p style="width: 120px; height: 20px; line-height: 20px; overflow: hidden">Cut off after one line, though it runs to several</p>
      <p style="width: 120px; line-height: 20px; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1">Clamped to one line, though it runs to several</p>
    `),
  );
  const { overflow } = await auditScreen(page, safeArea);
  expect(overflow).not.toEqual([]);
  for (const problem of overflow) expect(problem).toContain('text in <p> "Cut off after one line');
});
