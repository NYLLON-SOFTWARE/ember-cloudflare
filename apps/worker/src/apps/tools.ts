import type { CardAction, UserId } from "@ember/protocol";
import { CALL_ACTIONS, type AppId, type CallDecision } from "@ember/protocol/apps";
import { ToolError, type EmberTool } from "../assistant/tool-calls";
import type { SlackPayload } from "../bots/slack";
import type { Env } from "../env";
import { workspace, type AppCallAccess } from "../workspace";
import { appConnector } from "./connector";

// Connected apps' tools as @ember and the agents use them: an administrator picks them for each
// (Workspace.pickAgentTools), the room gives them to the model beside Ember's own (tool-calls.ts), and
// every call asks first, on a card in the room, which whoever asked, or an administrator, allows or not,
// unless the administrator has that agent's calls of the tool always allowed: those are made at once,
// each shown on a card in the room as it is.
// The model never has an app's address or its token: it names a tool, and Ember calls it.

/**
 * A connected app's tool picked for an agent: its app, by its id and name, and the tool as its server
 * described it when it was picked, with the JSON Schema of what it takes as JSON, as the Workspace
 * hands it to a room, and whether the agent's calls of it are made without asking first.
 */
export interface PickedTool {
  appId: AppId;
  appName: string;
  name: string;
  title: string | null;
  description: string;
  takes: string;
  fingerprint: string;
  alwaysAllowed: boolean;
}

/** An app's tool as a model was given it: the name the model calls it by, `as`, and which tool that is, as it was picked. */
export type GivenTool = Pick<PickedTool, "appId" | "appName" | "name" | "fingerprint"> & { as: string };

/** `tool` as its model was given it, without what the model read of it. */
export const givenAs = ({ as, appId, appName, name, fingerprint }: GivenTool): GivenTool => ({ as, appId, appName, name, fingerprint });

/** The longest name a provider takes for a tool, of letters, digits, `_` and `-`. */
const MAX_NAME_LENGTH = 64;

const plain = (text: string) => text.replace(/[^A-Za-z0-9_-]+/g, "_");

/**
 * `picked`, each by the name its model calls it by: its app's name, then its own, as providers take a
 * name, cut to what they take, and numbered where two would be the same.
 */
export function givenTools(picked: readonly PickedTool[]): Array<PickedTool & GivenTool> {
  const taken = new Set<string>();
  return picked.map((tool) => {
    const app = plain(tool.appName).replace(/^_+|_+$/g, "").slice(0, 20) || "app";
    const name = `${app}__${plain(tool.name)}`.slice(0, MAX_NAME_LENGTH);
    let as = name;
    for (let n = 2; taken.has(as); n++) as = `${name.slice(0, MAX_NAME_LENGTH - `_${n}`.length)}_${n}`;
    taken.add(as);
    return { ...tool, as };
  });
}

