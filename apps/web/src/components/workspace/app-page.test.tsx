import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@ember/protocol";
import { APPS_FORBIDDEN, APPS_FULL, type App, type AppAnswer } from "@ember/protocol/apps";
import { ASSISTANT_OFF } from "@ember/protocol/assistant";
import { FlashProvider } from "@/components/flash";
import { Sheet } from "@/components/ui/sheet";
import { agentSettingsPath, appSettingsPath, NEW_APP_PATH } from "@/hooks/use-route";
import { AGENTS_PATH } from "./agent-list";
import { AppSettingsPage, changesOf, CONFIRM_REMOVE_APP, NewAppPage, READING_TOOLS, SET_ASIDE_EXPLAINED, TOKEN_EXPLAINED, TOKEN_KEPT, TOOL_IS_GONE, toolsLeftOut, URL_EXPLAINED } from "./app-page";
import { CHANGES_SAVED } from "./settings-page";

const ada: Me = { id: "0mgk3x2a9b4c5d", name: "Ada Lovelace", administrator: true };

const LINEAR: App = {
  id: "0mgk3x2a9b4c70",
  name: "Linear",
  url: "https://mcp.linear.example/mcp",
  hasToken: true,
  serverName: "Linear MCP",
  tools: [
    { name: "create_issue", title: "Create issue", description: "Creates an issue in a team.\nIt needs a title." },
    { name: "list_issues", title: null, description: "" },
  ],
  toolsLeftOut: 0,
  toolsReadAt: "2026-11-13T10:30:00.000Z",
  connectedBy: { id: ada.id, name: ada.name },
  setAside: [],
};

const answer = (app: App, status = 200) => Response.json({ app } satisfies AppAnswer, { status });
const refused = (status: number, error: string, field?: string) => Response.json({ error, ...(field && { field }) }, { status });

interface Answers {
  /** What listing the apps answers, rather than none. */
  listed?: () => Response | Promise<Response>;
  /** What loading the app answers, rather than `LINEAR`. */
  loaded?: () => Response | Promise<Response>;
  /** What connecting, changing, rereading or removing the app answers, rather than that it's done. */
  sent?: (request: string, body: unknown) => Response | Promise<Response>;
}

/** Answers the pages' requests as the server does for an administrator, or as `answers` says, keeping what was sent. */
function serve({ listed = () => Response.json({ apps: [] }), loaded = () => answer(LINEAR), sent }: Answers = {}) {
  const requests: Array<{ request: string; body: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    if (request === "GET /api/account/apps") return listed();
    if (request === `GET /api/account/apps/${LINEAR.id}`) return loaded();
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ request, body });
    if (sent) return sent(request, body);
    switch (request) {
      case "POST /api/account/apps":
        return answer(LINEAR, 201);
      case `PATCH /api/account/apps/${LINEAR.id}`:
      case `POST /api/account/apps/${LINEAR.id}/tools`:
        return answer(LINEAR);
      case `DELETE /api/account/apps/${LINEAR.id}`:
        return new Response(null, { status: 204 });
      default:
        throw new Error(`Unexpected request for ${request}`);
    }
  });
  return requests;
}

/** Shows `page` at `path`, as the workspace does. */
function showAt(path: string, page: (props: { onMissing: () => void; onFailed: () => void }) => React.ReactNode) {
  const [onMissing, onFailed] = [vi.fn(), vi.fn()];
  history.replaceState(null, "", path);
  render(
    <FlashProvider workspace>
      <Sheet>{page({ onMissing, onFailed })}</Sheet>
    </FlashProvider>,
  );
  return { onMissing, onFailed, user: userEvent.setup() };
}

const showNew = (me = ada) => showAt(NEW_APP_PATH, ({ onFailed }) => <NewAppPage me={me} onFailed={onFailed} />);
const showSettings = (me = ada) =>
  showAt(appSettingsPath(LINEAR.id), ({ onMissing, onFailed }) => <AppSettingsPage appId={LINEAR.id} me={me} onMissing={onMissing} onFailed={onFailed} />);

const nameField = () => screen.findByRole("textbox", { name: "Name" });
const urlField = () => screen.getByRole("textbox", { name: "Server address" });
const tokenField = () => screen.getByLabelText("Token");
const tools = () => screen.getByRole("region", { name: /^Tools/ });
const flashed = () => screen.findByRole("alert");

afterEach(() => vi.restoreAllMocks());

