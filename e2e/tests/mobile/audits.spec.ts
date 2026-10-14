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

test("a control scrolled partly out of view must still be big enough", async ({ page, safeArea }) => {
  // Neither list is scrolled far enough to show all of its button, and the audits don't scroll.
  const list = (label: string, size: number) => `
    <div style="height: 100px; overflow-y: auto">
      <div style="height: 80px"></div>
      <button aria-label="${label}" style="display: block; width: ${size}px; height: ${size}px"></button>
      <div style="height: 80px"></div>
    </div>`;
  await page.setContent(phonePage(`${list("Small", 32)}${list("Big", 44)}`));
  const { touchTargets } = await auditScreen(page, safeArea);
  expect(touchTargets).toEqual([expect.stringContaining('<button> "Small" is 32px×32px')]);
});

test("a small control scrolled partly out of view fails with a small label, but not wrapped in a big one", async ({ page, safeArea }) => {
  // Neither list is scrolled far enough to show all of its checkbox. A label only helps where a
  // fingertip on the checkbox would land on it.
  const list = (row: string) => `
    <div style="height: 100px; overflow-y: auto">
      <div style="height: 76px"></div>
      ${row}
      <div style="height: 80px"></div>
    </div>`;
  const checkbox = (id: string) => `<input type="checkbox" id="${id}" aria-label="${id}" style="margin: 0 0 0 14px; width: 16px; height: 16px">`;
  await page.setContent(
    phonePage(`
      ${list(`<div style="display: flex; align-items: center; height: 44px">${checkbox("Small")}<label for="Small" style="width: 12px; height: 16px"></label></div>`)}
      ${list(`<label style="display: flex; align-items: center; height: 44px">${checkbox("Wrapped")}Notify me</label>`)}
    `),
  );
  const { touchTargets } = await auditScreen(page, safeArea);
  expect(touchTargets).toEqual([expect.stringContaining('<input> "Small" is 16px×16px and partly scrolled out of view')]);
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

test("a control under something floating over its list must still be big enough once it's scrolled clear", async ({ page, safeArea }) => {
  // Both lists can scroll their button out from under the notice, but only one button fits a fingertip.
  const list = (label: string, size: number) => `
    <div style="position: relative; flex: 1; height: 200px">
      <div class="list" style="height: 100%; overflow-y: auto">
        <div style="height: 200px"></div>
        <button aria-label="${label}" style="display: block; margin: 0 auto; width: ${size}px; height: ${size}px"></button>
        <div style="height: 100px"></div>
      </div>
      <div style="position: absolute; inset: auto 0 0; height: 60px; background: Canvas">Floating notice</div>
    </div>`;
  await page.setContent(phonePage(`<div style="display: flex; gap: 8px">${list("Small", 32)}${list("Big", 44)}</div>`));
  await page.evaluate(() => document.querySelectorAll(".list").forEach((list) => (list.scrollTop = 48)));
  const { touchTargets } = await auditScreen(page, safeArea);
  expect(touchTargets).toEqual([expect.stringContaining('<button> "Small" is 32px×32px')]);
});

test("controls behind a modal dialog are skipped, but the dialog's own must be big enough", async ({ page, safeArea }) => {
  // A modal <dialog> makes the page behind it inert without marking it, as a menu's aria-hidden does.
  await page.setContent(
    phonePage(`
      <button aria-label="Behind" style="width: 44px; height: 44px"></button>
      <dialog style="padding: 16px">
        <div style="display: flex; gap: 40px">
          <button aria-label="Small" style="width: 32px; height: 32px"></button>
          <button aria-label="Big" style="width: 44px; height: 44px"></button>
        </div>
      </dialog>
    `),
  );
  await page.evaluate(() => document.querySelector("dialog")!.showModal());
  const { touchTargets } = await auditScreen(page, safeArea);
  expect(touchTargets).toEqual([expect.stringContaining('<button> "Small" is 32px×32px')]);
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
