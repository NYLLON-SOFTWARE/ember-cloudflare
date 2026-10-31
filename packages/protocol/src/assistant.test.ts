import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ID_REFUSED,
  ANSWER_LENGTHS,
  ANSWER_WORDS,
  API_TOKEN_REFUSED,
  ASSISTANT_MODELS,
  DEFAULT_LEVELS,
  isWorkersAiModel,
  MAX_MODEL_LENGTH,
  MODEL_FORMATS,
  MODEL_REFUSED,
  modelName,
  modelOf,
  parseAssistantSetup,
  parseLevelChanges,
  THINKING_LEVELS,
  THINKING_TOKENS,
  TOP_LEVELS,
  withinMost,
} from "./assistant";
import { MAX_MESSAGE_LENGTH } from "./index";

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

  it("leaves a blank or missing API token out, which keeps the one Ember has", () => {
    expect(parseAssistantSetup({ accountId: ACCOUNT_ID, apiToken: "  ", model: "openai/gpt-5.5" })).toEqual({ accountId: ACCOUNT_ID, model: "openai/gpt-5.5" });
    expect(parseAssistantSetup({ accountId: ACCOUNT_ID, model: "openai/gpt-5.5" })).toEqual({ accountId: ACCOUNT_ID, model: "openai/gpt-5.5" });
  });

  it.each([
    ["nothing", null, { error: ACCOUNT_ID_REFUSED, field: "accountId" }],
    ["an account ID too short", { accountId: ACCOUNT_ID.slice(1), apiToken: API_TOKEN, model: "openai/gpt-5.5" }, { error: ACCOUNT_ID_REFUSED, field: "accountId" }],
    ["an account ID that isn't hexadecimal", { accountId: `${ACCOUNT_ID.slice(1)}g`, apiToken: API_TOKEN, model: "openai/gpt-5.5" }, { error: ACCOUNT_ID_REFUSED, field: "accountId" }],
    ["an API token too short", { accountId: ACCOUNT_ID, apiToken: "short", model: "openai/gpt-5.5" }, { error: API_TOKEN_REFUSED, field: "apiToken" }],
    ["an API token with a space in it", { accountId: ACCOUNT_ID, apiToken: `${API_TOKEN} ${API_TOKEN}`, model: "openai/gpt-5.5" }, { error: API_TOKEN_REFUSED, field: "apiToken" }],
    ["an API token that isn't text", { accountId: ACCOUNT_ID, apiToken: 7, model: "openai/gpt-5.5" }, { error: API_TOKEN_REFUSED, field: "apiToken" }],
    ["no model", { accountId: ACCOUNT_ID, apiToken: API_TOKEN }, { error: MODEL_REFUSED, field: "model" }],
    ["a model without its company", { accountId: ACCOUNT_ID, apiToken: API_TOKEN, model: "gpt-5.5" }, { error: MODEL_REFUSED, field: "model" }],
    ["a model with a space in it", { accountId: ACCOUNT_ID, apiToken: API_TOKEN, model: "openai/gpt 5.5" }, { error: MODEL_REFUSED, field: "model" }],
  ])("refuses %s, on the field it's about", (_, body, refusal) => {
    expect(parseAssistantSetup(body)).toEqual(refusal);
  });

  it("takes a model ID as Cloudflare's catalog writes them, up to the longest Ember keeps", () => {
    for (const model of ["@cf/zai-org/glm-4.7-flash", "openai/gpt-6.1-sol", "google/gemini-3.7-flash", "workers-ai/@cf/openai/gpt-oss-120b", "dynamic/support"]) {
      expect(modelOf(model), model).toBe(model);
    }
    const longest = `openai/${"x".repeat(MAX_MODEL_LENGTH - 7)}`;
    expect(modelOf(longest)).toBe(longest);
    expect(modelOf(`${longest}x`)).toBeNull();
  });

  it("lists models Workers AI runs first, each once, in a format AI Gateway takes", () => {
    const ids = ASSISTANT_MODELS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => modelOf(id) === id)).toBe(true);
    expect(ASSISTANT_MODELS.every(({ format }) => MODEL_FORMATS.includes(format))).toBe(true);
    const firstOther = ids.findIndex((id) => !isWorkersAiModel(id));
    expect(firstOther).toBeGreaterThan(0);
    expect(ids.slice(firstOther).some(isWorkersAiModel)).toBe(false);
    expect(ASSISTANT_MODELS.filter(({ id }) => id.startsWith("anthropic/")).every(({ format }) => format === "messages")).toBe(true);
  });

  it("names a listed model, and any other by its ID", () => {
    expect(modelName("anthropic/claude-sonnet-5.5")).toBe("Claude Sonnet 5.5");
    expect(modelName("openai/gpt-5.5")).toBe("openai/gpt-5.5");
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

  it("change a dial or both, to a level it has", () => {
    expect(parseLevelChanges({ thinking: "high" })).toEqual({ thinking: "high" });
    expect(parseLevelChanges({ length: "short" })).toEqual({ length: "short" });
    expect(parseLevelChanges({ thinking: "off", length: "long", other: true })).toEqual({ thinking: "off", length: "long" });
    for (const data of [{}, null, "low", [], { thinking: "max" }, { length: "longest" }, { thinking: "low", length: 3 }, { thinking: null }]) {
      expect(parseLevelChanges(data)).toBeNull();
    }
  });
});
