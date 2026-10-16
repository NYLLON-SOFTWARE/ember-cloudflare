import { feature } from "@ember/parity";
import { searchPath, type Me, type Message, type Room, type SearchResults, type User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { navigate } from "@/hooks/use-route";
import { CONFIRM_CLEAR_SEARCHES, SearchPage } from "./search-page";

const ada: Me = { id: "u1", name: "Ada Lovelace", administrator: false };
const grace: User = { id: "u2", name: "Grace Hopper" };
const general: Room = { id: "general", name: "general", kind: "open", icon: null };
const direct: Room = { id: "direct-1", kind: "direct", members: [{ id: ada.id, name: ada.name }, grace], activeAt: "2026-10-15T12:00:00.000Z" };

/** The message `id`, which `creator` wrote in `room`. */
const message = (id: string, room: Room, plainText: string, creator: User = grace): Message => ({
  id,
  clientMessageId: `c-${id}`,
  roomId: room.id,
  creator,
  body: bodyFromPlainText(plainText),
  plainText,
  mentions: [],
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  editedAt: null,
  boosts: [],
});

/** What a search for `query` answers, finding `messages`, with the rooms they're in. */
const results = (query: string | null, messages: Message[] = [], recent: string[] = []): SearchResults => ({
  query,
  messages,
  rooms: [general, direct].filter((room) => messages.some(({ roomId }) => roomId === room.id)),
  recent,
});

/** Answers the page's requests as `answer` does, given each one's method, address and what it sent. */
function serve(answer: (method: string, url: string, sent: unknown) => Response | Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) =>
    answer(init?.method ?? "GET", String(url), init?.body ? JSON.parse(String(init.body)) : undefined),
  );
}

/** The requests the page has made: each one's method and address, and what it sent, if anything. */
const requests = () =>
  vi.mocked(fetch).mock.calls.map(([url, init]) => [init?.method ?? "GET", url, ...(init?.body ? [JSON.parse(String(init.body))] : [])]);

/** A request's answer, held until `answer` gives it. */
const held = () => {
  let answer = (_: Response) => {};
  return { promise: new Promise<Response>((resolve) => (answer = resolve)), answer: (response: Response) => act(async () => answer(response)) };
};

/** The search page at `address`, as Ada sees it, opened from general. */
function showPage(address: string, { people = new Map() as People } = {}) {
  history.replaceState(null, "", "/rooms/general");
  navigate(address);
  const onFailed = vi.fn();
  render(
    <PeopleContext value={people}>
      <Sheet>
        <SearchPage me={ada} back="/rooms/general" onFailed={onFailed} />
      </Sheet>
    </PeopleContext>,
  );
  return { onFailed, user: userEvent.setup() };
}

const field = () => screen.getByRole("searchbox", { name: "search" });
const found = () => screen.findByRole("region", { name: "Search results" });
const recents = () => screen.queryByRole("group", { name: "Recent searches" });
const here = () => location.pathname + location.search;

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
  document.title = "";
});

describe(feature("search.page"), () => {
  it("says what it's for before anything's searched for, titled Search, with the field focused", async () => {
    serve(() => Response.json(results(null)));
    showPage("/searches");
    expect(await screen.findByRole("heading", { name: "Find a conversation" })).toBeVisible();
    expect(screen.getByText("Search messages across your rooms and direct messages.")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Search messages$/);
    expect(screen.getByRole("navigation", { name: "Page" })).not.toHaveTextContent("“");
    expect(document.title).toBe("Search");
    expect(field()).toHaveValue("");
    expect(field()).toHaveFocus();
    expect(recents()).toBeNull();
    expect(requests()).toEqual([["GET", "/api/searches"]]);
  });

  it("says when a search found nothing", async () => {
    serve(() => Response.json(results("zebra")));
    showPage(searchPath("zebra"));
    expect(await screen.findByRole("heading", { name: "No messages found" })).toBeVisible();
    expect(screen.getByText("Try a different word or phrase.")).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Page" })).toHaveTextContent(/“zebra”0$/);
    expect(screen.queryByRole("region", { name: "Search results" })).toBeNull();
  });

  it("is busy until the search has answered", async () => {
    const answer = held();
    serve(() => answer.promise);
    showPage(searchPath("hello"));
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    await answer.answer(Response.json(results("hello")));
    expect(screen.getByRole("main")).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("heading", { name: "No messages found" })).toBeVisible();
  });

  it("goes to the page without a search on Escape, as the field's × does, and back to the room it was opened from on Exit", async () => {
    serve((_, url) => Response.json(url === "/api/searches" ? results(null) : results("hello", [message("m1", general, "Hello")])));
    const { user } = showPage(searchPath("hello"));
    await found();
    expect(screen.getByRole("button", { name: "Clear search field" })).toHaveAttribute("href", "/searches");
    expect(screen.getByRole("link", { name: "Exit search" })).toHaveAttribute("href", "/rooms/general");

    await user.keyboard("{Escape}");
    expect(here()).toBe("/searches");
    expect(await screen.findByRole("heading", { name: "Find a conversation" })).toBeVisible();
    // The field is drawn afresh, empty and focused, as on any visit.
    expect(field()).toHaveValue("");
    expect(field()).toHaveFocus();
    expect(requests()).toEqual([
      ["GET", "/api/searches?q=hello"],
      ["GET", "/api/searches"],
    ]);
  });

  it("asks again on every visit, its own address's too, but goes nowhere on Escape with a modifier", async () => {
    serve(() => Response.json(results("hello")));
    const { user } = showPage(searchPath("hello"));
    await screen.findByRole("heading", { name: "No messages found" });
    act(() => navigate(searchPath("hello")));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await user.keyboard("{Shift>}{Escape}{/Shift}");
    expect(here()).toBe("/searches?q=hello");
  });

  it("says why a search failed", async () => {
    serve(() => Response.json({ error: "Searches can be up to 1,000 characters." }, { status: 422 }));
    const { onFailed } = showPage(searchPath("hello"));
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(onFailed.mock.calls[0]![0]).toMatchObject({ status: 422, message: "Searches can be up to 1,000 characters." });
  });
});