describe("Connect an app", () => {
  it("asks for a name, the server's address and a token, saying what each is for, with Go Back to the AI assistant tab", async () => {
    serve();
    showNew();
    expect(await nameField()).toHaveValue("");
    expect(screen.getByRole("heading", { level: 1, name: "Connect an app" })).toBeVisible();
    expect(document.title).toContain("Connect an app");
    expect(urlField()).toHaveAccessibleDescription(URL_EXPLAINED);
    expect(tokenField()).toHaveAccessibleDescription(TOKEN_EXPLAINED);
    expect(tokenField()).toHaveAttribute("type", "password");
    expect(screen.queryByRole("checkbox", { name: "Send no token" })).toBeNull();
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", AGENTS_PATH);
  });

  it("connects the app with what's typed, leaving out a blank token, and goes to its page, saying how many tools Ember read", async () => {
    const requests = serve();
    const { user } = showNew();
    await user.type(await nameField(), "Linear");
    await user.type(urlField(), LINEAR.url);
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await flashed()).toHaveTextContent("Linear is connected. Ember read 2 tools from it.");
    expect(location.pathname).toBe(appSettingsPath(LINEAR.id));
    expect(requests).toEqual([{ request: "POST /api/account/apps", body: { name: "Linear", url: LINEAR.url } }]);
  });

  it("sends a token that's typed, and says it's reading the app's tools while it waits", async () => {
    let connected!: (response: Response) => void;
    const requests = serve({ sent: () => new Promise((resolve) => (connected = resolve)) });
    const { user } = showNew();
    await user.type(await nameField(), "Linear");
    await user.type(urlField(), LINEAR.url);
    await user.type(tokenField(), "lin_api_123");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(screen.getByRole("status")).toHaveTextContent(READING_TOOLS);
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(requests[0]!.body).toEqual({ name: "Linear", url: LINEAR.url, token: "lin_api_123" });
    connected(answer(LINEAR, 201));
    await waitFor(() => expect(location.pathname).toBe(appSettingsPath(LINEAR.id)));
  });

  it("says why a field is refused on that field, until it's changed, and stays", async () => {
    const why = "mcp.linear.example has no MCP server at that address. Check the address, which often ends in /mcp.";
    serve({ sent: () => refused(422, why, "url") });
    const { user, onFailed } = showNew();
    await user.type(await nameField(), "Linear");
    await user.type(urlField(), "https://mcp.linear.example/");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(urlField()).toHaveAccessibleDescription(why));
    expect(urlField()).toBeInvalid();
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(location.pathname).toBe(NEW_APP_PATH);
    expect(onFailed).not.toHaveBeenCalled();

    await user.type(urlField(), "mcp");
    expect(urlField()).toBeValid();
    expect(urlField()).toHaveAccessibleDescription(URL_EXPLAINED);
  });

  it("says a refusal about no field under Connect", async () => {
    serve({ sent: () => refused(422, "Expected a JSON object") });
    const { user } = showNew();
    await user.type(await nameField(), "Linear");
    await user.type(urlField(), LINEAR.url);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Expected a JSON object"));
  });

  it("says so, as the workspace's alerts do, when as many apps are connected as can be", async () => {
    serve({ sent: () => refused(409, APPS_FULL) });
    const { user, onFailed } = showNew();
    await user.type(await nameField(), "Linear");
    await user.type(urlField(), LINEAR.url);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("sends anyone but an administrator to workspace settings at once, saying why, and asks the server nothing", async () => {
    const requests = serve({ listed: () => refused(403, APPS_FORBIDDEN) });
    const { onFailed } = showNew({ ...ada, administrator: false });
    expect(await flashed()).toHaveTextContent(APPS_FORBIDDEN);
    expect(location.pathname).toBe("/account/edit");
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(requests).toEqual([]);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("sends an administrator to the AI assistant tab while Ember AI is off, saying so", async () => {
    serve({ listed: () => refused(409, ASSISTANT_OFF) });
    showNew();
    expect(await flashed()).toHaveTextContent(ASSISTANT_OFF);
    expect(location.pathname + location.hash).toBe(AGENTS_PATH);
  });
});

describe("A connected app's page", () => {
  it("shows the app as it's connected, never its token, and the tools Ember read, each with what its server says of it", async () => {
    serve();
    showSettings();
    expect(await nameField()).toHaveValue("Linear");
    expect(screen.getByRole("heading", { level: 1, name: "Edit app" })).toBeVisible();
    expect(urlField()).toHaveValue(LINEAR.url);
    expect(tokenField()).toHaveValue("");
    expect(tokenField()).toHaveAccessibleDescription(TOKEN_KEPT);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    expect(within(tools()).getByRole("heading", { name: "Tools (2)" })).toBeVisible();
    expect(tools()).toHaveTextContent("Its server calls itself Linear MCP");
    expect(tools()).toHaveTextContent("Connected by Ada Lovelace");
    const [create, list] = within(tools()).getAllByRole("listitem");
    expect(create).toHaveTextContent("create_issue");
    expect(create).toHaveTextContent("Create issue");
    expect(create).toHaveTextContent("Creates an issue in a team. It needs a title.");
    expect(list).toHaveTextContent(/^list_issues$/);
    expect(tools()).not.toHaveTextContent("Ember leaves out");
    expect(within(tools()).queryByRole("group")).toBeNull();
  });

  it("says which tools are set aside for the agents that had them, as the app changed them or no longer has them, with a link to each agent's page", async () => {
    const setAside = [
      { name: "close_issue", gone: true, agents: [{ id: "0mgk3x2a9b4c81", name: "Recap" }] },
      { name: "create_issue", gone: false, agents: [{ id: "ember", name: "Ember" }, { id: "0mgk3x2a9b4c81", name: "Recap" }] },
    ];
    serve({ loaded: () => answer({ ...LINEAR, setAside }) });
    showSettings();
    await nameField();

    const group = within(tools()).getByRole("group", { name: SET_ASIDE_EXPLAINED });
    const [closed, created] = within(group).getAllByRole("listitem");
    expect(closed).toHaveTextContent(`close_issue${TOOL_IS_GONE}, picked for Recap`);
    expect(created).toHaveTextContent("create_issuepicked for Ember, Recap");
    expect(within(created!).getByRole("link", { name: "Ember" })).toHaveAttribute("href", agentSettingsPath("ember"));
    expect(within(created!).getByRole("link", { name: "Recap" })).toHaveAttribute("href", agentSettingsPath("0mgk3x2a9b4c81"));
    // The tools themselves are listed under it as ever.
    expect(within(tools()).getAllByRole("listitem")).toHaveLength(4);
  });

  it("says how many tools Ember left out, when the server has more than it keeps", async () => {
    serve({ loaded: () => answer({ ...LINEAR, toolsLeftOut: 12, serverName: null, connectedBy: null }) });
    showSettings();
    await nameField();
    expect(tools()).toHaveTextContent(toolsLeftOut(12));
    expect(tools()).not.toHaveTextContent("calls itself");
    expect(tools()).not.toHaveTextContent("Connected by");
  });

  it("saves only what was changed, and says so", async () => {
    const requests = serve({ sent: () => answer({ ...LINEAR, name: "Linear (work)" }) });
    const { user } = showSettings();
    await user.type(await nameField(), " (work)");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await flashed()).toHaveTextContent(CHANGES_SAVED);
    expect(requests).toEqual([{ request: `PATCH /api/account/apps/${LINEAR.id}`, body: { name: "Linear (work)" } }]);
    expect(await nameField()).toHaveValue("Linear (work)");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(location.pathname).toBe(appSettingsPath(LINEAR.id));
  });

  it("says it's reading the app's tools while another address or token is saved, then how many it read", async () => {
    let saved!: (response: Response) => void;
    const requests = serve({ sent: () => new Promise((resolve) => (saved = resolve)) });
    const { user } = showSettings();
    await nameField();
    await user.type(tokenField(), "lin_api_456");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // The form's note, over the Tools card's.
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(READING_TOOLS);
    expect(within(tools()).getByRole("status")).toHaveTextContent("");
    expect(requests[0]!.body).toEqual({ token: "lin_api_456" });
    // Nothing can be typed until the server answers, as its answer would replace it.
    await user.type(await nameField(), "!");
    await user.type(tokenField(), "7");
    expect(await nameField()).toHaveValue("Linear");
    expect(tokenField()).toHaveValue("lin_api_456");
    expect(screen.getByRole("checkbox", { name: "Send no token" })).toBeDisabled();
    saved(answer({ ...LINEAR, tools: [LINEAR.tools[0]!] }));
    expect(await flashed()).toHaveTextContent("Changes saved. Ember read 1 tool from Linear.");
    expect(within(tools()).getByRole("heading", { name: "Tools (1)" })).toBeVisible();
    expect(tokenField()).toHaveValue("");
  });

  it("stops sending the token once Send no token is checked, which turns the token field off", async () => {
    const requests = serve({ sent: () => answer({ ...LINEAR, hasToken: false }) });
    const { user } = showSettings();
    await nameField();
    await user.click(screen.getByRole("checkbox", { name: "Send no token" }));
    expect(tokenField()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(requests).toEqual([{ request: `PATCH /api/account/apps/${LINEAR.id}`, body: { token: "" } }]));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Send no token" })).toBeNull());
    expect(tokenField()).toHaveAccessibleDescription(TOKEN_EXPLAINED);
  });

  it("reads the app's tools again, keeping what's typed, and shows what it read", async () => {
    const requests = serve({ sent: () => answer({ ...LINEAR, tools: [...LINEAR.tools, { name: "close_issue", title: null, description: "Closes an issue." }] }) });
    const { user } = showSettings();
    await user.type(await nameField(), "!");
    await user.click(within(tools()).getByRole("button", { name: "Read its tools again" }));

    expect(await within(tools()).findByRole("heading", { name: "Tools (3)" })).toBeVisible();
    expect(requests).toEqual([{ request: `POST /api/account/apps/${LINEAR.id}/tools`, body: undefined }]);
    expect(await nameField()).toHaveValue("Linear!");
  });

  it("follows what another administrator saved, in the fields left as they were, once its tools are read again, so that the next save doesn't put the old back", async () => {
    const elsewhere = { ...LINEAR, name: "Linear (EU)", url: "https://mcp.eu.linear.example/mcp" };
    const requests = serve({ sent: (request) => answer(request.startsWith("POST") ? elsewhere : { ...elsewhere, name: "Linear!" }) });
    const { user } = showSettings();
    await user.type(await nameField(), "!");
    await user.click(within(tools()).getByRole("button", { name: "Read its tools again" }));

    // The address wasn't touched, so it's the one saved since; the name was, so it stays as typed.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Server address" })).toHaveValue(elsewhere.url));
    expect(await nameField()).toHaveValue("Linear!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(requests.at(-1)).toEqual({ request: `PATCH /api/account/apps/${LINEAR.id}`, body: { name: "Linear!" } }));
  });

  it("lets a token be typed again once the tools are read again of an app another administrator took the token from", async () => {
    serve({ sent: () => answer({ ...LINEAR, hasToken: false }) });
    const { user } = showSettings();
    await user.click(await screen.findByRole("checkbox", { name: "Send no token" }));
    expect(tokenField()).toBeDisabled();
    await user.click(within(tools()).getByRole("button", { name: "Read its tools again" }));

    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Send no token" })).toBeNull());
    expect(tokenField()).toBeEnabled();
  });

  it("says why its tools couldn't be read again, in the Tools card, leaving those it has", async () => {
    const why = "mcp.linear.example took too long to answer.";
    serve({ sent: () => refused(422, why) });
    const { user, onFailed } = showSettings();
    await nameField();
    await user.click(within(tools()).getByRole("button", { name: "Read its tools again" }));

    await waitFor(() => expect(within(tools()).getByRole("status")).toHaveTextContent(why));
    expect(within(tools()).getAllByRole("listitem")).toHaveLength(2);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("removes the app once the administrator is sure, and goes back to the AI assistant tab", async () => {
    const requests = serve();
    const sure = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { user } = showSettings();
    await nameField();
    await user.click(screen.getByRole("button", { name: "Remove Linear" }));
    expect(sure).toHaveBeenCalledWith(CONFIRM_REMOVE_APP);
    expect(requests).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Remove Linear" }));
    await waitFor(() => expect(location.pathname + location.hash).toBe(AGENTS_PATH));
    expect(requests).toEqual([{ request: `DELETE /api/account/apps/${LINEAR.id}`, body: undefined }]);
  });

  it("shows the 404 page for an id that isn't a connected app's", async () => {
    serve({ loaded: () => refused(404, "Not found") });
    const { onMissing, onFailed } = showSettings();
    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("sends anyone but an administrator to workspace settings at once, asking the server nothing", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    showSettings({ ...ada, administrator: false });
    expect(await flashed()).toHaveTextContent(APPS_FORBIDDEN);
    expect(location.pathname).toBe("/account/edit");
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe("What Save changes sends", () => {
  const typed = { name: LINEAR.name, url: LINEAR.url, token: "", noToken: false };

  it("is only what's typed differently from the app as it loaded", () => {
    expect(changesOf(LINEAR, typed)).toEqual({});
    expect(changesOf(LINEAR, { ...typed, name: " Linear " })).toEqual({});
    expect(changesOf(LINEAR, { ...typed, name: "Tracker", url: "https://mcp.linear.example/v2/mcp" })).toEqual({ name: "Tracker", url: "https://mcp.linear.example/v2/mcp" });
  });

  it("is a token that's typed, or none for an app that has one once Send no token is checked", () => {
    expect(changesOf(LINEAR, { ...typed, token: "lin_api_456" })).toEqual({ token: "lin_api_456" });
    expect(changesOf(LINEAR, { ...typed, noToken: true })).toEqual({ token: "" });
    expect(changesOf({ ...LINEAR, hasToken: false }, { ...typed, noToken: true })).toEqual({});
  });
});
