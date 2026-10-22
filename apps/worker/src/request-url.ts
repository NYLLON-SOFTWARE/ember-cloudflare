// A request's URL, parsed once however many places read it. Every answer reads it several times,
// for its path, its host and whether it came over HTTPS, and profiles showed the parsing costing a
// cheap request more than anything else the Worker did for it.

const parsed = new WeakMap<Request, URL>();

/** `request.url`, parsed. Every reader shares it, so it's read-only: make a new URL to change one. */
export function urlOf(request: Request): URL {
  let url = parsed.get(request);
  if (!url) parsed.set(request, (url = new URL(request.url)));
  return url;
}
