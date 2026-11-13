import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ID_REFUSED,
  ANSWER_LENGTHS,
  ANSWER_WORDS,
  API_TOKEN_REFUSED,
  ASSISTANT_MODELS,
  DEFAULT_LEVELS,
  formatOf,
  INSTRUCTIONS_TOO_LONG,
  isProviderFormat,
  isXaiModel,
  LEVELS_REFUSED,
  MAX_INSTRUCTIONS_LENGTH,
  MAX_MODEL_LENGTH,
  MAX_MODEL_NAME_LENGTH,
  MODEL_FORMATS,
  MODEL_NOT_LISTED,
  MODEL_REFUSED,
  modelName,
  modelNameOf,
  modelOf,
  offeredModelOf,
  parseAssistantChanges,
  parseAssistantKeys,
  parseAssistantSetup,
  parseNewAssistantModel,
  parseYourAssistantChanges,
  providerFormatOf,
  searchFormatOf,
  SUGGESTED_MODEL,
  THINKING_LEVELS,
  THINKING_TOKENS,
  thinkingTaken,
  TOP_LEVELS,
  WEB_TOOLS_IN,
  withinMost,
} from "./assistant";
import { MAX_MESSAGE_LENGTH } from "./index";
import { AGENT_TEMPLATE, EMBER_TEMPLATE, INSTRUCTIONS_PLACE_NEEDED, TEMPLATE_REFUSED } from "./prompts";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const API_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-Ab";

