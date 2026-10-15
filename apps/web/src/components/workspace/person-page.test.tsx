import { feature } from "@ember/parity";
import type { DirectoryUser, Me, Person, User } from "@ember/protocol";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cancel from "@/components/icons/campfire/cancel.svg";
import messages from "@/components/icons/campfire/messages.svg";
import { Sheet } from "@/components/ui/sheet";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { guardLeaving, navigate } from "@/hooks/use-route";
import { PersonPage } from "./person-page";

const ada: Me = { id: "u1", name: "Ada Lovelace", administrator: false };
const grace: Person = { id: "u2", name: "Grace Hopper", bio: "Wrote the first compiler", role: "member", status: "active", avatarUrl: "/users/t2/avatar?v=1" };
const bender: Person = { id: "u3", name: "Bender", bio: null, role: "bot", status: "active", avatarUrl: "/users/t3/avatar?v=1" };

/** Answers the page's request for someone with `answer`, once the returned function is called if it's held. */
function serve(answer: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => answer());
}

const found = (person: Person) => () => Response.json({ person });

interface Shown {
  me?: Me;
  people?: People;
  /** What starting a DM settles with, rather than that it did. */
  started?: () => Promise<boolean>;
}

/** Someone's page as `me` sees it, opened from general. */
function showPage(person: Person | string, { me = ada, people = new Map(), started = async () => true }: Shown = {}) {
  const userId = typeof person === "string" ? person : person.id;
  const [onMissing, onFailed] = [vi.fn(), vi.fn()];
  const onStartDirect = vi.fn<(person: User) => Promise<boolean>>(started);
  let shown = { me, people };
  const view = () => (
    <PeopleContext value={shown.people}>
      <Sheet>
        <PersonPage userId={userId} me={shown.me} onStartDirect={onStartDirect} onMissing={onMissing} onFailed={onFailed} />
      </Sheet>
    </PeopleContext>
  );
  const { rerender } = render(view());
  const show = (changes: Partial<typeof shown>) => {
    shown = { ...shown, ...changes };
    rerender(view());
  };
  return { onStartDirect, onMissing, onFailed, list: (people: People) => show({ people }), become: (me: Me) => show({ me }), user: userEvent.setup() };
}

const heading = () => screen.findByRole("heading", { level: 1 });
const avatar = () => screen.findByRole("img", { name: "Profile avatar" });
const directButton = (name: string) => screen.queryByRole("button", { name: `Ping ${name}` });
const mailLink = () => screen.queryByRole("link", { name: /@/ });

