import { feature } from "@ember/parity";
import { MAX_PASSWORD_LENGTH, PASSWORD_TOO_LONG, type Bootstrap } from "@ember/protocol";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "@/hooks/use-account";
import { loadPage } from "@/lib/page";
import { JoinPage } from "./join-page";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn() }));

const grace = { id: "u2", name: "Grace Hopper" };
const workspace: Omit<Bootstrap, "user"> = {
  setup: "complete",
  setupProtected: false,
  guestSignIn: false,
  account: { name: "Ember", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false },
  helpContact: { name: "Ada Lovelace", emailAddress: "ada@example.com" },
  version: "0.1",
};
const JOIN_CODE = "aB3d-Ef5h-iJ7k";

const respond = (status: number, body: unknown) => vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body, { status }));

/** Fills in the form as Grace, with `emailAddress` if given, and sends it. */
async function join(emailAddress = "grace@example.com") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Grace Hopper");
  await user.type(screen.getByLabelText("Email address"), emailAddress);
  await user.type(screen.getByLabelText("Password"), "compiler{Enter}");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadPage).mockClear();
  history.replaceState(null, "", "/");
});

describe(feature("auth.sign-up"), () => {
  it("asks for a name, email address and password, as ember-rust's join page does", () => {
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    expect(document.title).toBe("Sign up");
    expect(screen.getByRole("img", { name: "Ember" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Join Ember" })).toBeInTheDocument();
    expect(screen.getByText("Create your account and join the conversation.")).toBeInTheDocument();

    const name = screen.getByLabelText("Name");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("autocomplete", "name");
    expect(name).toHaveAttribute("placeholder", "Name");
    expect(name).toBeRequired();
    const emailAddress = screen.getByLabelText("Email address");
    expect(emailAddress).toHaveAttribute("type", "email");
    expect(emailAddress).toHaveAttribute("autocomplete", "username");
    expect(emailAddress).toHaveAttribute("placeholder", "Email address");
    expect(emailAddress).toBeRequired();
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).toHaveAttribute("placeholder", "Password");
    expect(password).toHaveAttribute("maxlength", String(MAX_PASSWORD_LENGTH));
    expect(password).toBeRequired();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByText("Already have an account?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/session/new");
  });

  it("names the workspace", () => {
    render(<JoinPage workspace={{ ...workspace, account: { ...workspace.account, name: "Analytical Engines" } }} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Join Analytical Engines" })).toBeInTheDocument();
  });

  it("creates the account with the link's code", async () => {
    const fetch = respond(201, { user: grace });
    const onJoined = vi.fn();
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={onJoined} />);
    await join();
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(grace));
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe(`/api/join/${JOIN_CODE}`);
    expect(JSON.parse(String(init!.body))).toEqual({ name: "Grace Hopper", emailAddress: "grace@example.com", password: "compiler" });
  });

  it("sends an email address that has an account to sign in with it filled in", async () => {
    const signIn = "/session/new?email_address=ada%40example.com";
    respond(409, { error: "That email address has an account already", redirect: signIn });
    const onJoined = vi.fn();
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={onJoined} />);
    await join("ada@example.com");
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith(signIn));
    expect(onJoined).not.toHaveBeenCalled();
  });

  it("loads the link again when its code stops working, so the page says it's gone", async () => {
    history.replaceState(null, "", `/join/${JOIN_CODE}`);
    respond(404, { error: "Not found" });
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    await join();
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith(`/join/${JOIN_CODE}`));
  });

  it("says what the server refused, keeping what was typed", async () => {
    respond(422, { error: PASSWORD_TOO_LONG, field: "password" });
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    await join();
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSWORD_TOO_LONG);
    expect(screen.getByLabelText("Name")).toHaveValue("Grace Hopper");
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("says when Ember can't be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    await join();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach Ember. Check your connection and try again.");
    expect(screen.getByLabelText("Email address")).toHaveValue("grace@example.com");
  });

  it("sends the form once while it's on its way", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    await join();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe(feature("auth.help-contact"), () => {
  it("shows whom to ask for help under the card, as the sign-in page does", () => {
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    expect(screen.getByRole("link", { name: "ada@example.com" })).toHaveAttribute("title", "Email Ada Lovelace");
    expect(screen.getByText(/^Ember™ version/)).toHaveTextContent("Ember™ version 0.1");
  });
});

describe(feature("accounts.translation-buttons"), () => {
  it("has a translation button by the name, the email address and the password once an administrator shows them", () => {
    const shown = { ...workspace.account, hideTranslationButtons: false };
    render(
      <AccountContext value={shown}>
        <JoinPage workspace={{ ...workspace, account: shown }} joinCode={JOIN_CODE} onJoined={vi.fn()} />
      </AccountContext>,
    );
    expect(screen.getAllByText("Translate")).toHaveLength(3);
    for (const text of ["Enter your name", "Enter your email address", "Enter your password"]) expect(screen.getByText(text)).toBeInTheDocument();
  });
});
