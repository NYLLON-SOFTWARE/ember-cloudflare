// ember-rust's setup_access.js (crates/assets/overrides/setup_access.js), line for line: it trades
// the private setup link's token for the cookie that unlocks setup. There's no installer to print
// the link here, so its message names the deployment instead.

export const NO_LINK = "Open the complete private HTTPS setup link for this deployment.";
export const UNAVAILABLE = "This setup link is unavailable. Request the current link from the server administrator.";
export const OFFLINE = "Could not open setup. Check your connection and reopen the private link.";

/** Opens setup with the token in this page's fragment, or says in `status` why it can't. */
export async function openSetup(status: HTMLElement): Promise<void> {
  // Setup tokens travel in the fragment, never a request URL or a stored browser value.
  const fragment = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const token = new URLSearchParams(fragment).get("token") ?? "";

  if (location.protocol !== "https:" || !/^[a-f0-9]{64}$/.test(token)) {
    status.textContent = NO_LINK;
    return;
  }
  try {
    const response = await fetch("/first_run/access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
    });
    if (response.status === 204) location.replace("/first_run");
    else if (response.type === "opaqueredirect") location.replace("/");
    else status.textContent = UNAVAILABLE;
  } catch {
    status.textContent = OFFLINE;
  }
}
