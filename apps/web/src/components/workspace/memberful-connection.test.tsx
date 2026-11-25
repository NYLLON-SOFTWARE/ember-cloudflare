import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_PASSWORD_WRONG,
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_PASSWORD_LENGTH,
  MEMBERFUL_CONNECTION_CODES_PATH,
  MEMBERFUL_CONNECTIONS_PATH,
  MEMBERFUL_SIGN_IN_PROBLEMS,
  PASSWORD_RESET_CODE_WRONG,
  type MemberfulAccount,
  type MemberfulCodeSignIn,
  type MemberfulConnectionCodeRequest,
  type MemberfulConnectionStart,
  type MemberfulDisconnection,
  type ProfileAnswer,
} from "@ember/protocol";
import { ApiError } from "@/lib/api";
import { openPage } from "@/lib/page";
import { MemberfulConnection } from "./memberful-connection";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn(), openPage: vi.fn() }));

/** Where the Memberful site signs you in to connect your account there. */
const MEMBERFUL_OAUTH = "https://example.memberful.com/oauth?response_type=code&client_id=ember&state=s7a7e";
/** Grace's Memberful account, as Memberful describes it. */
const grace: MemberfulAccount = { name: "Grace Hopper", emailAddress: "grace@example.com" };
/** Your profile once your Memberful account is disconnected, as disconnecting answers it. */
const DISCONNECTED: ProfileAnswer = {
  profile: {
    name: "Grace Hopper",
    username: null,
    emailAddress: "grace@example.com",
    bio: null,
    avatarUrl: "/users/t0k3n/avatar?v=1",
    avatar: false,
    password: true,
    membershipNeeded: true,
    memberful: { membersOnly: true, connected: null },
    sso: null,
    assistant: null,
    apps: [],
    outsideAi: null,
  },
  transferId: "u2.mgk3x2b0.saved",
};
/** Your profile once your Memberful account is connected, as connecting with a code answers it. */
const CONNECTED: ProfileAnswer = { ...DISCONNECTED, profile: { ...DISCONNECTED.profile, memberful: { membersOnly: true, connected: grace } } };
/** Where this browser's push subscription takes its pushes, when it has one. */
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/desk";

/** Answers Connect Memberful with where to sign in at the Memberful site, and Disconnect Memberful with your profile, or as `answer` says. */
const serve = (answer?: () => Response) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => answer?.() ?? (init?.method === "DELETE" ? Response.json(DISCONNECTED) : Response.json({ memberfulConnection: MEMBERFUL_OAUTH }, { status: 202 })));

/** What each request to `path` with `method` sent, in order. */
const sentTo = <T,>(path: string, method: string) =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([input, init]) => String(input) === path && init?.method === method)
    .map(([, init]) => JSON.parse(String(init?.body)) as T);

/** What each request to connect or disconnect sent, in order. */
const sent = <T extends MemberfulConnectionStart | MemberfulDisconnection>(method: "POST" | "DELETE") => sentTo<T>(MEMBERFUL_CONNECTIONS_PATH, method);

function showSection({
  connected = null as MemberfulAccount | null,
  membersOnly = true,
  codes = false,
  hasPassword = true,
  hasEmailAddress = true,
  membershipNeeded = true,
} = {}) {
  const [onConnected, onDisconnected, onFailed] = [vi.fn(), vi.fn(), vi.fn()];
  render(
    <MemberfulConnection
      connected={connected}
      membersOnly={membersOnly}
      codes={codes}
      emailAddress="grace@example.com"
      hasPassword={hasPassword}
      hasEmailAddress={hasEmailAddress}
      membershipNeeded={membershipNeeded}
      onConnected={onConnected}
      onDisconnected={onDisconnected}
      onFailed={onFailed}
    />,
  );
  return { onConnected, onDisconnected, onFailed, user: userEvent.setup() };
}

const section = () => screen.getByRole("region", { name: "Memberful" });
const connectButton = () => screen.getByRole("button", { name: "Connect Memberful" });
const disconnectButton = () => screen.getByRole("button", { name: "Disconnect Memberful" });

