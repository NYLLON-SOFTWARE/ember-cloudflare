import { net } from "electron";
import type { Answer } from "./site-check.ts";

// Asking a site something through Chromium's network, as the site's window asks it for pages, but with
// none of a site's cookies, which are its window's: what the site answers, and where it redirects.

/**
 * Asks for `url` as `net.fetch` would, following redirects, with the answer's `url` the address they took
 * the question to, which `net.fetch` leaves empty.
 */
export function fetchFollowing(url: string, init: RequestInit): Promise<Answer> {
  return new Promise((resolve, reject) => {
    let at = url;
    const request = net.request({ url, redirect: "manual", credentials: "omit" });
    new Headers(init.headers).forEach((value, name) => request.setHeader(name, value));
    request.on("redirect", (_status, _method, location) => {
      at = location;
      request.followRedirect();
    });
    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        resolve({ url: at, ok: response.statusCode >= 200 && response.statusCode < 300, json: async () => JSON.parse(body) as unknown });
      });
    });
    request.on("error", reject);
    init.signal?.addEventListener("abort", () => {
      reject(init.signal?.reason);
      request.abort();
    });
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