/** What a model reads of an app's tool: whose it is, that each call waits to be allowed, or is shown to the room, and the app's own words for it, which are the app's. */
const describedAs = ({ appName, title, description, alwaysAllowed }: PickedTool) =>
  [
    alwaysAllowed
      ? `A tool of ${appName}, an app this workspace's administrators connected. Each call is made at once and shown to everyone in the room, so call it only when the person you're answering asked for what it does, with what they'd expect.`
      : `A tool of ${appName}, an app this workspace's administrators connected. Each call waits until the person you're answering allows it, so call it only when they asked for what it does, with what they'd expect.`,
    title === null ? "" : `${appName} calls it: ${title}`,
    description === "" ? "" : `${appName} describes it: ${description}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

/** A call the room was shown, which it's told wasn't made after all with `unmade`. */
export interface ShownCall {
  unmade(): Promise<void>;
}

/** Shows the room a call that's made without asking first, with what it's called with, answering why it couldn't, if it couldn't. */
export type ShowsCall = (input: Record<string, unknown>) => Promise<string | ShownCall>;

/**
 * The tool `given` for `agentId`'s model: with its description and what it takes for a question,
 * `described`, or without them going on from a call, whose request lists them already. It asks first,
 * unless the agent's calls of it are always allowed, which `shown` being there says: such a call is
 * made once the room is shown it, and not when it can't be.
 */
export function appTool(env: Env, agentId: UserId, given: GivenTool, { described, shown }: { described?: PickedTool; shown?: ShowsCall } = {}): EmberTool {
  const unshowable = (input: Record<string, unknown>) => (written(input).length > MAX_SHOWN_INPUT_LENGTH ? TOO_LONG_TO_SHOW : null);
  return {
    name: given.as,
    description: described ? describedAs(described) : "",
    takes: described ? (JSON.parse(described.takes) as Record<string, unknown>) : { type: "object" },
    ...(!shown && { asksFirst: true as const, unaskable: unshowable }),
    run: async (input) => {
      const tooLong = shown ? unshowable(input) : null;
      if (tooLong !== null) throw new ToolError(tooLong);
      return called(env, agentId, given, input, shown);
    },
  };
}

/** What a model is told of a call made without asking first that the room couldn't be shown. */
export const CALL_NOT_SHOWN = "Not run: the room couldn't be shown this call, and a call nobody is shown isn't made.";

/**
 * What calling `tool` with `input` for `agentId` comes to, once someone allowed it, or once the room
 * is `shown` it, as the agent's calls of it are always allowed: what its app answered, or why not, for
 * the model to read. The Workspace says where it goes, as it finds the tool then: one no longer picked
 * for the agent, changed since, or, with nobody asked, no longer always allowed, isn't called, and
 * neither is one the room can't be shown. A call shown that then finds its tool changed has the room
 * told it wasn't made.
 */
async function called(env: Env, agentId: UserId, tool: GivenTool, input: Record<string, unknown>, shown?: ShowsCall): Promise<string> {
  const access = await workspace(env).appToolCall(agentId, tool, shown !== undefined);
  if (!access) throw new ToolError(`Not run: ${tool.as} isn't one of your tools any more${shown ? ", or each call of it has to be allowed now" : ""}.`);
  const shownCall = await shown?.(input);
  if (typeof shownCall === "string") {
    console.error(`A call of the tool ${tool.name} of app ${tool.appId} wasn't made, as the room couldn't be shown it: ${shownCall}`);
    throw new ToolError(CALL_NOT_SHOWN);
  }
  const { text, failed, changed } = await appConnector(env).call(access.url, access.token, { name: tool.name, fingerprint: tool.fingerprint }, input);
  if (changed) await Promise.all([readAgain(env, tool, access), shownCall?.unmade()]);
  if (failed) throw new ToolError(text);
  return text;
}

/**
 * Reads the tools of `tool`'s app again, asked as `access` has it, once a call has found its server no
 * longer lists the tool as it was picked, so that the agents' pages say so, and how it's described now.
 * A server that doesn't answer leaves the app as it was, and the tool uncalled all the same.
 */
async function readAgain(env: Env, tool: GivenTool, access: AppCallAccess): Promise<void> {
  try {
    const read = await appConnector(env).read(access.url, access.token);
    if (!("error" in read)) await workspace(env).keepAppRead(tool.appId, read, access);
  } catch (error) {
    console.error(`Reading the tools of app ${tool.appId} again, after a call found one changed, failed: ${error instanceof Error ? error.name : "unknown error"}`);
  }
}

/** The block a call's card has its buttons in. */
const CALL_BLOCK = "ember.call";

/**
 * The most characters of what a tool is called with that its card shows, as JSON: a call with more is
 * never asked for, or made, so that nobody allows what they couldn't read, and the room is shown all
 * that an app is sent.
 */
export const MAX_SHOWN_INPUT_LENGTH = 3_000;

