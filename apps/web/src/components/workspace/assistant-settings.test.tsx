import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSettings } from "@ember/protocol";
import { ASSISTANT_OFF, TOP_LEVELS, type AnswerLevelChanges, type AnswerLevels, type AssistantSettings as Assistant } from "@ember/protocol/assistant";
import { ApiError } from "@/lib/api";
import { AssistantSettings, CONFIRM_STOP_ASSISTANT, LIMITS_EXPLAINED, WHAT_EMBER_SENDS } from "./assistant-settings";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

/** Ember AI on, running on `model`, with `most` the most its dials go to. */
const on = (model: string, most: AnswerLevels = TOP_LEVELS): Assistant => ({ accountId: ACCOUNT_ID, model, most });

/** Answers turning Ember AI off, and changing the most its dials go to, as the server would, or as `stopped` and `changed` say. */
function serve(
  stopped: () => Response | Promise<Response> = () => Response.json({ assistant: null }),
  changed: (changes: AnswerLevelChanges) => Response | Promise<Response> = (changes) => Response.json({ assistant: on("@cf/zai-org/glm-4.7-flash", { ...TOP_LEVELS, ...changes }) }),
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method} ${String(input)}`;
    if (request === "DELETE /api/account/assistant") return stopped();
    if (request === "PATCH /api/account/assistant") return changed(JSON.parse(String(init?.body)) as AnswerLevelChanges);
    throw new Error(`Unexpected request for ${request}`);
  });
}

/** A response the test lets through when it says, with `answer` letting it through. */
function held(response: () => Response) {
  let answer = () => {};
  const answered = new Promise<Response>((resolve) => (answer = () => resolve(response())));
  return { answered: () => answered, answer: () => act(async () => answer()) };
}

/** The card, for a workspace whose Ember AI is `assistant`. */
function showCard(assistant: WorkspaceSettings["assistant"]) {
  const callbacks = { onSetUp: vi.fn(), onStopped: vi.fn(), onChanged: vi.fn(), onFailed: vi.fn() };
  render(<AssistantSettings assistant={assistant} {...callbacks} />);
  return { ...callbacks, user: userEvent.setup() };
}

const card = () => screen.getByRole("region", { name: "Ember AI" });
const assistantSwitch = () => within(card()).getByRole("switch", { name: "Ember AI" });

afterEach(() => vi.restoreAllMocks());

describe("Ember AI", () => {
  it("says what Ember AI adds while its switch is off, which turning on opens Set up Ember AI", async () => {
    serve();
    const { user, onSetUp } = showCard(null);
    const description =
      "Ember AI adds @ember, an AI assistant, to every room open to everyone, running on a model you choose through Cloudflare AI Gateway.";
    expect(card()).toHaveTextContent(description);
    expect(card()).not.toHaveTextContent(WHAT_EMBER_SENDS);
    expect(assistantSwitch()).not.toBeChecked();
    expect(assistantSwitch()).toHaveAccessibleDescription(description);
    expect(within(card()).queryAllByRole("button")).toEqual([]);
    await user.click(assistantSwitch());
    expect(onSetUp).toHaveBeenCalledOnce();
    // It stays off until a model has answered.
    expect(assistantSwitch()).not.toBeChecked();
  });

  it("names the model @ember runs on, its switch on, with Change", async () => {
    serve();
    const { user, onSetUp } = showCard(on("anthropic/claude-sonnet-5.5"));
    expect(card()).toHaveTextContent("@ember runs on Claude Sonnet 5.5 through Cloudflare AI Gateway.");
    // Who reads what @ember is asked: the model's provider, through Cloudflare.
    expect(card()).toHaveTextContent(WHAT_EMBER_SENDS);
    expect(assistantSwitch()).toBeChecked();
    expect(assistantSwitch()).toBeEnabled();
    expect(within(card()).getAllByRole("button").map((button) => button.textContent)).toEqual(["Change"]);
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(onSetUp).toHaveBeenCalledOnce();
  });

  it("names a model it doesn't list by its ID", () => {
    serve();
    showCard(on("mistral/mistral-large-3"));
    expect(card()).toHaveTextContent("@ember runs on mistral/mistral-large-3 through Cloudflare AI Gateway.");
  });

  it("turns Ember AI off once the administrator confirms turning its switch off", async () => {
    const answer = held(() => Response.json({ assistant: null }));
    const fetch = serve(answer.answered);
    const sure = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { user, onStopped } = showCard(on("@cf/zai-org/glm-4.7-flash"));
    await user.click(assistantSwitch());
    expect(sure).toHaveBeenCalledWith(CONFIRM_STOP_ASSISTANT);
    expect(fetch).not.toHaveBeenCalled();
    expect(assistantSwitch()).toBeChecked();

    await user.click(assistantSwitch());
    expect(fetch).toHaveBeenCalledWith("/api/account/assistant", expect.objectContaining({ method: "DELETE" }));
    expect(assistantSwitch()).not.toBeChecked();
    expect(assistantSwitch()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change" })).toBeDisabled();
    await answer.answer();
    expect(onStopped).toHaveBeenCalledOnce();
    expect(assistantSwitch()).toBeEnabled();
  });

  it("leaves turning it off that failed to the page's alerts, its switch back on", async () => {
    serve(() => Response.json({ error: "Only administrators can set up Ember AI" }, { status: 403 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user, onStopped, onFailed } = showCard(on("@cf/zai-org/glm-4.7-flash"));
    await user.click(assistantSwitch());
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(403, "Only administrators can set up Ember AI")));
    expect(onStopped).not.toHaveBeenCalled();
    expect(assistantSwitch()).toBeChecked();
    expect(assistantSwitch()).toBeEnabled();
  });
});

describe("Limits", () => {
  const dial = (name: string) => within(card()).getByRole("group", { name });
  const level = (name: string) => within(card()).getByRole("radio", { name });

  it("has the most @ember may think and write for anyone's question while Ember AI is on, any level allowed", () => {
    serve();
    showCard(on("anthropic/claude-sonnet-5.5", { thinking: "medium", length: "long" }));
    expect(card()).toHaveTextContent(LIMITS_EXPLAINED);
    expect(within(dial("Thinking")).getByRole("radio", { name: "Medium" })).toBeChecked();
    expect(dial("Thinking")).toHaveAccessibleDescription("Thinks more first, up to about 16,000 tokens.");
    for (const name of ["Off", "Low", "High"]) expect(level(name)).toBeEnabled();
    expect(level("Long")).toBeChecked();
    expect(dial("Answer length")).toHaveAccessibleDescription("About 1,500 words, nearly all one message holds.");
  });

  it("has none while Ember AI is off", () => {
    serve();
    showCard(null);
    expect(within(card()).queryAllByRole("group")).toEqual([]);
  });

  it("saves a change at once, showing it meanwhile", async () => {
    const answer = held(() => Response.json({ assistant: on("@cf/zai-org/glm-4.7-flash", { thinking: "low", length: "long" }) }));
    const fetch = serve(undefined, answer.answered);
    const shown = on("@cf/zai-org/glm-4.7-flash");
    const { user, onChanged } = showCard(shown);
    await user.click(level("Low"));
    expect(fetch).toHaveBeenCalledWith("/api/account/assistant", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ thinking: "low" }) }));
    expect(onChanged).toHaveBeenCalledWith({ ...shown, most: { thinking: "low", length: "long" } });
    expect(level("Off")).toBeDisabled();
    await answer.answer();
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(level("Off")).toBeEnabled();
  });

  it("can't be turned off or changed while a change saves, so that its answer can't show Ember AI as it was", async () => {
    const answer = held(() => Response.json({ assistant: on("@cf/zai-org/glm-4.7-flash", { thinking: "low", length: "long" }) }));
    serve(undefined, answer.answered);
    const { user } = showCard(on("@cf/zai-org/glm-4.7-flash"));
    await user.click(level("Low"));
    expect(assistantSwitch()).toBeDisabled();
    expect(within(card()).getByRole("button", { name: "Change" })).toBeDisabled();
    await answer.answer();
    expect(assistantSwitch()).toBeEnabled();
    expect(within(card()).getByRole("button", { name: "Change" })).toBeEnabled();
  });

  it("shows the most as it was again when a change isn't saved, leaving why to the page's alerts", async () => {
    serve(undefined, () => Response.json({ error: ASSISTANT_OFF }, { status: 409 }));
    const shown = on("@cf/zai-org/glm-4.7-flash");
    const { user, onChanged, onFailed } = showCard(shown);
    await user.click(level("Short"));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(409, ASSISTANT_OFF)));
    expect(onChanged.mock.calls).toEqual([[{ ...shown, most: { thinking: "high", length: "short" } }], [shown]]);
    expect(level("Short")).toBeEnabled();
  });
});