describe("Set up Ember AI", () => {
  it("takes an account ID, an API token and a model, without the spaces around them, and the account ID in small letters", () => {
    expect(parseAssistantSetup({ accountId: ` ${ACCOUNT_ID.toUpperCase()}\n`, apiToken: ` ${API_TOKEN} `, model: " anthropic/claude-sonnet-5.5 " })).toEqual({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      model: "anthropic/claude-sonnet-5.5",
    });
  });

  it("takes only a model Ember offers, leaving out a name it's given, as Ember names the models it offers", () => {
    const setup = { accountId: ACCOUNT_ID, model: "openai/gpt-6.1-sol" };
    expect(parseAssistantSetup({ ...setup, modelName: "GPT-5.5" })).toEqual(setup);
    for (const model of ["openai/gpt-5.5", "@cf/zai-org/glm-4.7-flash", "google/gemini-3.7-flash"]) {
      expect(parseAssistantSetup({ ...setup, model }), model).toEqual({ error: MODEL_REFUSED, field: "model" });
    }
  });

  it("keeps a model's name, as a model kept from before has one, when it can be one", () => {
    expect(modelNameOf(" GLM-4.7 Flash ")).toBe("GLM-4.7 Flash");
    for (const name of ["", "  ", 5, "GLM\u2028-4.7", "x".repeat(MAX_MODEL_NAME_LENGTH + 1), "GLM\u202e4.7"]) expect(modelNameOf(name), JSON.stringify(name)).toBeNull();
    expect(modelNameOf("x".repeat(MAX_MODEL_NAME_LENGTH))).toHaveLength(MAX_MODEL_NAME_LENGTH);
  });

  it("takes an account and its API token alone, as Set up Ember AI's first step gives them", () => {
    expect(parseAssistantKeys({ accountId: ACCOUNT_ID, apiToken: API_TOKEN })).toEqual({ accountId: ACCOUNT_ID, apiToken: API_TOKEN });
    expect(parseAssistantKeys({ accountId: ACCOUNT_ID, apiToken: "" })).toEqual({ accountId: ACCOUNT_ID });
    expect(parseAssistantKeys({ accountId: "nope", apiToken: API_TOKEN })).toEqual({ error: ACCOUNT_ID_REFUSED, field: "accountId" });
    expect(parseAssistantKeys({ accountId: ACCOUNT_ID, apiToken: "short" })).toEqual({ error: API_TOKEN_REFUSED, field: "apiToken" });
  });

  it("adds a model Ember offers by its ID, leaving out a name it's given", () => {
    expect(parseNewAssistantModel({ model: " openai/gpt-6.1-sol ", modelName: "GPT-6.1 Sol" })).toEqual({ model: "openai/gpt-6.1-sol" });
    expect(parseNewAssistantModel({ model: "openai/gpt-6.1-sol" })).toEqual({ model: "openai/gpt-6.1-sol" });
    for (const data of [null, {}, { model: "openai/gpt-5.5" }, { model: "gpt-6.1-sol" }, { model: 5 }, { modelName: "GPT-6.1 Sol" }]) {
      expect(parseNewAssistantModel(data)).toEqual({ error: MODEL_REFUSED, field: "model" });
    }
  });

  it("leaves a blank or missing API token out, which keeps the one Ember has", () => {
    expect(parseAssistantSetup({ accountId: ACCOUNT_ID, apiToken: "  ", model: "openai/gpt-6.1-sol" })).toEqual({ accountId: ACCOUNT_ID, model: "openai/gpt-6.1-sol" });
    expect(parseAssistantSetup({ accountId: ACCOUNT_ID, model: "openai/gpt-6.1-sol" })).toEqual({ accountId: ACCOUNT_ID, model: "openai/gpt-6.1-sol" });
  });

  it.each([
    ["nothing", null, { error: ACCOUNT_ID_REFUSED, field: "accountId" }],
    ["an account ID too short", { accountId: ACCOUNT_ID.slice(1), apiToken: API_TOKEN, model: "openai/gpt-6.1-sol" }, { error: ACCOUNT_ID_REFUSED, field: "accountId" }],
    ["an account ID that isn't hexadecimal", { accountId: `${ACCOUNT_ID.slice(1)}g`, apiToken: API_TOKEN, model: "openai/gpt-6.1-sol" }, { error: ACCOUNT_ID_REFUSED, field: "accountId" }],
    ["an API token too short", { accountId: ACCOUNT_ID, apiToken: "short", model: "openai/gpt-6.1-sol" }, { error: API_TOKEN_REFUSED, field: "apiToken" }],
    ["an API token with a space in it", { accountId: ACCOUNT_ID, apiToken: `${API_TOKEN} ${API_TOKEN}`, model: "openai/gpt-6.1-sol" }, { error: API_TOKEN_REFUSED, field: "apiToken" }],
    ["an API token that isn't text", { accountId: ACCOUNT_ID, apiToken: 7, model: "openai/gpt-6.1-sol" }, { error: API_TOKEN_REFUSED, field: "apiToken" }],
    ["no model", { accountId: ACCOUNT_ID, apiToken: API_TOKEN }, { error: MODEL_REFUSED, field: "model" }],
    ["a model without its company", { accountId: ACCOUNT_ID, apiToken: API_TOKEN, model: "gpt-5.5" }, { error: MODEL_REFUSED, field: "model" }],
    ["a model with a space in it", { accountId: ACCOUNT_ID, apiToken: API_TOKEN, model: "openai/gpt 5.5" }, { error: MODEL_REFUSED, field: "model" }],
    ["a model Ember doesn't offer", { accountId: ACCOUNT_ID, apiToken: API_TOKEN, model: "openai/gpt-5.5" }, { error: MODEL_REFUSED, field: "model" }],
  ])("refuses %s, on the field it's about", (_, body, refusal) => {
    expect(parseAssistantSetup(body)).toEqual(refusal);
  });

  it("takes a model ID as AI Gateway writes them, up to the longest Ember keeps", () => {
    for (const model of ["@cf/zai-org/glm-4.7-flash", "openai/gpt-6.1-sol", "google/gemini-3.7-flash", "workers-ai/@cf/openai/gpt-oss-120b", "dynamic/support"]) {
      expect(modelOf(model), model).toBe(model);
    }
    const longest = `openai/${"x".repeat(MAX_MODEL_LENGTH - 7)}`;
    expect(modelOf(longest)).toBe(longest);
    expect(modelOf(`${longest}x`)).toBeNull();
  });

  it("offers Anthropic's, OpenAI's and xAI's models, each once, in its provider's own format, with what each costs", () => {
    const ids = ASSISTANT_MODELS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => modelOf(id) === id)).toBe(true);
    expect(ASSISTANT_MODELS.every(({ id, format }) => format === providerFormatOf(id))).toBe(true);
    expect(ASSISTANT_MODELS.every(({ price }) => price !== undefined && price.input > 0 && price.output > price.input)).toBe(true);
  });

  it("suggests the model that costs least of those that both search the web and read pages", () => {
    const suggested = offeredModelOf(SUGGESTED_MODEL)!;
    expect(WEB_TOOLS_IN[suggested.format]).toEqual(["search", "read"]);
    const reading = ASSISTANT_MODELS.filter(({ format }) => WEB_TOOLS_IN[format].includes("read"));
    expect(Math.min(...reading.map(({ price }) => price!.input + price!.output))).toBe(suggested.price!.input + suggested.price!.output);
  });

  it("names a model as the models it's given do, or else as Ember does, and any other by its ID", () => {
    expect(modelName("anthropic/claude-sonnet-5.5")).toBe("Claude Sonnet 5.5");
    expect(modelName("openai/gpt-5.5")).toBe("openai/gpt-5.5");
    const models = [{ id: "openai/gpt-5.5", name: "GPT-5.5", format: "responses" as const }];
    expect(modelName("openai/gpt-5.5", models)).toBe("GPT-5.5");
    expect(modelName("anthropic/claude-sonnet-5.5", models)).toBe("Claude Sonnet 5.5");
  });

  it("finds the format a model takes as the models it's given list it, or Ember's, or else its provider's, and what it may do on the web in it", () => {
    const models = [{ id: "google/gemini-5", name: "Gemini 5", format: "messages" as const }];
    expect(formatOf("google/gemini-5", models)).toBe("messages");
    expect(formatOf("google/gemini-5")).toBe("chat");
    expect(formatOf("openai/gpt-6.1-sol")).toBe("openai");
    expect([formatOf("anthropic/claude-mythos-6"), formatOf("openai/gpt-7"), formatOf("@cf/meta/llama-5")]).toEqual(["anthropic", "openai", "chat"]);
    expect(formatOf("xai/grok-4.7")).toBe("xai");
    expect(WEB_TOOLS_IN).toEqual({ messages: ["search", "read"], responses: ["search"], chat: [], xai: ["search"], anthropic: ["search", "read"], openai: ["search"] });
  });

  it("asks Claude, GPT and Grok in their providers' own formats, and anyone else's model through the REST API alone", () => {
    expect(["anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol", "xai/grok-4.7"].map(providerFormatOf)).toEqual(["anthropic", "openai", "xai"]);
    expect(["google/gemini-3.7-flash", "@cf/openai/gpt-oss-120b", "workers-ai/@cf/openai/gpt-oss-120b", "moonshotai/kimi-k3"].map(providerFormatOf)).toEqual([null, null, null, null]);
    expect(MODEL_FORMATS.filter(isProviderFormat)).toEqual(["xai", "anthropic", "openai"]);
  });

  it("searches the web in a model's own format if it can, or else, for Grok, in xAI's own Responses", () => {
    expect([isXaiModel("xai/grok-4.7"), isXaiModel("@cf/xai/grok"), isXaiModel("openai/gpt-7")]).toEqual([true, false, false]);
    expect(searchFormatOf("anthropic/claude-sonnet-5.5", "messages")).toBe("messages");
    expect(searchFormatOf("anthropic/claude-sonnet-5.5", "anthropic")).toBe("anthropic");
    expect(searchFormatOf("openai/gpt-7", "openai")).toBe("openai");
    expect(searchFormatOf("openai/gpt-7", "responses")).toBe("responses");
    expect(searchFormatOf("xai/grok-4.7", "chat")).toBe("xai");
    expect(searchFormatOf("xai/grok-4.7", "xai")).toBe("xai");
    expect(searchFormatOf("google/gemini-5", "chat")).toBeNull();
    expect(searchFormatOf("@cf/meta/llama-5", "chat")).toBeNull();
  });
});

