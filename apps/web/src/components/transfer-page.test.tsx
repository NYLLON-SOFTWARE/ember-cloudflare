import { feature } from "@ember/parity";
import type { Me } from "@ember/protocol";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPage } from "@/lib/page";
import { rememberThisPage } from "@/lib/return-path";
import { TransferPage } from "./transfer-page";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn() }));

const grace: Me = { id: "u2", name: "Grace Hopper", administrator: false };
const TRANSFER_ID = "u2.mgk3x2a9.Ab-_9z";

/** Answers the page's requests to sign in with `answers`, one each, in order. */
function serve(...answers: Array<() => Response>) {
  const fetch = vi.spyOn(globalThis, "fetch");
  for (const answer of answers) fetch.mockImplementationOnce(async () => answer());
  return fetch;
}

const signedIn = () => Response.json({ user: grace }, { status: 201 });
const unreachable = () => {
  throw new TypeError("Failed to fetch");
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadPage).mockClear();
  vi.useRealTimers();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

describe(feature("auth.sign-in-link"), () => {
  it("signs in with the link as soon as it opens, busy until it loads home as whoever the link is for", async () => {
    const fetch = serve(signedIn);
    render(<TransferPage transferId={TRANSFER_ID} />);
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/"));
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/session/transfers/${TRANSFER_ID}`, expect.objectContaining({ method: "PUT" }));
  });

  it("loads the page this tab was sent to sign in from instead, as ember-rust returns there", async () => {
    history.replaceState(null, "", "/rooms/r2?q=1#m3");
    rememberThisPage();
    serve(signedIn);
    render(<TransferPage transferId={TRANSFER_ID} />);
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/rooms/r2?q=1#m3"));
  });

  it("leaves the page blank when the link doesn't work, as ember-rust's empty answer does", async () => {
    serve(() => new Response(null, { status: 400 }));
    render(<TransferPage transferId={TRANSFER_ID} />);
    await waitFor(() => expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "false"));
    expect(screen.getByRole("main")).toBeEmptyDOMElement();
    expect(loadPage).not.toHaveBeenCalled();
  });

  it("tries again when it can't reach Ember, or Ember fails, waiting longer each time", async () => {
    vi.useFakeTimers();
    const fetch = serve(unreachable, () => Response.json({ error: "Something went wrong" }, { status: 500 }), signedIn);
    render(<TransferPage transferId={TRANSFER_ID} />);
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1_999));
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(loadPage).toHaveBeenCalledWith("/");
  });

  it("stops trying once it's gone", async () => {
    vi.useFakeTimers();
    const fetch = serve(unreachable);
    const { unmount } = render(<TransferPage transferId={TRANSFER_ID} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
