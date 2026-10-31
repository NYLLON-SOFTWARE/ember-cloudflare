import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ID_REFUSED,
  API_TOKEN_REFUSED,
  ASSISTANT_MODELS,
  isWorkersAiModel,
  MAX_MODEL_LENGTH,
  MODEL_FORMATS,
  MODEL_REFUSED,
  modelName,
  modelOf,
  parseAssistantSetup,
} from "./assistant";

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
