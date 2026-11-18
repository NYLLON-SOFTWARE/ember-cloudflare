// What a site's window shows when a page doesn't load: the address it couldn't reach follows the page's
// #, the site's own is ?site=, which trying again opens, and problem=certificate says the certificate
// isn't one to trust, which trying again won't change.

const query = new URLSearchParams(location.search);
const unreachable = URL.parse(decodeURIComponent(location.hash.slice(1)));
const site = URL.parse(query.get("site") ?? "") ?? unreachable;
const untrusted = query.get("problem") === "certificate";
const heading = document.querySelector("h1")!;
const reason = document.querySelector("header p")!;

if (unreachable !== null && site !== null) {
  document.title = heading.textContent = `Can't reach ${unreachable.host}`;
  const tryAgain = () => location.replace(site.origin);
  document.querySelector("button")!.addEventListener("click", tryAgain);
  if (!untrusted) addEventListener("online", tryAgain);
}
if (untrusted) reason.textContent = "Its security certificate isn't one the app can trust, so it won't open the site.";
