import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, DirectoryUser, UserId } from "@ember/protocol";
import type { Bot, Bots, Commands } from "@ember/protocol/bots";
import { FlashProvider } from "@/components/flash";
import { Sheet } from "@/components/ui/sheet";
import { AccountContext } from "@/hooks/use-account";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { BotsPage, NO_ROOMS } from "./bots-page";
import userEvent from "@testing-library/user-event";

const account: Account = { name: "Analytical Engines", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, joinLink: true, openSignUp: false, memberfulJoin: false, memberfulSignIn: false, ssoJoin: false, ssoSignIn: false, emailDomainSignUp: false, emailDomains: [], navigationIcons: {}, huddles: false, huddleCameras: true, huddleScreens: true };

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
const UPTIME_BOT: Bot = { ...BUILD_BOT, id: "0mgk3x2a9b4c5g", name: "Uptime", avatarUrl: "/users/up7/avatar?v=1", key: "0mgk3x2a9b4c5g-Qp8oNm6lKj4h", rooms: [BUILD_BOT.rooms[1]!] };

/** Answers loading the bots, and the workspace's commands, as the server does for an administrator, or as `loaded` says. */
function serve(loaded?: () => Response, commands: () => Response = () => Response.json(NO_COMMANDS)) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    if (request === "GET /api/account/bots") return (loaded ?? (() => Response.json({ bots: [BUILD_BOT, DEPLOY_BOT] } satisfies Bots)))();
    if (request === "GET /api/account/commands") return commands();
    throw new Error(`Unexpected request for ${request}`);
  });
}

/** A workspace with no commands registered, and no bot on any room's message events. */
const NO_COMMANDS = { commands: [], subscriptions: [] } satisfies Commands;

/** Shows the page, whose people directory `showPeople` changes. */
function showPage(shown = account) {
  const onFailed = vi.fn();
  history.replaceState(null, "", "/account/bots");
  const page = (people: People) => (
    <AccountContext value={shown}>
      <PeopleContext value={people}>
        <FlashProvider workspace>
          <Sheet>
            <BotsPage onFailed={onFailed} />
          </Sheet>
        </FlashProvider>
      </PeopleContext>
    </AccountContext>
  );
  const { rerender } = render(page(new Map()));
  return { onFailed, showPeople: (people: People) => rerender(page(people)) };
}

/** A bot as the people directory lists it. */
const listedAs = ({ id, name, bio, role, status, avatarUrl }: Bot, changes: Partial<DirectoryUser> = {}): [UserId, DirectoryUser] => [id, { id, name, bio, role, status, avatarUrl, ...changes }];

/** Each bot the page lists, once they've loaded: the list's own items, and not its bots' rooms. */
async function listed(count: number): Promise<HTMLElement[]> {
  const bots = () => [...(screen.queryByRole("list", { name: "Chat bots" })?.children ?? [])] as HTMLElement[];
  await waitFor(() => expect(bots()).toHaveLength(count));
  return bots();
}

/** The rooms of `bot`'s card, which are always open: their fieldsets, named by their legends, in order. */
function roomsOf(bot: HTMLElement): HTMLElement[] {
  return within(bot).getAllByRole("group");
}

/** The name of a room fieldset, as its legend says it. */
const roomName = (room: HTMLElement) => room.querySelector("legend")?.textContent;

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