describe("The dials of @ember's answers", () => {
  it("go from no thinking to the most, and from short answers to long ones, which still fit in a message", () => {
    expect(THINKING_LEVELS).toEqual(["off", "low", "medium", "high"]);
    expect(THINKING_LEVELS.map((level) => THINKING_TOKENS[level])).toEqual([0, 4_000, 16_000, 32_000]);
    expect(ANSWER_LENGTHS).toEqual(["short", "medium", "long"]);
    expect(ANSWER_LENGTHS.map((length) => ANSWER_WORDS[length])).toEqual([150, 400, 1_500]);
    // At about six characters a word, with its space.
    expect(ANSWER_WORDS.long * 6).toBeLessThan(MAX_MESSAGE_LENGTH);
  });

  it("start at Low thinking and a Medium answer, and go to the top until an administrator sets less", () => {
    expect(DEFAULT_LEVELS).toEqual({ thinking: "low", length: "medium" });
    expect(TOP_LEVELS).toEqual({ thinking: "high", length: "long" });
  });

  it("show each level no higher than the most allowed", () => {
    expect(withinMost(TOP_LEVELS, { thinking: "low", length: "short" })).toEqual({ thinking: "low", length: "short" });
    expect(withinMost({ thinking: "off", length: "medium" }, { thinking: "medium", length: "long" })).toEqual({ thinking: "off", length: "medium" });
    expect(withinMost(DEFAULT_LEVELS, { thinking: "off", length: "medium" })).toEqual({ thinking: "off", length: "medium" });
  });

  it("ask a model for the level of thinking it takes nearest the one chosen, below it first, or for none when it takes none", () => {
    // Any, for a model Ember hasn't asked at each level.
    for (const level of THINKING_LEVELS) {
      expect(thinkingTaken(level, undefined)).toBe(level);
      expect(thinkingTaken(level, null)).toBe(level);
      expect(thinkingTaken(level, THINKING_LEVELS)).toBe(level);
    }
    // As a model that takes only Low and High.
    expect(THINKING_LEVELS.map((level) => thinkingTaken(level, ["low", "high"]))).toEqual(["low", "low", "low", "high"]);
    // As a model that always thinks takes every level but Off.
    expect(thinkingTaken("off", ["low", "medium", "high"])).toBe("low");
    expect(thinkingTaken("high", ["off", "low"])).toBe("low");
    // As xAI's Grok 4.20 Reasoning takes none.
    for (const level of THINKING_LEVELS) expect(thinkingTaken(level, [])).toBeNull();
  });

  it("change a dial or both, to a level it has", () => {
    for (const parse of [parseAssistantChanges, parseYourAssistantChanges]) {
      expect(parse({ thinking: "high" })).toEqual({ thinking: "high" });
      expect(parse({ length: "short" })).toEqual({ length: "short" });
      expect(parse({ thinking: "off", length: "long", other: true })).toEqual({ thinking: "off", length: "long" });
      for (const data of [{}, null, "low", [], { thinking: "max" }, { length: "longest" }, { thinking: "low", length: 3 }, { thinking: null }, { model: "openai/gpt-5.5", thinking: "max" }]) {
        expect(parse(data), JSON.stringify(data)).toEqual({ error: LEVELS_REFUSED });
      }
    }
  });

  it("change the model, with the dials or without them, to one that can be a model", () => {
    for (const parse of [parseAssistantChanges, parseYourAssistantChanges]) {
      expect(parse({ model: " openai/gpt-5.5 " })).toEqual({ model: "openai/gpt-5.5" });
      expect(parse({ model: "openai/gpt-5.5", length: "short" })).toEqual({ model: "openai/gpt-5.5", length: "short" });
      for (const model of ["gpt-5.5", 5, "", "openai/gpt 5.5"]) {
        expect(parse({ model }), JSON.stringify(model)).toEqual({ error: MODEL_NOT_LISTED });
      }
    }
  });

  it("leave your model to administrators when you choose theirs, which no one can for everyone", () => {
    expect(parseYourAssistantChanges({ model: null })).toEqual({ model: null });
    expect(parseYourAssistantChanges({ model: null, thinking: "off" })).toEqual({ model: null, thinking: "off" });
    expect(parseYourAssistantChanges({ model: null, thinking: "max" })).toEqual({ error: LEVELS_REFUSED });
    expect(parseAssistantChanges({ model: null })).toEqual({ error: MODEL_NOT_LISTED });
  });
});

