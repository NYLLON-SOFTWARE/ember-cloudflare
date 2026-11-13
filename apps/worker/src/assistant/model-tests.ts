import { ASSISTANT_NAME } from "@ember/protocol";
import { providerFormatOf, type AssistantModel } from "@ember/protocol/assistant";
import type { Env } from "../env";
import type { MovedModel } from "../workspace-store";
import { ask, thinkingLevelsOf, type Gateway, type Question } from "./gateway";

// The test question Ember asks a model before it keeps it, and the move of the models it kept before it
// asked Claude, GPT and Grok through their providers' own endpoints first (`formatsFor`) onto those.

/** What Set up Ember AI asks the model before Ember keeps it, so that it's known to answer. */
export const TEST_QUESTION: Question = {
  instructions: `You are ${ASSISTANT_NAME}, the AI assistant in a team's chat, where people ask you things by mentioning @ember. An administrator has just set you up.`,
  turns: [{ role: "user", text: "Say hello to the team in one short sentence." }],
  // Room for a model that thinks before it answers, however short the answer.
  maxTokens: 2_000,
};

/** How long Set up Ember AI waits for each answer to its test question. */
export const TEST_TIMEOUT_MS = 30_000;

/** The levels of thinking the model `gateway` names takes in its format, as it answers the test question, @ember's unless it's another `question`, again at each (`thinkingLevelsOf`). */
export const testedLevelsOf = (env: Env, gateway: Gateway, question = TEST_QUESTION) => thinkingLevelsOf(env, gateway, question, TEST_TIMEOUT_MS);

/**
 * How many of the models Ember AI kept before it asked Claude, GPT and Grok through their providers'
 * endpoints one move asks there, at most: five requests each, its levels of thinking included, of the 50
 * subrequests an invocation on the Free plan can make.
 */
export const MODELS_PER_MOVE = 8;

/** The models a move found answer through their providers' endpoints, and whether it's done: whether there are no more to ask there. */
export interface ProviderMoves {
  moves: MovedModel[];
  done: boolean;
}

/**
 * The models `saved` lists, the ones people can pick and the agents', that Ember AI asks through
 * Cloudflare's REST API and that answer the test question through AI Gateway's endpoint for their
 * provider, as `gateway`'s account and API token ask it, with the levels of thinking each takes there,
 * which needn't be those it took where it was. The first `MODELS_PER_MOVE` are asked, one after another,
 * so that none waits out its time behind the others' requests, and the rest by the next move, unless
 * none of these answered. One that doesn't answer there, as by a name its provider doesn't know it by,
 * stays where it is, and an API token without AI Gateway Run, which every endpoint refuses alike, leaves
 * them all where they are.
 */
export async function providerMovesOf(env: Env, gateway: Pick<Gateway, "accountId" | "apiToken">, saved: readonly Pick<AssistantModel, "id" | "format">[]): Promise<ProviderMoves> {
  const pending = movableIn(saved);
  const moves: MovedModel[] = [];
  for (const { id, from, format } of pending.slice(0, MODELS_PER_MOVE)) {
    const moving = { accountId: gateway.accountId, apiToken: gateway.apiToken, model: id, format };
    const answered = await ask(env, moving, TEST_QUESTION, TEST_TIMEOUT_MS);
    if (!("refusal" in answered)) {
      moves.push({ id, from, format, thinkingLevels: await testedLevelsOf(env, moving) });
      continue;
    }
    console.log(`Asking ${id} through Cloudflare's REST API still, as AI Gateway's endpoint for its provider didn't answer it: ${answered.refusal}`);
    if (answered.reason === "token") return { moves, done: true };
  }
  return { moves, done: pending.length <= MODELS_PER_MOVE || moves.length === 0 };
}

/** Each model of `saved` in a format of Cloudflare's REST API whose provider's endpoint Ember asks first now, with that endpoint's format, once each. */
function movableIn(saved: readonly Pick<AssistantModel, "id" | "format">[]): Omit<MovedModel, "thinkingLevels">[] {
  const movable = new Map<string, Omit<MovedModel, "thinkingLevels">>();
  for (const { id, format: from } of saved) {
    const format = providerFormatOf(id);
    if (format !== null && format !== from) movable.set(JSON.stringify([id, from]), { id, from, format });
  }
  return [...movable.values()];
}
