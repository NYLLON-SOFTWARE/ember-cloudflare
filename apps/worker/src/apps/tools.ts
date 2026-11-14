import type { CardAction, UserId } from "@ember/protocol";
import { CALL_ACTIONS, type AppId, type CallDecision } from "@ember/protocol/apps";
import { ToolError, type EmberTool } from "../assistant/tool-calls";
import type { SlackPayload } from "../bots/slack";
import type { Env } from "../env";
import { workspace } from "../workspace";
import { appConnector } from "./connector";

// Connected apps' tools as @ember and the agents use them: an administrator picks them for each
// (Workspace.pickAgentTools), the room gives them to the model beside Ember's own (tool-calls.ts), and
// every call asks first, on a card in the room, which whoever asked, or an administrator, allows or not.
// The model never has an app's address or its token: it names a tool, and Ember calls it.

/**
 * A connected app's tool picked for an agent: its app, by its id and name, and the tool as its server
 * described it when it was picked, with the JSON Schema of what it takes as JSON, as the Workspace
 * hands it to a room.
 */
export interface PickedTool {
  appId: AppId;
  appName: string;
  name: string;
  title: string | null;
  description: string;
  takes: string;
  fingerprint: string;
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

/** What a model reads of an app's tool: whose it is, that each call waits to be allowed, and the app's own words for it, which are the app's. */
const describedAs = ({ appName, title, description }: PickedTool) =>
  [
    `A tool of ${appName}, an app this workspace's administrators connected. Each call waits until the person you're answering allows it, so call it only when they asked for what it does, with what they'd expect.`,
    title === null ? "" : `${appName} calls it: ${title}`,
    description === "" ? "" : `${appName} describes it: ${description}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

/**
 * The tool `given` for `agentId`'s model, which asks first: with its description and what it takes for
 * a question, or without them going on from a call, whose request lists them already.
 */
export function appTool(env: Env, agentId: UserId, given: GivenTool, described?: PickedTool): EmberTool {
  return {
    name: given.as,
    description: described ? describedAs(described) : "",
    takes: described ? (JSON.parse(described.takes) as Record<string, unknown>) : { type: "object" },
    asksFirst: true,
    unaskable: (input) => (written(input).length > MAX_SHOWN_INPUT_LENGTH ? TOO_LONG_TO_SHOW : null),
    run: (input) => called(env, agentId, given, input),
  };
}

/**
 * What calling `tool` with `input` for `agentId` comes to, once someone allowed it: what its app
 * answered, or why not, for the model to read. The Workspace says where it goes, as it finds the tool
 * then: one no longer picked for the agent, or changed since, isn't called.
 */
async function called(env: Env, agentId: UserId, tool: GivenTool, input: Record<string, unknown>): Promise<string> {
  const access = await workspace(env).appToolCall(agentId, tool);
  if (!access) throw new ToolError(`Not run: ${tool.as} isn't one of your tools any more.`);
  const { text, failed } = await appConnector(env).call(access.url, access.token, { name: tool.name, fingerprint: tool.fingerprint }, input);
  if (failed) throw new ToolError(text);
  return text;
}

/** The block a call's card has its buttons in. */
const CALL_BLOCK = "ember.call";

/**
 * The most characters of what a tool is called with that its card shows, as JSON: a call with more is
 * never asked for, so that nobody allows what they couldn't read.
 */
export const MAX_SHOWN_INPUT_LENGTH = 3_000;

/** What a model is told of a call with more than a card shows. */
export const TOO_LONG_TO_SHOW = `Not run: what you called it with is longer than the ${MAX_SHOWN_INPUT_LENGTH.toLocaleString("en-US")} characters, as JSON, that the person allowing the call can be shown. Call it with less.`;

/** What a tool is called with as its card shows it: nothing for no fields, or else indented JSON. */
const written = (input: Record<string, unknown>) => (Object.keys(input).length === 0 ? "" : JSON.stringify(input, null, 2));

/** What a call's card says once it's answered, or once it waited too long. */
export const CALL_OUTCOMES = {
  allow: (who: string) => `Allowed by ${who}.`,
  deny: (who: string) => `Not allowed by ${who}.`,
  late: () => "Nobody allowed this in time, so it wasn't run. Ask again to try once more.",
};

/**
 * The card a room posts for a call that waits, as a Slack payload: who wants to use which app, the tool
 * and what it's called with, in plain text, as the app and the model wrote them, and Allow once and
 * Deny, or, once it's answered, `outcome` in their place.
 */
export function callCard(botName: string, askerName: string, { appName, name }: GivenTool, input: Record<string, unknown>, outcome?: string): SlackPayload {
  const shown = written(input);
  // As they're written: a name like `:tada:` in what a tool is called with is shown as it goes to the app, not as an emoji.
  const text = (text: string) => ({ type: "plain_text", text, emoji: false });
  const button = (decision: CallDecision, label: string, style?: string) => ({ type: "button", text: text(label), action_id: CALL_ACTIONS[decision], ...(style && { style }) });
  return {
    blocks: [
      { type: "header", text: text(`${botName} wants to use ${appName}`) },
      { type: "section", text: text(shown === "" ? `${name}, with nothing` : `${name}, with:\n${shown}`) },
      { type: "context", elements: [text(outcome ?? `${askerName} or an administrator can allow this call. It goes to ${appName} with the token an administrator connected it with.`)] },
      ...(outcome === undefined ? [{ type: "actions", block_id: CALL_BLOCK, elements: [button("allow", "Allow once", "primary"), button("deny", "Deny")] }] : []),
    ],
  };
}

/** What the button `action` answers a call that waits with, or undefined for any other button. */
export function callDecisionOf({ id, blockId }: CardAction): CallDecision | undefined {
  if (blockId !== CALL_BLOCK) return undefined;
  return id === CALL_ACTIONS.allow ? "allow" : id === CALL_ACTIONS.deny ? "deny" : undefined;
}
