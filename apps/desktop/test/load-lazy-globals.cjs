// Run in the app's main process ahead of the app, by the tests (fixtures.ts). Node loads the `performance`
// and `AbortSignal` globals the first time they're read, and Playwright reads both as it first runs code in
// the app, through Node's inspector, which runs it in the middle of whatever the app is doing. Read as Node
// is loading one for the app, the global is undefined from then on, and without `performance` neither can
// Node's fetch load, nor the Response the app serves its own pages with: Add Site opens blank. Read here,
// both are loaded before the app or Playwright reads them.
void globalThis.performance;
void globalThis.AbortSignal;