describe(feature("search.messages"), () => {
  it("shows the messages a search found, oldest first, each naming its room and linking to the message, which can't be changed", async () => {
    const hello = [message("m1", general, "Hello there"), message("m2", direct, "hello again", ada)];
    serve(() => Response.json(results("hello", hello)));
    showPage(searchPath("hello"));
    const shown = within(await found()).getAllByRole("article");
    expect(shown).toHaveLength(2);
    expect(within(shown[0]!).getByText("Hello there")).toBeVisible();
    expect(within(shown[0]!).getByRole("link", { name: "general" })).toHaveAttribute("href", "/rooms/general/@m1");
    // A DM is named after everyone in it, you too.
    expect(within(shown[1]!).getByText("hello again")).toBeVisible();
    expect(within(shown[1]!).getByRole("link", { name: "Ada Lovelace and Grace Hopper" })).toHaveAttribute("href", "/rooms/direct-1/@m2");
    expect(within(screen.getByRole("region", { name: "Search results" })).queryAllByRole("button")).toEqual([]);
    // The top bar says what was searched for and how many messages it found.
    expect(screen.getByRole("navigation", { name: "Page" })).toHaveTextContent(/Search messages“hello”2$/);
    expect(field()).toHaveValue("hello");
    expect(screen.getByRole("main")).not.toHaveAttribute("aria-busy");
    expect(requests()).toEqual([["GET", "/api/searches?q=hello"]]);
  });

  it("names the people in a DM as the people directory lists them now", async () => {
    serve(() => Response.json(results("hello", [message("m2", direct, "hello again")])));
    const renamed = { ...grace, name: "Grace Brewster Hopper", bio: null, role: "member", status: "active", avatarUrl: "/users/u2/avatar" } as const;
    showPage(searchPath("hello"), { people: new Map([[grace.id, renamed]]) });
    expect(within(await found()).getByRole("link", { name: "Ada Lovelace and Grace Brewster Hopper" })).toBeVisible();
  });

  it("scrolls to the newest message, at the bottom", async () => {
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(900);
    const scrolled = vi.spyOn(Element.prototype, "scrollTop", "set");
    serve(() => Response.json(results("hello", [message("m1", general, "Hello")])));
    showPage(searchPath("hello"));
    const list = await found();
    expect(scrolled).toHaveBeenCalledWith(900);
    expect(scrolled.mock.contexts).toContain(list);
  });
});

describe(feature("mentions.highlight"), () => {
  it("highlights the results that mention you, as the room does", async () => {
    const mentioning = { ...message("m1", general, "Thanks @Ada Lovelace"), mentions: [{ id: ada.id, name: ada.name }] };
    serve(() => Response.json(results("thanks", [mentioning, message("m2", general, "Thanks all")])));
    showPage(searchPath("thanks"));
    const [mentioned, other] = within(await found()).getAllByRole("article");
    expect(mentioned!.querySelector(".border-mention")).not.toBeNull();
    expect(other!.querySelector(".border-mention")).toBeNull();
  });
});

