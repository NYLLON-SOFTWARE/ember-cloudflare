import { net } from "electron";
import type { Answer } from "./site-check.ts";

// Asking a site something through Chromium's network, as the site's window asks it for pages, but with
// none of a site's cookies, which are its window's: what the site answers, and where it redirects.

/**
 * The most of an answer that the app reads, well over what an Ember site's bootstrap says: its longest
 * part, the workspace's custom styles, is at most 100,000 characters, under 600 KB as JSON.
 */
const MOST_BYTES = 4 * 1024 * 1024;

/**
 * Asks for `url` as `net.fetch` would, following redirects, with the answer's `url` the address they took
 * the question to, which `net.fetch` leaves empty. Only an OK answer's body is read, and no more than
 * `MOST_BYTES` of it, so that however much a site sends, it can't fill the app's memory.
 */
export function fetchFollowing(url: string, init: RequestInit): Promise<Answer> {
  return new Promise((resolve, reject) => {
    let at = url;
    const request = net.request({ url, redirect: "manual", credentials: "omit" });
    // Once the answer has come, what fails then fails reading its body.
    let failReading = (_reason: unknown) => {};
    const fail = (reason: unknown) => {
      reject(reason);
      failReading(reason);
      request.abort();
    };
    new Headers(init.headers).forEach((value, name) => request.setHeader(name, value));
    request.on("redirect", (_status, _method, location) => {
      at = location;
      request.followRedirect();
    });
    request.on("response", (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        request.abort();
        return resolve({ url: at, ok: false, json: () => Promise.reject(new Error(`The site answered ${response.statusCode}`)) });
      }
      const body = new Promise<string>((resolveBody, rejectBody) => {
        failReading = rejectBody;
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("end", () => resolveBody(Buffer.concat(chunks).toString()));
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MOST_BYTES) fail(new Error(`The site answered more than ${MOST_BYTES} bytes`));
          else chunks.push(chunk);
        });
        response.on("aborted", () => rejectBody(new Error("The answer was cut off")));
        response.on("error", rejectBody);
      });
      // A body that fails before anything reads it is no unhandled rejection.
      body.catch(() => {});
      resolve({ url: at, ok: true, json: async () => JSON.parse(await body) as unknown });
    });
    request.on("error", fail);
    init.signal?.addEventListener("abort", () => fail(init.signal?.reason));
    request.end();
  });
}

/** Where asking for `url` redirects: the address its answer's Location gives, or null for an answer that doesn't redirect. */
export function redirectOf(url: string, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "manual", credentials: "omit" });
    const answer = (location: string | null) => {
      resolve(location);
      request.abort();
    };
    request.on("redirect", (_status, _method, location) => answer(location));
    request.on("response", () => answer(null));
    request.on("error", reject);
    signal.addEventListener("abort", () => {
      reject(signal.reason);
      request.abort();
    });
    request.end();
  });
}
