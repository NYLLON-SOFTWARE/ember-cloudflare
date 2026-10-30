import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_PASSWORD_WRONG, MAX_PASSWORD_LENGTH, MEMBERFUL_CONNECTIONS_PATH, type MemberfulConnectionStart } from "@ember/protocol";
import { ApiError } from "@/lib/api";
import { openPage } from "@/lib/page";
import { MemberfulConnection } from "./memberful-connection";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn(), openPage: vi.fn() }));

/** Where the Memberful site signs you in to connect your account there. */
const MEMBERFUL_OAUTH = "https://example.memberful.com/oauth?response_type=code&client_id=ember&state=s7a7e";

/** Answers Connect Memberful as `answer` says: by default, with where to sign in at the Memberful site. */
const serve = (answer = () => Response.json({ memberfulConnection: MEMBERFUL_OAUTH }, { status: 202 })) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => answer());

/** What each Connect Memberful sent, in order. */
const sent = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([input, init]) => String(input) === MEMBERFUL_CONNECTIONS_PATH && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as MemberfulConnectionStart);

function showSection({ connected = false, hasPassword = true, membershipNeeded = true } = {}) {
  const onFailed = vi.fn();
  render(<MemberfulConnection connected={connected} hasPassword={hasPassword} membershipNeeded={membershipNeeded} onFailed={onFailed} />);
  return { onFailed, user: userEvent.setup() };
}

const section = () => screen.getByRole("region", { name: "Memberful" });
const connectButton = () => screen.getByRole("button", { name: "Connect Memberful" });

beforeEach(() => serve());

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(openPage).mockClear();
});

describe("Connect Memberful", () => {
  it("asks a member to connect their Memberful account with their password, to keep signing in as themselves", () => {
    showSection();
    expect(section()).toHaveTextContent("Members sign in with Memberful. Connect your Memberful account to keep signing in as yourself.");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toHaveAttribute("placeholder", "Enter your password");
    expect(password).toHaveAttribute("maxlength", String(MAX_PASSWORD_LENGTH));
    expect(password).toBeRequired();
    expect(connectButton()).toBeEnabled();
  });

  it("tells an administrator, or someone they invited, who needs no membership, that they can sign in with it too", () => {
    showSection({ membershipNeeded: false });
    expect(section()).toHaveTextContent("Members sign in with Memberful. Connect your Memberful account to sign in with it too.");
  });

  it("goes to sign in at the Memberful site once your password checks out, staying busy meanwhile", async () => {
    const { user, onFailed } = showSection();
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(connectButton());
    await waitFor(() => expect(openPage).toHaveBeenCalledWith(MEMBERFUL_OAUTH));
    expect(sent()).toEqual([{ currentPassword: "correct horse" }]);
    expect(connectButton()).toBeDisabled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("asks for no password while you have none", async () => {
    const { user } = showSection({ hasPassword: false });
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.click(connectButton());
    await waitFor(() => expect(openPage).toHaveBeenCalledWith(MEMBERFUL_OAUTH));
    expect(sent()).toEqual([{}]);
  });

  it("says why it didn't start, emptying your password for another try", async () => {
    serve(() => Response.json({ error: CURRENT_PASSWORD_WRONG }, { status: 422 }));
    const { user, onFailed } = showSection();
    const password = screen.getByLabelText("Password");
    await user.type(password, "wrong horse");
    await user.click(connectButton());
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(onFailed.mock.calls[0]![0]).toEqual(new ApiError(422, CURRENT_PASSWORD_WRONG));
    expect(password).toHaveValue("");
    expect(connectButton()).toBeEnabled();
    expect(openPage).not.toHaveBeenCalled();
  });

  it("says once you've connected one", () => {
    showSection({ connected: true });
    expect(section()).toHaveTextContent("Your Memberful account is connected, so you sign in with it.");
    expect(screen.queryByRole("button", { name: "Connect Memberful" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("tells someone who needs no membership, and has connected one, that they can sign in with it too", () => {
    showSection({ connected: true, membershipNeeded: false });
    expect(section()).toHaveTextContent("Your Memberful account is connected, so you can sign in with it too.");
  });
});