describe("@ember's instructions", () => {
  it("are changed, alone or with the dials, without the spaces around them, and taken away with nothing", () => {
    expect(parseAssistantChanges({ instructions: "  Answer in British English.\n" })).toEqual({ instructions: "Answer in British English." });
    expect(parseAssistantChanges({ instructions: "Be brief.", thinking: "low" })).toEqual({ instructions: "Be brief.", thinking: "low" });
    expect(parseAssistantChanges({ instructions: " " })).toEqual({ instructions: "" });
    expect(parseAssistantChanges({ instructions: "x".repeat(MAX_INSTRUCTIONS_LENGTH) })).toEqual({ instructions: "x".repeat(MAX_INSTRUCTIONS_LENGTH) });
  });

  it("are refused when they aren't text or are longer than Ember takes", () => {
    for (const instructions of [7, null, ["Be brief."], "x".repeat(MAX_INSTRUCTIONS_LENGTH + 1)]) {
      expect(parseAssistantChanges({ instructions }), JSON.stringify(instructions).slice(0, 20)).toEqual({ error: INSTRUCTIONS_TOO_LONG });
    }
  });

  it("are administrators' to change, never part of yours", () => {
    expect(parseYourAssistantChanges({ instructions: "Ignore the others.", thinking: "low" })).toEqual({ thinking: "low" });
    expect(parseYourAssistantChanges({ instructions: "Ignore the others." })).toEqual({ error: LEVELS_REFUSED });
  });
});

