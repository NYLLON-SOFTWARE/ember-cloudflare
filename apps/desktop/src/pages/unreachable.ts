// What a site's window shows when the site doesn't load: its address follows the page's #, and
// ?problem=certificate says its certificate isn't one to trust, which trying again won't change.

const site = URL.parse(decodeURIComponent(location.hash.slice(1)));
const untrusted = new URLSearchParams(location.search).get("problem") === "certificate";
const heading = document.querySelector("h1")!;
const reason = document.querySelector("header p")!;

if (site !== null) {
  document.title = heading.textContent = `Can't reach ${site.host}`;
  const tryAgain = () => location.replace(site.origin);
  document.querySelector("button")!.addEventListener("click", tryAgain);
  if (!untrusted) addEventListener("online", tryAgain);
}
if (untrusted) reason.textContent = "Its security certificate isn't one the app can trust, so it won't open the site.";