beforeEach(() => serve());

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(openPage).mockClear();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("Connect Memberful", () => {
  it("asks a member to connect their Memberful account with their password, to keep signing in as themselves", () => {
    showSection();
    expect(section()).toHaveTextContent("Members sign in with Memberful. Connect your Memberful account to keep signing in.");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toHaveAttribute("placeholder", "Enter your password");
    expect(password).toHaveAttribute("maxlength", String(MAX_PASSWORD_LENGTH));
    expect(password).toBeRequired();
    expect(password).toHaveAccessibleDescription("Members sign in with Memberful. Connect your Memberful account to keep signing in.");
    expect(connectButton()).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Disconnect Memberful" })).not.toBeInTheDocument();
  });

  it("tells an administrator, or someone they invited, who needs no membership, that they can sign in with it too", () => {
    showSection({ membershipNeeded: false });
    expect(section()).toHaveTextContent("Connect your Memberful account to sign in with it.");
  });

  it("goes to sign in at the Memberful site once your password checks out, staying busy meanwhile", async () => {
    const { user, onFailed } = showSection();
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(connectButton());
    await waitFor(() => expect(openPage).toHaveBeenCalledWith(MEMBERFUL_OAUTH));
    expect(sent("POST")).toEqual([{ currentPassword: "correct horse" }]);
    expect(connectButton()).toBeDisabled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("asks for no password while you have none", async () => {
    const { user } = showSection({ hasPassword: false });
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.click(connectButton());
    await waitFor(() => expect(openPage).toHaveBeenCalledWith(MEMBERFUL_OAUTH));
    expect(sent("POST")).toEqual([{}]);
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
});

describe("Connect Memberful with a code Ember emails", () => {
  /** Answers asking for a code with 202, and connecting with one with your profile, or as `answer` says, and Connect Memberful as `serve` does. */
  const serveCodes = (answer?: (method: string) => Response) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) !== MEMBERFUL_CONNECTION_CODES_PATH) return Response.json({ memberfulConnection: MEMBERFUL_OAUTH }, { status: 202 });
      return answer?.(init?.method ?? "GET") ?? (init?.method === "PUT" ? Response.json(CONNECTED) : Response.json({}, { status: 202 }));
    });

  const emailAddressField = () => screen.getByLabelText("Memberful email address");
  const askButton = () => screen.getByRole("button", { name: "Email me a code" });
  const asked = () => sentTo<MemberfulConnectionCodeRequest>(MEMBERFUL_CONNECTION_CODES_PATH, "POST");
  const tried = () => sentTo<MemberfulCodeSignIn>(MEMBERFUL_CONNECTION_CODES_PATH, "PUT");

  beforeEach(() => serveCodes());

  it("asks for the address your Memberful account has, offering yours, and your password, with Memberful's page the other way", () => {
    showSection({ codes: true });
    expect(section()).toHaveTextContent("Members sign in with Memberful. Connect your Memberful account to keep signing in.");
    const emailAddress = emailAddressField();
    expect(emailAddress).toHaveValue("grace@example.com");
    expect(emailAddress).toHaveAttribute("type", "email");
    expect(emailAddress).toHaveAttribute("maxlength", String(MAX_EMAIL_ADDRESS_LENGTH));
    expect(emailAddress).toBeRequired();
    // Nothing on the profile page takes the focus as it opens.
    expect(emailAddress).not.toHaveFocus();
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toBeRequired();
    expect(password).toHaveAccessibleDescription("Members sign in with Memberful. Connect your Memberful account to keep signing in.");
    expect(askButton()).toBeEnabled();
    expect(section()).toHaveTextContent("Prefer Memberful's page? Connect there");
    expect(screen.queryByRole("button", { name: "Connect Memberful" })).not.toBeInTheDocument();
  });

  it("emails a code once your password checks out, which connects the account, showing your profile as it answers", async () => {
    const { user, onConnected, onFailed } = showSection({ codes: true });
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(askButton());
    await screen.findByText("If a Memberful account has grace@example.com, Ember emailed it a code that works for 15 minutes. If it hasn't arrived soon, look in your spam folder.");
    expect(asked()).toEqual([{ currentPassword: "correct horse", emailAddress: "grace@example.com" }]);
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    const code = screen.getByLabelText("Code");
    expect(code).toHaveFocus();
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toBeRequired();

    await user.type(code, "12345678");
    await user.click(screen.getByRole("button", { name: "Connect Memberful" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(CONNECTED));
    expect(tried()).toEqual([{ emailAddress: "grace@example.com", code: "12345678" }]);
    // The code stays out of the DOM's attributes, as a password does.
    expect(code).not.toHaveAttribute("value");
    expect(onFailed).not.toHaveBeenCalled();
    expect(openPage).not.toHaveBeenCalled();
  });

  it("emails the code to another address you give, and asks for no password while you have none", async () => {
    const { user } = showSection({ codes: true, hasPassword: false });
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.clear(emailAddressField());
    await user.type(emailAddressField(), " grace@navy.example ");
    await user.click(askButton());
    await screen.findByLabelText("Code");
    expect(asked()).toEqual([{ emailAddress: "grace@navy.example" }]);
    expect(section()).toHaveTextContent("If a Memberful account has grace@navy.example, Ember emailed it a code");
  });

  it("says why no code was emailed, emptying your password for another try", async () => {
    serveCodes(() => Response.json({ error: CURRENT_PASSWORD_WRONG }, { status: 422 }));
    const { user, onFailed } = showSection({ codes: true });
    const password = screen.getByLabelText("Password");
    await user.type(password, "wrong horse");
    await user.click(askButton());
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(onFailed.mock.calls[0]![0]).toEqual(new ApiError(422, CURRENT_PASSWORD_WRONG));
    expect(password).toHaveValue("");
    expect(emailAddressField()).toHaveValue("grace@example.com");
    expect(askButton()).toBeEnabled();
  });

  it("says why a code doesn't work, leaving it selected to type again", async () => {
    serveCodes((method) => (method === "PUT" ? Response.json({ error: PASSWORD_RESET_CODE_WRONG }, { status: 422 }) : Response.json({}, { status: 202 })));
    const { user, onConnected, onFailed } = showSection({ codes: true });
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(askButton());
    const code = await screen.findByLabelText<HTMLInputElement>("Code");
    await user.type(code, "87654321");
    await user.click(screen.getByRole("button", { name: "Connect Memberful" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(onFailed.mock.calls[0]![0]).toEqual(new ApiError(422, PASSWORD_RESET_CODE_WRONG));
    expect(code).toHaveFocus();
    expect([code.selectionStart, code.selectionEnd]).toEqual([0, 8]);
    expect(screen.getByRole("button", { name: "Connect Memberful" })).toBeEnabled();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("says why connecting refuses the account, as when it's someone else's here", async () => {
    serveCodes((method) => (method === "PUT" ? Response.json({ error: MEMBERFUL_SIGN_IN_PROBLEMS.claimed }, { status: 403 }) : Response.json({}, { status: 202 })));
    const { user, onFailed } = showSection({ codes: true });
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(askButton());
    await user.type(await screen.findByLabelText("Code"), "12345678");
    await user.click(screen.getByRole("button", { name: "Connect Memberful" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(403, MEMBERFUL_SIGN_IN_PROBLEMS.claimed)));
  });

  it("goes back to send another code, keeping the address", async () => {
    const { user } = showSection({ codes: true });
    await user.clear(emailAddressField());
    await user.type(emailAddressField(), "grace@navy.example");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(askButton());
    await screen.findByLabelText("Code");
    await user.click(screen.getByRole("button", { name: "Send another code" }));
    expect(emailAddressField()).toHaveValue("grace@navy.example");
    expect(emailAddressField()).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("connects on Memberful's page instead, with your password, which it asks for first", async () => {
    const { user, onFailed } = showSection({ codes: true });
    await user.click(screen.getByRole("button", { name: "Connect there" }));
    expect(sent("POST")).toEqual([]);
    expect(screen.getByLabelText("Password")).toBeInvalid();
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Connect there" }));
    await waitFor(() => expect(openPage).toHaveBeenCalledWith(MEMBERFUL_OAUTH));
    expect(sent("POST")).toEqual([{ currentPassword: "correct horse" }]);
    expect(asked()).toEqual([]);
    expect(askButton()).toBeDisabled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("connects someone without a password on Memberful's page without asking for one", async () => {
    const { user } = showSection({ codes: true, hasPassword: false });
    await user.click(screen.getByRole("button", { name: "Connect there" }));
    await waitFor(() => expect(openPage).toHaveBeenCalledWith(MEMBERFUL_OAUTH));
    expect(sent("POST")).toEqual([{}]);
  });
});

describe("Disconnect Memberful", () => {
  it("names the account you've connected, and offers to disconnect it with your password", () => {
    showSection({ connected: grace });
    expect(section()).toHaveTextContent("Connected as Grace Hopper (grace@example.com). You sign in with Memberful.");
    expect(section()).toHaveTextContent("Disconnecting signs you out everywhere else. You'll be asked to connect again the next time you sign in.");
    expect(screen.queryByRole("button", { name: "Connect Memberful" })).not.toBeInTheDocument();
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toBeRequired();
    expect(password).toHaveAccessibleDescription("Disconnecting signs you out everywhere else. You'll be asked to connect again the next time you sign in.");
    expect(disconnectButton()).toBeEnabled();
  });

  it("tells someone who needs no membership, and has connected one, that they can sign in with it too", () => {
    showSection({ connected: grace, membershipNeeded: false });
    expect(section()).toHaveTextContent("Connected as Grace Hopper (grace@example.com). You can sign in with Memberful or your password.");
    expect(section()).toHaveTextContent("Disconnecting signs you out everywhere else.");
  });

  it("tells a member the same while Memberful isn't members only, since their password signs them in", () => {
    showSection({ connected: grace, membersOnly: false });
    expect(section()).toHaveTextContent("Connected as Grace Hopper (grace@example.com). You can sign in with Memberful or your password.");
    expect(section()).toHaveTextContent("Disconnecting signs you out everywhere else.");
  });

  it.each([
    [{ name: "Grace Hopper", emailAddress: null }, "Connected as Grace Hopper. You sign in with Memberful."],
    [{ name: null, emailAddress: "grace@example.com" }, "Connected as grace@example.com. You sign in with Memberful."],
    [{ name: null, emailAddress: null }, "Your Memberful account is connected. You sign in with Memberful."],
  ])("names the account by what Memberful said of it: %j", (connected, text) => {
    showSection({ connected });
    expect(section()).toHaveTextContent(text);
  });

  it("disconnects it once your password checks out, showing your profile as it answers", async () => {
    const { user, onDisconnected, onFailed } = showSection({ connected: grace });
    const password = screen.getByLabelText("Password");
    await user.type(password, "correct horse");
    await user.click(disconnectButton());
    await waitFor(() => expect(onDisconnected).toHaveBeenCalledWith(DISCONNECTED));
    // Without a push subscription to keep, since this browser has none.
    expect(sent("DELETE")).toEqual([{ currentPassword: "correct horse" }]);
    expect(password).toHaveValue("");
    expect(disconnectButton()).toBeEnabled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(openPage).not.toHaveBeenCalled();
  });

  it("names this browser's push subscription, which disconnecting keeps while it forgets your other browsers'", async () => {
    const registration = { pushManager: { getSubscription: async () => ({ endpoint: ENDPOINT }) } };
    Object.defineProperty(navigator, "serviceWorker", { value: { getRegistration: async () => registration }, configurable: true });
    const { user, onDisconnected } = showSection({ connected: grace });
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(disconnectButton());
    await waitFor(() => expect(onDisconnected).toHaveBeenCalledOnce());
    expect(sent("DELETE")).toEqual([{ currentPassword: "correct horse", pushSubscriptionEndpoint: ENDPOINT }]);
  });

  it("says why it didn't disconnect, emptying your password for another try", async () => {
    serve(() => Response.json({ error: CURRENT_PASSWORD_WRONG }, { status: 422 }));
    const { user, onDisconnected, onFailed } = showSection({ connected: grace });
    const password = screen.getByLabelText("Password");
    await user.type(password, "wrong horse");
    await user.click(disconnectButton());
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(onFailed.mock.calls[0]![0]).toEqual(new ApiError(422, CURRENT_PASSWORD_WRONG));
    expect(password).toHaveValue("");
    expect(disconnectButton()).toBeEnabled();
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it.each([
    ["while Memberful is members only", {}],
    ["even while it isn't, since nothing else signs them in", { membersOnly: false, membershipNeeded: false }],
  ])("offers someone without a password nothing to disconnect, Memberful being how they sign in, %s", (_, settings) => {
    showSection({ connected: grace, hasPassword: false, ...settings });
    expect(section()).toHaveTextContent("Connected as Grace Hopper (grace@example.com). You sign in with Memberful.");
    // Nothing asks them for a password, which they're given none of, nor offers to disconnect it.
    expect(section()).not.toHaveTextContent(/password|disconnect/i);
    expect(screen.queryByRole("button", { name: "Disconnect Memberful" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("asks someone with a password but no email address to add one first, since signing in with a password takes one", () => {
    showSection({ connected: grace, hasEmailAddress: false, membersOnly: false, membershipNeeded: false });
    expect(section()).toHaveTextContent("Connected as Grace Hopper (grace@example.com). You sign in with Memberful.");
    expect(section()).toHaveTextContent("To disconnect, add an email address above so you can still sign in with your password.");
    expect(screen.queryByRole("button", { name: "Disconnect Memberful" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
});
