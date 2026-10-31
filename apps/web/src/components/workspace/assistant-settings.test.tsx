import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSettings } from "@ember/protocol";
import { ApiError } from "@/lib/api";
import { AssistantSettings, CONFIRM_STOP_ASSISTANT, WHAT_EMBER_SENDS } from "./assistant-settings";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

/** Answers turning Ember AI off as the server would, or as `stopped` says. */
function serve(stopped: () => Response | Promise<Response> = () => Response.json({ assistant: null })) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (`${init?.method} ${String(input)}` === "DELETE /api/account/assistant") return stopped();
    throw new Error(`Unexpected request for ${init?.method} ${String(input)}`);
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
  const callbacks = { onSetUp: vi.fn(), onStopped: vi.fn(), onFailed: vi.fn() };
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
    const { user, onSetUp } = showCard({ accountId: ACCOUNT_ID, model: "anthropic/claude-sonnet-5.5" });
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
    showCard({ accountId: ACCOUNT_ID, model: "mistral/mistral-large-3" });
    expect(card()).toHaveTextContent("@ember runs on mistral/mistral-large-3 through Cloudflare AI Gateway.");
  });

  it("turns Ember AI off once the administrator confirms turning its switch off", async () => {
    const answer = held(() => Response.json({ assistant: null }));
    const fetch = serve(answer.answered);
    const sure = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { user, onStopped } = showCard({ accountId: ACCOUNT_ID, model: "@cf/zai-org/glm-4.7-flash" });
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
    const { user, onStopped, onFailed } = showCard({ accountId: ACCOUNT_ID, model: "@cf/zai-org/glm-4.7-flash" });
    await user.click(assistantSwitch());
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(403, "Only administrators can set up Ember AI")));
    expect(onStopped).not.toHaveBeenCalled();
    expect(assistantSwitch()).toBeChecked();
    expect(assistantSwitch()).toBeEnabled();
  });
});