describe(feature("search.recent"), () => {
  it("lists your recent searches, newest first, each going to its search", async () => {
    serve((_, url) => Response.json(url === "/api/searches" ? results(null, [], ["hello  world", "café", "eel"]) : results("café", [], ["café"])));
    const { user } = showPage("/searches");
    await screen.findByRole("heading", { name: "Find a conversation" });
    const links = within(recents()!).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["“hello  world”", "/searches?q=hello++world"],
      ["“café”", "/searches?q=caf%C3%A9"],
      ["“eel”", "/searches?q=eel"],
    ]);

    await user.click(links[1]!);
    expect(here()).toBe("/searches?q=caf%C3%A9");
    expect(await screen.findByRole("heading", { name: "No messages found" })).toBeVisible();
    expect(field()).toHaveValue("café");
    expect(requests()).toEqual([
      ["GET", "/api/searches"],
      ["GET", "/api/searches?q=caf%C3%A9"],
    ]);
  });

  it("records a search as your newest and goes to its address, showing what it found without asking again", async () => {
    const hello = [message("m1", general, "Hello, world")];
    serve((method) => Response.json(method === "POST" ? results("Hello  world", hello, ["Hello  world"]) : results(null)));
    const { user } = showPage("/searches");
    await screen.findByRole("heading", { name: "Find a conversation" });
    await user.type(field(), "Hello, world{Enter}");
    expect(within(await found()).getByText("Hello, world")).toBeVisible();
    // As ember-rust's `search_path`, with its punctuation turned to spaces.
    expect(here()).toBe("/searches?q=Hello++world");
    expect(field()).toHaveValue("Hello  world");
    expect(within(recents()!).getByRole("link")).toHaveAttribute("href", "/searches?q=Hello++world");
    expect(requests()).toEqual([
      ["GET", "/api/searches"],
      ["POST", "/api/searches", { q: "Hello, world" }],
    ]);

    // Back and Forward ask afresh, as ember-rust's pages are drawn.
    act(() => history.back());
    expect(await screen.findByRole("heading", { name: "Find a conversation" })).toBeVisible();
    act(() => history.forward());
    await waitFor(() => expect(requests()).toHaveLength(4));
    expect(requests().slice(2)).toEqual([
      ["GET", "/api/searches"],
      ["GET", "/api/searches?q=Hello%20%20world"],
    ]);
  });

  it("asks nothing for an empty field", async () => {
    serve(() => Response.json(results(null)));
    const { user } = showPage("/searches");
    await screen.findByRole("heading", { name: "Find a conversation" });
    await user.type(field(), "{Enter}");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(requests()).toEqual([["GET", "/api/searches"]]);
    expect(here()).toBe("/searches");
  });

  it("keeps its button off while it searches", async () => {
    const answer = held();
    serve((method) => (method === "POST" ? answer.promise : Response.json(results(null))));
    const { user } = showPage("/searches");
    await screen.findByRole("heading", { name: "Find a conversation" });
    await user.type(field(), "eel{Enter}");
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    await answer.answer(Response.json(results("eel")));
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
    expect(here()).toBe("/searches?q=eel");
  });

  it("stays on a page gone to meanwhile", async () => {
    const answer = held();
    serve((method) => (method === "POST" ? answer.promise : Response.json(results(null))));
    const { user } = showPage("/searches");
    await screen.findByRole("heading", { name: "Find a conversation" });
    await user.type(field(), "eel{Enter}");
    act(() => navigate("/rooms/general"));
    await answer.answer(Response.json(results("eel")));
    expect(here()).toBe("/rooms/general");
  });

  it("says why a search couldn't be made, staying on the page", async () => {
    serve((method) => (method === "POST" ? Response.json({ error: "Something went wrong" }, { status: 500 }) : Response.json(results(null))));
    const { user, onFailed } = showPage("/searches");
    await screen.findByRole("heading", { name: "Find a conversation" });
    await user.type(field(), "eel{Enter}");
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(onFailed.mock.calls[0]![0]).toMatchObject({ status: 500 });
    expect(here()).toBe("/searches");
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
  });

  it("clears them with the broom once you confirm, going to the page without a search", async () => {
    let recent = ["eel", "hello"];
    serve((method, url) => {
      if (method !== "DELETE") return Response.json(results(url === "/api/searches" ? null : "eel", [], recent));
      recent = [];
      return new Response(null, { status: 204 });
    });
    const sure = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { user } = showPage(searchPath("eel"));
    await screen.findByRole("heading", { name: "No messages found" });
    await user.click(within(recents()!).getByRole("button", { name: "Clear recent searches" }));
    expect(sure).toHaveBeenCalledExactlyOnceWith(CONFIRM_CLEAR_SEARCHES);
    expect(requests()).toEqual([["GET", "/api/searches?q=eel"]]);

    await user.click(within(recents()!).getByRole("button", { name: "Clear recent searches" }));
    await waitFor(() => expect(recents()).toBeNull());
    expect(here()).toBe("/searches");
    expect(screen.getByRole("heading", { name: "Find a conversation" })).toBeVisible();
    expect(requests()).toEqual([
      ["GET", "/api/searches?q=eel"],
      ["DELETE", "/api/searches"],
      ["GET", "/api/searches"],
    ]);
  });
});