describe("Chat bots page", () => {
  it("is the Chat bots page, saying what bots do, with Add a chat bot, and Go Back to workspace settings", () => {
    showPage();
    expect(document.title).toBe("Chat bots");
    expect(screen.getByRole("heading", { level: 1, name: "Chat bots" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Chat bots let other apps and services post in your rooms, and reply when people talk to them. " +
          "Each of a bot's rooms gets two addresses, one for posting text or a file and one that takes a Slack incoming webhook's payload. " +
          "Give a bot a webhook URL, and Ember sends it every message that @mentions it or is sent to it in a DM, then posts whatever it answers within 30 seconds. " +
          "Register a command for a bot, and typing /name in a room it's in sends it what was typed, its answer posted as the bot. " +
          "Or set a room to send a bot every message written there, mention or no.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a chat bot" })).toHaveAttribute("href", "/account/bots/new");
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/account/edit");
  });

  it("lists each bot as the server does, with its avatar linking to its page, its name, the rooms it's in, and a link to its settings", async () => {
    showPage();
    const panel = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(panel).toHaveAttribute("aria-busy", "true");
    const [build, deploy] = await listed(2);
    expect(panel).toHaveAttribute("aria-busy", "false");

    expect(within(build!).getByText("Build Bot").tagName).toBe("STRONG");
    expect(roomsOf(build!).map(roomName)).toEqual(["general", "random"]);
    expect(within(deploy!).getByText(NO_ROOMS)).toBeInTheDocument();
    const avatar = within(build!).getByTitle("Build Bot");
    expect(avatar).toHaveAttribute("href", `/users/${BUILD_BOT.id}`);
    // The bot's own avatar, as the people directory may not list a bot just added.
    expect(avatar.querySelector("img")).toHaveAttribute("src", BUILD_BOT.avatarUrl);
    expect(within(build!).getByRole("link", { name: "Edit Build Bot" })).toHaveAttribute("href", `/account/bots/${BUILD_BOT.id}/edit`);
    expect(within(deploy!).getByRole("link", { name: "Edit Deploy Bot" })).toHaveAttribute("href", `/account/bots/${DEPLOY_BOT.id}/edit`);
  });

  it("shows each bot's rooms with their commands all at once, and a bot in no rooms as none", async () => {
    showPage();
    const [build, deploy] = await listed(2);

    const rooms = roomsOf(build!);
    expect(rooms.map(roomName)).toEqual(["general", "random"]);
    // Each room's posting addresses are there without anything to open.
    for (const room of rooms) {
      expect(within(room).getByRole("textbox", { name: "curl command for posting messages" })).toBeInTheDocument();
      expect(within(room).getByRole("textbox", { name: "curl command for posting attachments" })).toBeInTheDocument();
      expect(within(room).getByRole("textbox", { name: "Slack-compatible webhook URL" })).toBeInTheDocument();
    }
    // A bot in no rooms has no room to show.
    expect(within(deploy!).queryAllByRole("group")).toEqual([]);
    expect(within(deploy!).getByText(NO_ROOMS)).toBeInTheDocument();
  });

  it("shows a bot's only room with its commands, without anything to open", async () => {
    serve(() => Response.json({ bots: [UPTIME_BOT] } satisfies Bots));
    showPage();
    const [uptime] = await listed(1);
    const [random] = roomsOf(uptime!);
    expect(roomName(random!)).toBe("random");
    expect(within(random!).getByRole("textbox", { name: "curl command for posting messages" })).toBeInTheDocument();
  });

  it("gives the commands that post to each of a bot's rooms as it, at the bot's address there on this host", async () => {
    showPage();
    const [build] = await listed(2);
    const rooms = roomsOf(build!);
    expect(rooms.map(roomName)).toEqual(["general", "random"]);

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
  });

  it("copies each command with the button beside it", async () => {
    showPage();
    const [build] = await listed(2);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const [general] = roomsOf(build!);
    await userEvent.click(within(general!).getByRole("button", { name: "Copy message command" }));
    await userEvent.click(within(general!).getByRole("button", { name: "Copy attachment command" }));
    const url = `http://localhost:3000/rooms/${BUILD_BOT.rooms[0]!.id}/${BUILD_BOT.key}/messages`;
    expect(writeText.mock.calls).toEqual([[`curl -d 'Hello!' ${url}`], [`curl -F "attachment=@/path/to/file" ${url}`]]);
  });

  it("follows a rename elsewhere, keeping the bots in order, and drops a bot deleted elsewhere, as the people directory hears of them", async () => {
    const { showPeople } = showPage();
    await listed(2);
    const names = () => [...screen.getByRole("list", { name: "Chat bots" }).children].map((bot) => bot.querySelector("strong")?.textContent);

    showPeople(new Map([listedAs(BUILD_BOT, { name: "Zulu Bot" }), listedAs(DEPLOY_BOT)]));
    await waitFor(() => expect(names()).toEqual(["Deploy Bot", "Zulu Bot"]));

    showPeople(new Map([listedAs(BUILD_BOT, { name: "Zulu Bot" }), listedAs(DEPLOY_BOT, { status: "deactivated" })]));
    const [build] = await listed(1);
    expect(within(build!).getByText("Zulu Bot").tagName).toBe("STRONG");
    expect(within(build!).getByRole("link", { name: "Edit Zulu Bot" })).toHaveAttribute("href", `/account/bots/${BUILD_BOT.id}/edit`);
  });

  it("lists nothing while there are no bots", async () => {
    serve(() => Response.json({ bots: [] } satisfies Bots));
    showPage();
    const panel = screen.getByRole("heading", { level: 1 }).closest("section")!;
    await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });

  it("sends anyone but an administrator to workspace settings, saying why", async () => {
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

  it("keeps the bots listed when the commands couldn't be loaded, saying why, and asks for them again", async () => {
    const command = { id: "cmd1", name: "deploy", description: "Ship the build", bot: { id: BUILD_BOT.id, name: "Build Bot" } };
    const mock = serve(undefined, () => Response.json({ error: "Something went wrong" }, { status: 500 }));
    showPage();
    const [build] = await listed(2);
    // The bot and its rooms' addresses are there all the same.
    expect(within(build!).getByRole("link", { name: "Edit Build Bot" })).toBeInTheDocument();
    expect(within(within(build!).getAllByRole("group")[0]!).getByRole("textbox", { name: "curl command for posting messages" })).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The workspace's commands couldn't be loaded");

    // Asking again has them, which takes the reason away and the commands with it.
    mock.mockImplementation(async (input, init) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      if (request === "GET /api/account/bots") return Response.json({ bots: [BUILD_BOT, DEPLOY_BOT] } satisfies Bots);
      if (request === "GET /api/account/commands") return Response.json({ commands: [command], subscriptions: [] } satisfies Commands);
      throw new Error(`Unexpected request for ${request}`);
    });
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    const section = within(build!).getByRole("region", { name: "Commands" });
    expect(within(section).getByText("/deploy")).toBeInTheDocument();
  });
});

describe("Slack-compatible webhooks", () => {
  it("gives each of a bot's rooms its Slack-compatible webhook URL, on this host, with a button that copies it", async () => {
    showPage();
    const [build] = await listed(2);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const rooms = roomsOf(build!);
    for (const [room, { id }] of [
      [rooms[0]!, BUILD_BOT.rooms[0]!],
      [rooms[1]!, BUILD_BOT.rooms[1]!],
    ] as const) {
      const webhook = within(room).getByRole("textbox", { name: "Slack-compatible webhook URL" });
      expect(webhook).toHaveValue(`http://localhost:3000/rooms/${id}/${BUILD_BOT.key}/slack`);
      expect(webhook).toHaveAttribute("readonly");
    }
    await userEvent.click(within(rooms[1]!).getByRole("button", { name: "Copy Slack-compatible webhook URL" }));
    expect(writeText.mock.calls).toEqual([[`http://localhost:3000/rooms/${BUILD_BOT.rooms[1]!.id}/${BUILD_BOT.key}/slack`]]);
  });
});

describe("Slash commands", () => {
  const DEPLOY_COMMAND = { id: "cmd1", name: "deploy", description: "Ship the build", bot: { id: BUILD_BOT.id, name: "Build Bot" } };

  /** Answers the commands as `served` says, and each change to them with the reading that follows. */
  function serveCommands(served: () => Response = () => Response.json({ commands: [DEPLOY_COMMAND], subscriptions: [] } satisfies Commands)) {
    let commands = served();
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      if (request === "GET /api/account/bots") return Response.json({ bots: [BUILD_BOT, DEPLOY_BOT] } satisfies Bots);
      if (request === "GET /api/account/commands") return commands;
      if (request === "POST /api/account/commands") {
        // The name as the server keeps it: without the leading "/" and lowercased.
        const { name: given, description } = JSON.parse(String(init?.body)) as { name: string; description?: string };
        const name = given.replace(/^\//, "").toLowerCase();
        const registered = { ...DEPLOY_COMMAND, id: "cmd2", name, description: description ?? null };
        commands = Response.json({ commands: [DEPLOY_COMMAND, registered], subscriptions: [] } satisfies Commands);
        return Response.json({ command: registered }, { status: 201 });
      }
      if (request === "DELETE /api/account/commands/cmd1") {
        commands = Response.json(NO_COMMANDS satisfies Commands);
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request for ${request}`);
    });
  }

  it("lists the commands a bot answers, and registers another for it, which the page then lists", async () => {
    serveCommands();
    showPage();
    const [build] = await listed(2);
    const section = within(build!).getByRole("region", { name: "Commands" });
    expect(within(section).getByText("/deploy")).toBeInTheDocument();
    expect(within(section).getByText("Ship the build")).toBeInTheDocument();

    await userEvent.type(within(section).getByRole("textbox", { name: "A command's name for Build Bot" }), "/restart");
    await userEvent.type(within(section).getByRole("textbox", { name: "What Build Bot's command is for" }), "Start it over");
    await userEvent.click(within(section).getByRole("button", { name: "Register" }));
    await waitFor(() => expect(within(section).getByRole("button", { name: "Forget /restart" })).toBeInTheDocument());
    // The form is left clear once it's registered.
    expect(within(section).getByRole("textbox", { name: "A command's name for Build Bot" })).toHaveValue("");
  });

  it("says why a name the workspace has given another bot already is refused", async () => {
    serveCommands();
    showPage();
    const [build] = await listed(2);
    const section = within(build!).getByRole("region", { name: "Commands" });
    await userEvent.type(within(section).getByRole("textbox", { name: "A command's name for Build Bot" }), "/restart");
    // The second registration is answered 422, and the first reload below keeps /restart off the page.
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => Response.json({ error: "A command with that name is registered already" }, { status: 422 }));
    await userEvent.click(within(section).getByRole("button", { name: "Register" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A command with that name is registered already");
  });

  it("takes a command away with the button beside it", async () => {
    serveCommands();
    showPage();
    const [build] = await listed(2);
    const section = within(build!).getByRole("region", { name: "Commands" });
    await userEvent.click(within(section).getByRole("button", { name: "Forget /deploy" }));
    await waitFor(() => expect(within(section).queryByRole("button", { name: "Forget /deploy" })).not.toBeInTheDocument());
  });
});

describe("Message events", () => {
  /** The tick of room `room` in `bot`'s card, once the page has loaded. */
  async function tickOf(bot: HTMLElement, room: string): Promise<HTMLInputElement> {
    const rooms = within(bot).getAllByRole("group");
    return within(rooms.find((fieldset) => fieldset.querySelector("legend")?.textContent === room)!).getByRole("checkbox", { name: /every message/ }) as HTMLInputElement;
  }

  it("ticks a room to send the bot every message there, and unticks it again", async () => {
    const mock = serve(undefined, () => Response.json(NO_COMMANDS satisfies Commands));
    let subscriptions: Commands["subscriptions"] = [];
    mock.mockImplementation(async (input, init) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      if (request === "GET /api/account/bots") return Response.json({ bots: [BUILD_BOT, DEPLOY_BOT] } satisfies Bots);
      if (request === "GET /api/account/commands") return Response.json({ commands: [], subscriptions } satisfies Commands);
      if (request === `PUT /api/account/bots/${BUILD_BOT.id}/rooms/${BUILD_BOT.rooms[0]!.id}/events`) {
        subscriptions = [{ botId: BUILD_BOT.id, roomId: BUILD_BOT.rooms[0]!.id }];
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request for ${request}`);
    });
    showPage();
    const [build] = await listed(2);
    const tick = await tickOf(build!, "general");
    expect(tick).not.toBeChecked();
    await userEvent.click(tick);
    await waitFor(() => expect(tick).toBeChecked());
    // The other room's tick is the bot's own, and stays as it was.
    expect(await tickOf(build!, "random")).not.toBeChecked();
  });

  it("says why a tick couldn't be saved, and leaves it as it was", async () => {
    serve(undefined, () => Response.json(NO_COMMANDS satisfies Commands));
    showPage();
    const [build] = await listed(2);
    const tick = await tickOf(build!, "general");
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => Response.json({ error: "The bot has to be in the room first" }, { status: 422 }));
    await userEvent.click(tick);
    expect(await screen.findByRole("alert")).toHaveTextContent("The bot has to be in the room first");
    await waitFor(() => expect(tick).not.toBeChecked());
  });
});

describe("Translation buttons", () => {
  it("has a translation button for Chat bots once an administrator shows them, giving the page's name and first sentence", () => {
    showPage({ ...account, hideTranslationButtons: false });
    expect(screen.getByText("Translate")).toBeInTheDocument();
    expect(screen.getByText("Chat bots. Chat bots let other apps and services post in your rooms, and reply when people talk to them.")).toBeInTheDocument();
  });

  it("has none while they're hidden", () => {
    showPage();
    expect(screen.queryByText("Translate")).not.toBeInTheDocument();
  });
});
