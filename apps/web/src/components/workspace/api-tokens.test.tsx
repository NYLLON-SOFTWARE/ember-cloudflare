import type { ApiToken, ApiTokenCreated } from "@ember/protocol";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiTokens } from "./api-tokens";

const token = (id: string, name: string, at: number): ApiToken => ({ id, name, createdAt: at, lastUsedAt: null, revokedAt: null });
const made = (id: string, name: string): ApiTokenCreated => ({ ...token(id, name, 1_760_000_000_000), token: `pat_${id}` });

function renderSection(tokens: ApiToken[] = [], onFailed = vi.fn()) {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ tokens }));
  const view = render(<ApiTokens onFailed={onFailed} />);
  return { view, onFailed };
}
afterEach(() => vi.restoreAllMocks());

/** Fetch that keeps the list's answer and the making's back until the test lets them go: the list's read is the one without a method. */
function renderWaiting(onFailed = vi.fn()) {
  let resolveList!: (response: Response) => void;
  const list = new Promise<Response>((resolve) => (resolveList = resolve));
  let resolveMake!: (response: Response) => void;
  const making = new Promise<Response>((resolve) => (resolveMake = resolve));
  vi.spyOn(globalThis, "fetch").mockImplementation((_, init) => (init?.method === "POST" ? making : list));
  render(<ApiTokens onFailed={onFailed} />);
  const makeIt = async () => {
    await userEvent.type(screen.getByLabelText("Name the token for what it opens"), "Deploy bot");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    resolveMake(Response.json(made("t1", "Deploy bot")));
    await screen.findByTestId("made-token");
  };
  return { onFailed, resolveList, makeIt };
}

describe("API tokens on your profile", () => {
  it("lists your tokens, newest first, with when each was made and last used", async () => {
    renderSection([token("b", "Newer", 1_760_000_000_000), token("a", "Older", 1_750_000_000_000)]);
    const list = await screen.findByRole("list", { name: "API tokens" });
    expect([...list.children].map((row) => (row as HTMLElement).querySelector("strong")!.textContent)).toEqual(["Newer", "Older"]);
    expect(list).toHaveTextContent("never used");
  });

  it("makes one, showing its token once to copy, with a word that it won't be shown again", async () => {
    const { onFailed } = renderSection();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(made("t1", "Deploy bot")));
    await userEvent.type(screen.getByLabelText("Name the token for what it opens"), "Deploy bot");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    const shown = await screen.findByRole("status");
    expect(shown).toHaveTextContent("pat_t1");
    expect(screen.getByTestId("made-token")).toHaveTextContent("It won't be shown again.");
    expect(onFailed).not.toHaveBeenCalled();
    // It's on the list now, to revoke later.
    const list = screen.getByRole("list", { name: "API tokens" });
    expect(list).toHaveTextContent("Deploy bot");
  });

  it("keeps a token made before the list has loaded, once a list read before it arrives", async () => {
    const { resolveList, makeIt } = renderWaiting();
    await makeIt();
    // The list wasn't in yet, and the token is on it all the same.
    expect(screen.getByRole("list", { name: "API tokens" })).toHaveTextContent("Deploy bot");
    // The list, read before the token was made, arrives without it, which keeps it where it is.
    resolveList(Response.json({ tokens: [token("a", "Older", 1_750_000_000_000)] }));
    await screen.findByText("Older");
    const list = screen.getByRole("list", { name: "API tokens" });
    expect([...list.querySelectorAll("strong")].map((strong) => strong.textContent)).toEqual(["Deploy bot", "Older"]);
  });

  it("keeps a token revoked before the list has loaded off the list it arrives in", async () => {
    const { resolveList, makeIt } = renderWaiting();
    await makeIt();
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "API tokens" })).toBeNull());
    // The list, read after the token was made but before it was revoked, arrives with it, which keeps it off.
    resolveList(Response.json({ tokens: [token("t1", "Deploy bot", 1_760_000_000_000), token("a", "Older", 1_750_000_000_000)] }));
    await screen.findByText("Older");
    const list = screen.getByRole("list", { name: "API tokens" });
    expect(list).toHaveTextContent("Older");
    expect(list).not.toHaveTextContent("Deploy bot");
  });

  it("copies the token it just made", async () => {
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: clipboard }, configurable: true });
    renderSection();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(made("t1", "Deploy bot")));
    await userEvent.type(screen.getByLabelText("Name the token for what it opens"), "Deploy bot");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy token" }));
    expect(clipboard).toHaveBeenCalledWith("pat_t1");
  });

  it("revokes one once you confirm, which takes it off the list, and not before", async () => {
    renderSection([token("t1", "Deploy bot", 1_760_000_000_000)]);
    await screen.findByRole("list", { name: "API tokens" });
    const sure = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(sure).toHaveBeenCalledWith("Revoke this token? Anything opening with it stops working.");
    expect(screen.getByRole("list", { name: "API tokens" })).toHaveTextContent("Deploy bot");

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "API tokens" })).toBeNull());
  });

  it("says why loading failed", async () => {
    const onFailed = vi.fn();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("no network"));
    render(<ApiTokens onFailed={onFailed} />);
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
  });

  it("says why making one failed", async () => {
    const { onFailed } = renderSection();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));
    await userEvent.type(screen.getByLabelText("Name the token for what it opens"), "Deploy bot");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(screen.queryByTestId("made-token")).toBeNull();
  });

  it("says why revoking failed", async () => {
    const { onFailed } = renderSection([token("t1", "Deploy bot", 1_760_000_000_000)]);
    await screen.findByRole("list", { name: "API tokens" });
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(screen.getByRole("list", { name: "API tokens" })).toHaveTextContent("Deploy bot");
  });
});