beforeEach(() => {
  history.replaceState(null, "", "/rooms/general");
  navigate(`/users/${grace.id}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
  document.title = "";
});

describe(feature("users.show"), () => {
  it("shows someone's avatar, name and bio, titled with their name, with Go Back to where it was opened from", async () => {
    serve(found(grace));
    showPage(grace, { people: new Map([[grace.id, grace]]) });
    expect(await heading()).toHaveTextContent("Grace Hopper");
    expect(document.title).toBe("Grace Hopper");
    expect(screen.getByText("Wrote the first compiler")).toBeVisible();
    expect(await avatar()).toHaveAttribute("src", grace.avatarUrl);
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/rooms/general");
    expect(vi.mocked(fetch).mock.calls).toEqual([["/api/users/u2", expect.anything()]]);
    // Only your own page has the pencil, and only administrators are told an email address.
    expect(screen.queryByRole("link", { name: "Edit my profile" })).toBeNull();
    expect(mailLink()).toBeNull();
  });

  it("goes back home when the app didn't open it, and asks for ids escaped", async () => {
    history.replaceState(null, "", "/users/caf%C3%A9");
    serve(found({ ...grace, id: "café" }));
    showPage("café");
    expect(await heading()).toHaveTextContent("Grace Hopper");
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/");
    expect(vi.mocked(fetch).mock.calls).toEqual([["/api/users/caf%C3%A9", expect.anything()]]);
  });

  it("is busy until they've loaded", async () => {
    let answer = (_: Response) => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    showPage(grace);
    expect(screen.getByRole("main").querySelector("section")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("heading")).toBeNull();
    await act(async () => answer(Response.json({ person: grace })));
    expect(screen.getByRole("main").querySelector("section")).toHaveAttribute("aria-busy", "false");
  });

  it("shows administrators someone's email address as a mail link, or nothing for someone with none", async () => {
    serve(found({ ...grace, emailAddress: "grace@example.com" }));
    showPage(grace, { me: { ...ada, administrator: true } });
    await heading();
    expect(mailLink()).toHaveAttribute("href", "mailto:grace@example.com");
    expect(mailLink()).toHaveTextContent("grace@example.com");
  });

  it("loads them again once you become an administrator or stop being one, for their email address", async () => {
    let administrator = false;
    serve(() => Response.json({ person: administrator ? { ...grace, emailAddress: "grace@example.com" } : grace }));
    const { become } = showPage(grace);
    await heading();
    become({ ...ada, name: "Ada King" });
    expect(fetch).toHaveBeenCalledTimes(1);

    administrator = true;
    become({ ...ada, administrator: true });
    await waitFor(() => expect(mailLink()).toHaveAttribute("href", "mailto:grace@example.com"));

    administrator = false;
    become(ada);
    await waitFor(() => expect(mailLink()).toBeNull());
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("shows no link for someone with no email address", async () => {
    serve(found({ ...grace, emailAddress: null }));
    showPage(grace, { me: { ...ada, administrator: true } });
    await heading();
    expect(screen.queryAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/rooms/general"]);
  });

  it("has a pencil to Edit my profile on your own page", async () => {
    serve(found({ ...grace, id: ada.id, name: ada.name, bio: null }));
    showPage(ada.id);
    expect(await heading()).toHaveTextContent("Ada Lovelace");
    expect(screen.getByRole("link", { name: "Edit my profile" })).toHaveAttribute("href", "/users/me/profile");
    // You can start a DM with yourself, as ember-rust's page offers.
    expect(directButton("Ada Lovelace")).toBeVisible();
  });

  it("names them, and shows their bio and avatar, as the people directory lists them now", async () => {
    serve(found(grace));
    const { list } = showPage(grace);
    await heading();
    const renamed: DirectoryUser = { ...grace, name: "Grace Brewster Hopper", bio: "Rear admiral", avatarUrl: "/users/t2/avatar?v=2" };
    list(new Map([[grace.id, renamed]]));
    expect(await heading()).toHaveTextContent("Grace Brewster Hopper");
    expect(document.title).toBe("Grace Brewster Hopper");
    expect(screen.getByText("Rear admiral")).toBeVisible();
    expect(await avatar()).toHaveAttribute("src", renamed.avatarUrl);
  });

  it("shows banned people's names and bios under a dimmed avatar with a cancel mark, with no DM button", async () => {
    serve(found({ ...grace, status: "banned" }));
    showPage(grace);
    expect(await heading()).toHaveTextContent("Grace Hopper");
    expect(screen.getByText("Wrote the first compiler")).toBeVisible();
    expect(await avatar()).toHaveClass("opacity-50");
    expect(document.querySelector(`img[src="${cancel}"]`)).toBeInTheDocument();
    expect(directButton("Grace Hopper")).toBeNull();
  });

  it("shows removed people's names and that they're no longer on this account", async () => {
    serve(found({ ...grace, status: "deactivated" }));
    showPage(grace);
    expect(await heading()).toHaveTextContent("Grace Hopper");
    expect(screen.getByText("Grace Hopper is no longer on this account")).toBeVisible();
    expect(screen.queryByText("Wrote the first compiler")).toBeNull();
    expect(directButton("Grace Hopper")).toBeNull();
    expect(document.querySelector(`img[src="${cancel}"]`)).toBeNull();
  });

  it("shows bots' avatars and a DM button, with no name, until they're deleted", async () => {
    serve(found(bender));
    showPage(bender);
    expect(await avatar()).toBeVisible();
    expect(directButton("Bender")).toBeVisible();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("says a deleted bot is no longer on this account", async () => {
    serve(found({ ...bender, status: "deactivated" }));
    showPage(bender);
    expect(await screen.findByText("Bender is no longer on this account")).toBeVisible();
    expect(directButton("Bender")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("starts a DM with them, or opens yours, with the messages icon, which a second click doesn't start again", async () => {
    serve(found(grace));
    let settle = (_: boolean) => {};
    const { onStartDirect, user } = showPage(grace, { started: () => new Promise((resolve) => (settle = resolve)) });
    await heading();
    const button = directButton("Grace Hopper")!;
    expect(button.querySelector("img")).toHaveAttribute("src", messages);
    await user.click(button);
    expect(onStartDirect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: grace.id, name: grace.name }));
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.click(button);
    expect(onStartDirect).toHaveBeenCalledOnce();

    // It can be pressed again if that fails, as it would to try again.
    await act(async () => settle(false));
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    expect(onStartDirect).toHaveBeenCalledTimes(2);
  });

  it("starts the DM only once the page's guard lets it leave", async () => {
    serve(found(grace));
    let proceed = () => {};
    const stopGuarding = guardLeaving((_, go) => {
      proceed = go as () => void;
      return true;
    });
    try {
      const { onStartDirect, user } = showPage(grace);
      await heading();
      await user.click(directButton("Grace Hopper")!);
      expect(onStartDirect).not.toHaveBeenCalled();
      await act(async () => proceed());
      expect(onStartDirect).toHaveBeenCalledOnce();
    } finally {
      stopGuarding();
    }
  });

  it("has nobody with the id show Campfire's 404 page", async () => {
    serve(() => Response.json({ error: "Not found" }, { status: 404 }));
    const { onMissing, onFailed } = showPage("nobody");
    await waitFor(() => expect(onMissing).toHaveBeenCalledOnce());
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("says why when they can't be loaded", async () => {
    serve(() => Response.json({ error: "Something went wrong" }, { status: 500 }));
    const { onMissing, onFailed } = showPage(grace);
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(onFailed.mock.calls[0]![0]).toMatchObject({ status: 500, message: "Something went wrong" });
    expect(onMissing).not.toHaveBeenCalled();
  });
});