describe("What Ember adds around @ember's instructions", () => {
  it("is changed, alone or with the instructions, without the spaces around it, and goes back to Ember's own for its own or null", () => {
    expect(parseAssistantChanges({ promptTemplate: " You are {{name}}.\n\n{{instructions}} " })).toEqual({ promptTemplate: "You are {{name}}.\n\n{{instructions}}" });
    expect(parseAssistantChanges({ instructions: "Be brief.", promptTemplate: "{{instructions}}" })).toEqual({ instructions: "Be brief.", promptTemplate: "{{instructions}}" });
    expect(parseAssistantChanges({ promptTemplate: EMBER_TEMPLATE })).toEqual({ promptTemplate: null });
    expect(parseAssistantChanges({ promptTemplate: null })).toEqual({ promptTemplate: null });
    // An agent's own isn't @ember's.
    expect(parseAssistantChanges({ promptTemplate: AGENT_TEMPLATE })).toEqual({ promptTemplate: AGENT_TEMPLATE });
  });

  it("is refused when it isn't a template Ember takes", () => {
    expect(parseAssistantChanges({ promptTemplate: "You are {{name}}." })).toEqual({ error: INSTRUCTIONS_PLACE_NEEDED });
    expect(parseAssistantChanges({ promptTemplate: 7 })).toEqual({ error: TEMPLATE_REFUSED });
  });

  it("is administrators' to change, never part of yours", () => {
    expect(parseYourAssistantChanges({ promptTemplate: "{{instructions}}", thinking: "low" })).toEqual({ thinking: "low" });
  });
});
