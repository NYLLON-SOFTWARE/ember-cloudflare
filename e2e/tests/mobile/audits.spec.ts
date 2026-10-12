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
