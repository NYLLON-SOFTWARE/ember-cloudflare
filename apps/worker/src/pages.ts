import type { Env } from "./env";

// What the Worker answers for the pages it serves itself, such as setup's and the join link's, and
// for their forms, which post to the API.

/** One of the built app's pages, from its static assets, with headers this response can change. */
export async function appPage(request: Request, env: Env, path: string): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL(path, request.url), { method: request.method }));
  return new Response(page.body, page);
}

export const empty = (status: number) => new Response(null, { status });

export function withCookies(response: Response, ...cookies: Array<string | null>): Response {
  for (const cookie of cookies) if (cookie) response.headers.append("Set-Cookie", cookie);
  return response;
}

/** Sends the browser to the app's home page. */
export const home = (request: Request) => new Response(null, { status: 302, headers: { Location: new URL("/", request.url).href } });

/** A form's answer, which no cache keeps, since it can sign someone in. */
export const formAnswer = (data: unknown, status: number, ...cookies: Array<string | null>) =>
  withCookies(Response.json(data, { status, headers: { "Cache-Control": "no-store" } }), ...cookies);
