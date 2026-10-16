import { feature } from "@ember/parity";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Bot, Bots } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { Sheet } from "@/components/ui/sheet";
import { AccountContext } from "@/hooks/use-account";
import { BotsPage } from "./bots-page";

const account: Account = { name: "Analytical Engines", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false };

const BUILD_BOT: Bot = {
  id: "0mgk3x2a9b4c5e",
  name: "Build Bot",
  bio: null,
  role: "bot",
  status: "active",
  avatarUrl: "/users/b0t/avatar?v=1",
  key: "0mgk3x2a9b4c5e-Ab3dEf5hiJ7k",
  rooms: [
    { id: "0mgk3x2a9b4c5a", name: "general" },
    { id: "0mgk3x2a9b4c5b", name: "random" },
  ],
};
const DEPLOY_BOT: Bot = { ...BUILD_BOT, id: "0mgk3x2a9b4c5f", name: "Deploy Bot", avatarUrl: "/users/d3p/avatar?v=1", key: "0mgk3x2a9b4c5f-Zy9xWv7uTs5r", rooms: [] };

/** Answers loading the bots as the server does for an administrator, or as `loaded` says. */
function serve(loaded = () => Response.json({ bots: [BUILD_BOT, DEPLOY_BOT] } satisfies Bots)) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    if (request === "GET /api/account/bots") return loaded();
    throw new Error(`Unexpected request for ${request}`);
  });
}

function showPage(shown = account) {
  const onFailed = vi.fn();
  history.replaceState(null, "", "/account/bots");
  render(
    <AccountContext value={shown}>
      <FlashProvider workspace>
        <Sheet>
          <BotsPage onFailed={onFailed} />
        </Sheet>
      </FlashProvider>
    </AccountContext>,
  );
  return { onFailed };
}

/** Each bot the page lists, once they've loaded. */
async function listed(count: number): Promise<HTMLElement[]> {
  await waitFor(() => expect(screen.queryAllByRole("listitem")).toHaveLength(count));
  return screen.getAllByRole("listitem");
}

/** Gives the browser a clipboard until the test ends. */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeEach(() => {
  serve();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe(feature("bots.list"), () => {
  it("is ember-rust's Chat bots page, with Add a chat bot, and Go Back to workspace settings", () => {
    showPage();
    expect(document.title).toBe("Chat bots");
    expect(screen.getByRole("heading", { level: 1, name: "Chat bots" })).toBeInTheDocument();
    expect(screen.getByText("With Chat bots, other sites and services can post updates directly to Ember.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a chat bot" })).toHaveAttribute("href", "/account/bots/new");
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/account/edit");
  });

  it("lists each bot as the server does, with its avatar linking to its page, its name, and a link to its settings", async () => {
    showPage();
    const panel = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(panel).toHaveAttribute("aria-busy", "true");
    const [build, deploy] = await listed(2);
    expect(panel).toHaveAttribute("aria-busy", "false");

    expect(within(build!).getByText("Build Bot").tagName).toBe("STRONG");
    const avatar = within(build!).getByTitle("Build Bot");
    expect(avatar).toHaveAttribute("href", `/users/${BUILD_BOT.id}`);
    // The bot's own avatar, as the people directory may not list a bot just added.
    expect(avatar.querySelector("img")).toHaveAttribute("src", BUILD_BOT.avatarUrl);
    expect(within(build!).getByRole("link", { name: "Edit Build Bot" })).toHaveAttribute("href", `/account/bots/${BUILD_BOT.id}/edit`);
    expect(within(deploy!).getByRole("link", { name: "Edit Deploy Bot" })).toHaveAttribute("href", `/account/bots/${DEPLOY_BOT.id}/edit`);
  });

  it("gives the commands that post to each of a bot's rooms as it, at the bot's address there on this host", async () => {
    showPage();
    const [build, deploy] = await listed(2);
    const rooms = within(build!).getAllByRole("group");
    expect(rooms.map((room) => room.querySelector("legend")?.textContent)).toEqual(["general", "random"]);

    for (const [room, { id }] of [
      [rooms[0]!, BUILD_BOT.rooms[0]!],
      [rooms[1]!, BUILD_BOT.rooms[1]!],
    ] as const) {
      const url = `http://localhost:3000/rooms/${id}/${BUILD_BOT.key}/messages`;
      const message = within(room).getByRole("textbox", { name: "curl command for posting messages" });
      expect(message).toHaveValue(`curl -d 'Hello!' ${url}`);
      expect(message).toHaveAttribute("readonly");
      const attachment = within(room).getByRole("textbox", { name: "curl command for posting attachments" });
      expect(attachment).toHaveValue(`curl -F "attachment=@/path/to/file" ${url}`);
      expect(attachment).toHaveAttribute("readonly");
    }
    // A bot in no rooms has nothing to post with.
    expect(within(deploy!).queryAllByRole("group")).toEqual([]);
  });

  it("copies each command with the button beside it", async () => {
    showPage();
    const [build] = await listed(2);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const [general] = within(build!).getAllByRole("group");
    await userEvent.click(within(general!).getByRole("button", { name: "Copy message command" }));
    await userEvent.click(within(general!).getByRole("button", { name: "Copy attachment command" }));
    const url = `http://localhost:3000/rooms/${BUILD_BOT.rooms[0]!.id}/${BUILD_BOT.key}/messages`;
    expect(writeText.mock.calls).toEqual([[`curl -d 'Hello!' ${url}`], [`curl -F "attachment=@/path/to/file" ${url}`]]);
  });

  it("lists nothing while there are no bots", async () => {
    serve(() => Response.json({ bots: [] } satisfies Bots));
    showPage();
    const panel = screen.getByRole("heading", { level: 1 }).closest("section")!;
    await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });

  it("sends anyone but an administrator to workspace settings, saying why, where ember-rust answers an empty 403", async () => {
    serve(() => Response.json({ error: "Only administrators can manage bots" }, { status: 403 }));
    const { onFailed } = showPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Only administrators can manage bots");
    expect(location.pathname).toBe("/account/edit");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("says why the bots didn't load", async () => {
    serve(() => Response.json({ error: "Something went wrong" }, { status: 500 }));
    const { onFailed } = showPage();
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 500 })));
    expect(location.pathname).toBe("/account/bots");
  });
});

describe(feature("accounts.translation-buttons"), () => {
  it("has a translation button for Chat bots once an administrator shows them", () => {
    showPage({ ...account, hideTranslationButtons: false });
    expect(screen.getByText("Translate")).toBeInTheDocument();
  });

  it("has none while they're hidden", () => {
    showPage();
    expect(screen.queryByText("Translate")).not.toBeInTheDocument();
  });
});
