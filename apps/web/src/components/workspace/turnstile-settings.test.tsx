import { feature } from "@ember/parity";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSettings } from "@ember/protocol";
import { ApiError } from "@/lib/api";
import { CONFIRM_STOP_TURNSTILE, TurnstileSettings } from "./turnstile-settings";

/** Answers Stop using Turnstile as the server would, or as `stopped` says. */
function serve(stopped: () => Response | Promise<Response> = () => Response.json({ turnstile: null })) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (`${init?.method} ${String(input)}` === "DELETE /api/account/turnstile_keys") return stopped();
    throw new Error(`Unexpected request for ${init?.method} ${String(input)}`);
  });
}

/** A response the test lets through when it says, with `answer` letting it through. */
function held(response: () => Response) {
  let answer = () => {};
  const answered = new Promise<Response>((resolve) => (answer = () => resolve(response())));
  return { answered: () => answered, answer: () => act(async () => answer()) };
}

/** The card, for a workspace whose Turnstile keys come from `turnstile`. */
function showCard(turnstile: WorkspaceSettings["turnstile"]) {
  const callbacks = { onSetUp: vi.fn(), onStopped: vi.fn(), onFailed: vi.fn() };
  render(<TurnstileSettings turnstile={turnstile} {...callbacks} />);
  return { ...callbacks, user: userEvent.setup() };
}

const card = () => screen.getByRole("region", { name: "Turnstile" });
const stopButton = () => screen.queryByRole("button", { name: "Stop using Turnstile" });

afterEach(() => vi.restoreAllMocks());

describe(feature("auth.turnstile"), () => {
  it("says limits stand in for Turnstile's check until it's set up, with Set up Turnstile", async () => {
    serve();
    const { user, onSetUp } = showCard(null);
    expect(card()).toHaveTextContent(
      "Cloudflare Turnstile can check that whoever signs up, or asks Ember to email them a link to join or a code to reset a password, is a person. Until it does, limits on each network stand in for its check.",
    );
    expect(stopButton()).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up Turnstile" }));
    expect(onSetUp).toHaveBeenCalledOnce();
  });

  it("says Turnstile checks people with the keys given, with Change and Stop using Turnstile in a row", async () => {
    serve();
    const { user, onSetUp } = showCard("saved");
    expect(card()).toHaveTextContent("Cloudflare Turnstile checks that whoever signs up, or asks Ember to email them a link to join or a code to reset a password, is a person.");
    const buttons = within(card()).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Change", "Stop using Turnstile"]);
    expect(new Set(buttons.map((button) => button.parentElement)).size).toBe(1);
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(onSetUp).toHaveBeenCalledOnce();
  });

  it("says the deployment's secrets give the keys, which nothing here changes", () => {
    serve();
    showCard("secret");
    expect(card()).toHaveTextContent(
      "Cloudflare Turnstile checks that whoever signs up, or asks Ember to email them a link to join or a code to reset a password, is a person, with the widget whose keys are in TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.",
    );
    expect(within(card()).queryAllByRole("button")).toEqual([]);
  });

  it("takes the keys away once the administrator confirms Stop using Turnstile", async () => {
    const answer = held(() => Response.json({ turnstile: null }));
    const fetch = serve(answer.answered);
    const sure = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { user, onStopped } = showCard("saved");
    await user.click(stopButton()!);
    expect(sure).toHaveBeenCalledWith(CONFIRM_STOP_TURNSTILE);
    expect(fetch).not.toHaveBeenCalled();

    await user.click(stopButton()!);
    expect(fetch).toHaveBeenCalledWith("/api/account/turnstile_keys", expect.objectContaining({ method: "DELETE" }));
    expect(stopButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change" })).toBeDisabled();
    await answer.answer();
    expect(onStopped).toHaveBeenCalledExactlyOnceWith(null);
    expect(stopButton()).toBeEnabled();
  });

  it("leaves Stop using Turnstile that failed to the page's alerts", async () => {
    serve(() => Response.json({ error: "Only administrators can change the workspace" }, { status: 403 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user, onStopped, onFailed } = showCard("saved");
    await user.click(stopButton()!);
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(403, "Only administrators can change the workspace")));
    expect(onStopped).not.toHaveBeenCalled();
    expect(stopButton()).toBeEnabled();
  });
});
