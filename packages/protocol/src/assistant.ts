// Ember AI, which answers as @ember through Cloudflare's AI Gateway, as administrators set it up on the
// AI assistant tab of workspace settings through `/api/account/assistant`.

/**
 * The API formats AI Gateway's REST API takes a model's requests in, at `/ai/v1/messages`,
 * `/ai/v1/responses` and `/ai/v1/chat/completions`: Anthropic's models take only Messages, some of
 * OpenAI's only Responses, and most others Chat Completions.
 */
export const MODEL_FORMATS = ["messages", "responses", "chat"] as const;
export type ModelFormat = (typeof MODEL_FORMATS)[number];

/** A model Set up Ember AI lists, with what to call it and the format AI Gateway takes its requests in. */
export interface AssistantModel {
  id: string;
  name: string;
  format: ModelFormat;
}

/**
 * The models Set up Ember AI lists, Workers AI's first, which come with Cloudflare's free daily
 * allowance, then other companies', which AI Gateway's credits pay for. Any other model in Cloudflare's
 * catalog can be typed in.
 */
export const ASSISTANT_MODELS: readonly AssistantModel[] = [
  { id: "@cf/zai-org/glm-4.7-flash", name: "GLM-4.7 Flash", format: "chat" },
  { id: "@cf/google/gemma-4-26b-a4b-it", name: "Gemma 4 26B", format: "chat" },
  { id: "@cf/openai/gpt-oss-120b", name: "gpt-oss-120b", format: "chat" },
  { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5", format: "messages" },
  { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", format: "messages" },
  { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", format: "messages" },
  { id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol", format: "responses" },
  { id: "openai/gpt-6.1-terra", name: "GPT-6.1 Terra", format: "responses" },
  { id: "google/gemini-4-argon", name: "Gemini 4 Argon", format: "chat" },
  { id: "google/gemini-3.7-flash", name: "Gemini 3.7 Flash", format: "chat" },
  { id: "moonshotai/kimi-k3", name: "Kimi K3", format: "chat" },
];

/** Whether `model` is one of Workers AI's, which Cloudflare runs itself, rather than another company's. */
export const isWorkersAiModel = (model: string) => model.startsWith("@cf/");

/** What to call `model`: its name in the list Set up Ember AI shows, or else its ID. */
export const modelName = (model: string) => ASSISTANT_MODELS.find(({ id }) => id === model)?.name ?? model;

/** Ember AI as the AI assistant tab shows it to administrators while it's on: the Cloudflare account it asks through, and its model. */
export interface AssistantSettings {
  accountId: string;
  model: string;
}

/**
 * What Set up Ember AI gives `PUT /api/account/assistant`: the Cloudflare account's ID, an API token of
 * its with the Workers AI Read permission, which a change can leave out to keep the one Ember has, and
 * the ID of the model to answer with.
 */
export interface AssistantSetup {
  accountId: string;
  apiToken?: string;
  model: string;
}

/** What `PUT /api/account/assistant` answers once the model answered its test question: Ember AI as it is then, and what the model said. */
export interface AssistantSaved {
  assistant: AssistantSettings;
  greeting: string;
}

/** What `DELETE /api/account/assistant` answers: Ember AI is off. */
export interface AssistantForgotten {
  assistant: null;
}

/** A field of Set up Ember AI, which a refusal can be about. */
export type AssistantField = keyof AssistantSetup;

/** The longest model ID Ember takes, where Cloudflare's are a few dozen characters. */
export const MAX_MODEL_LENGTH = 200;

/** The longest API token Ember takes, which goes in a header of each request to Cloudflare. */
const MAX_API_TOKEN_LENGTH = 200;

/** Why Set up Ember AI's fields are refused before Cloudflare is asked about them. */
export const ACCOUNT_ID_REFUSED = "An account ID is 32 letters and digits. Copy it from Account home in the Cloudflare dashboard.";
export const API_TOKEN_REFUSED = "Paste an API token from Account API tokens in the Cloudflare dashboard.";
export const MODEL_REFUSED = "A model's ID has a slash, such as anthropic/claude-sonnet-5.5. Copy it from Cloudflare's model catalog.";

/** The Cloudflare account ID `text` gives, without the spaces around it and in small letters, or null when it can't be one: 32 hexadecimal digits. */
export function accountIdOf(text: string): string | null {
  const accountId = text.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(accountId) ? accountId : null;
}

/** The Cloudflare API token `text` gives, without the spaces around it, or null when it can't be one: tokens have no spaces, and are a few dozen characters. */
export function apiTokenOf(text: string): string | null {
  const apiToken = text.trim();
  return apiToken.length >= 20 && apiToken.length <= MAX_API_TOKEN_LENGTH && /^[\x21-\x7e]+$/.test(apiToken) ? apiToken : null;
}

/**
 * The model ID `text` gives, without the spaces around it, or null when it can't be one: Cloudflare's
 * name the company and then the model, as `company/model`, and Workers AI's start with `@cf/`.
 */
export function modelOf(text: string): string | null {
  const model = text.trim();
  return model.length <= MAX_MODEL_LENGTH && /^@?[\w.-]+(?:\/[\w.:@-]+)+$/.test(model) ? model : null;
}

/**
 * What `PUT /api/account/assistant` gives Ember, as Set up Ember AI sends it, or why it can't be one, on
 * the field it's about. A blank API token is left out, keeping the one Ember has.
 */
export function parseAssistantSetup(data: unknown): AssistantSetup | { error: string; field: AssistantField } {
  const given = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const accountId = typeof given.accountId === "string" ? accountIdOf(given.accountId) : null;
  if (accountId === null) return { error: ACCOUNT_ID_REFUSED, field: "accountId" };
  const { apiToken: typed } = given;
  if (typed !== undefined && typeof typed !== "string") return { error: API_TOKEN_REFUSED, field: "apiToken" };
  const apiToken = typed === undefined || typed.trim() === "" ? undefined : apiTokenOf(typed);
  if (apiToken === null) return { error: API_TOKEN_REFUSED, field: "apiToken" };
  const model = typeof given.model === "string" ? modelOf(given.model) : null;
  if (model === null) return { error: MODEL_REFUSED, field: "model" };
  return apiToken === undefined ? { accountId, model } : { accountId, apiToken, model };
}

/** What the AI assistant tab tells anyone but an administrator. */
export const ASSISTANT_FORBIDDEN = "Only administrators can set up Ember AI";
