/**
 * Loads `path` as a new page in place of this one: for the pages the Worker answers itself, such as
 * setup's, which the app can't show by changing its own address, and to start afresh once a session
 * ends, keeping nothing of it in memory.
 */
export function loadPage(path: string): void {
  location.replace(path);
}