/** What a model is told of a call with more than a card shows. */
export const TOO_LONG_TO_SHOW = `Not run: what you called it with is longer than the ${MAX_SHOWN_INPUT_LENGTH.toLocaleString("en-US")} characters, as JSON, that the call's card in the room can show. Call it with less.`;

/** What a tool is called with as its card shows it: nothing for no fields, or else indented JSON. */
const written = (input: Record<string, unknown>) => (Object.keys(input).length === 0 ? "" : JSON.stringify(input, null, 2));

/** What a call's card says once it's answered, or once it waited too long. */
export const CALL_OUTCOMES = {
  allow: (who: string) => `Allowed by ${who}.`,
  deny: (who: string) => `Not allowed by ${who}.`,
  late: () => "Nobody allowed this in time, so it wasn't run. Ask again to try once more.",
};

/** Text shown as it's written: a name like `:tada:` in what a tool is called with is shown as it goes to the app, not as an emoji. */
const plainText = (text: string) => ({ type: "plain_text", text, emoji: false });

/** The blocks every card of a call starts with: its `header`, the tool and what it's called with, in plain text, as the app and the model wrote them, and a `note` under them. */
function callBlocks(header: string, { name }: GivenTool, input: Record<string, unknown>, note: string): Record<string, unknown>[] {
  const shown = written(input);
  return [
    { type: "header", text: plainText(header) },
    { type: "section", text: plainText(shown === "" ? `${name}, with nothing` : `${name}, with:\n${shown}`) },
    { type: "context", elements: [plainText(note)] },
  ];
}

/**
 * The card a room posts for a call that waits, as a Slack payload: who wants to use which app, the tool
 * and what it's called with, and Allow once and Deny, or, once it's answered, `outcome` in their place.
 */
export function callCard(botName: string, askerName: string, tool: GivenTool, input: Record<string, unknown>, outcome?: string): SlackPayload {
  const button = (decision: CallDecision, label: string, style?: string) => ({ type: "button", text: plainText(label), action_id: CALL_ACTIONS[decision], ...(style && { style }) });
  const note = outcome ?? `${askerName} or an administrator can allow this call. It goes to ${tool.appName} with the token an administrator connected it with.`;
  return {
    blocks: [
      ...callBlocks(`${botName} wants to use ${tool.appName}`, tool, input, note),
      ...(outcome === undefined ? [{ type: "actions", block_id: CALL_BLOCK, elements: [button("allow", "Allow once", "primary"), button("deny", "Deny")] }] : []),
    ],
  };
}

/** What the card of a call made without asking first says of why it was. */
export const alwaysAllowedFor = (botName: string) => `An administrator always allows ${botName} this tool, so nobody was asked first.`;

/** What the card of a call made without asking first says once the call found its tool changed, and wasn't made. */
export const unmadeFor = (botName: string, appName: string) =>
  `Not run: ${appName} has changed this tool since an administrator picked it for ${botName}, who is without it until one picks it again.`;

/**
 * The card a room posts for a call made without asking first, as the agent's calls of the tool are
 * always allowed, as a Slack payload: who used which app, the tool and what it was called with, or,
 * once the call found its tool changed, `unmade`, that it wasn't made, and why.
 */
export function usedCard(botName: string, tool: GivenTool, input: Record<string, unknown>, unmade = false): SlackPayload {
  const header = unmade ? `${botName} didn't use ${tool.appName}` : `${botName} used ${tool.appName}`;
  return { blocks: callBlocks(header, tool, input, unmade ? unmadeFor(botName, tool.appName) : alwaysAllowedFor(botName)) };
}

/** What the button `action` answers a call that waits with, or undefined for any other button. */
export function callDecisionOf({ id, blockId }: CardAction): CallDecision | undefined {
  if (blockId !== CALL_BLOCK) return undefined;
  return id === CALL_ACTIONS.allow ? "allow" : id === CALL_ACTIONS.deny ? "deny" : undefined;
}
