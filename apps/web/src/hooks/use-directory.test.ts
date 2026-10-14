import { feature } from "@ember/parity";
import type { DirectoryUser } from "@ember/protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDirectory } from "./use-directory";

const ada: DirectoryUser = { id: "u1", name: "Ada", bio: null, role: "administrator", status: "active", avatarUrl: "/users/u1.abc/avatar?v=20261014120000" };
const grace: DirectoryUser = { id: "u2", name: "Grace", bio: "Compilers", role: "member", status: "active", avatarUrl: "/users/u2.def/avatar?v=20261014120000" };

/** Plays the server: the directory, with an ETag that changes with it, or no answer at all while `down`. */
const server = { users: [ada], version: 1, down: false };

async function answer(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (String(input) !== "/api/users") throw new Error(`No answer for ${String(input)}`);
  if (server.down) throw new TypeError("Failed to fetch");
  const etag = `W/"${server.version}"`;
  if (new Headers(init?.headers).get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return Response.json({ users: server.users }, { headers: { ETag: etag } });
}

/** The ETag each request named, null for none, in order. */
const requests = () => vi.mocked(fetch).mock.calls.map(([, init]) => new Headers(init?.headers).get("If-None-Match"));

/** Loads the directory again, and lets the answer render. */
const reload = (hook: { current: ReturnType<typeof useDirectory> }) => act(() => hook.current.reload());

beforeEach(() => {
  Object.assign(server, { users: [ada], version: 1, down: false });
  vi.stubGlobal("fetch", vi.fn(answer));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(feature("users.avatars"), () => {
  it("lists no one until it loads, then everyone by id", async () => {
    const { result } = renderHook(() => useDirectory());
    expect(result.current.people.size).toBe(0);
    await reload(result);
    expect(result.current.people.get("u1")).toEqual(ada);
  });

  it("keeps the people it has while the server says they're current, and takes them again when they change", async () => {
    const { result } = renderHook(() => useDirectory());
    await reload(result);
    const people = result.current.people;
    await reload(result);
    expect(result.current.people).toBe(people);

    Object.assign(server, { users: [ada, grace], version: 2 });
    await reload(result);
    expect([...result.current.people.keys()]).toEqual(["u1", "u2"]);
    expect(requests()).toEqual([null, 'W/"1"', 'W/"1"']);
  });

  it("keeps the people it has when a load fails", async () => {
    const { result } = renderHook(() => useDirectory());
    await reload(result);
    const people = result.current.people;
    server.down = true;
    await reload(result);
    expect(result.current.people).toBe(people);
  });
});
