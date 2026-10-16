import { feature } from "@ember/parity";
import { MAX_PASSWORD_LENGTH, SIGN_IN_REFUSED, type Bootstrap } from "@ember/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlashProvider } from "./flash";
import { SignInPage } from "./sign-in-page";

const ada = { id: "u1", name: "Ada" };
const workspace: Omit<Bootstrap, "user"> = {
  setup: "complete",
  setupProtected: false,
  guestSignIn: false,
  account: { name: "Ember", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false },
  helpContact: { name: "Ada Lovelace", emailAddress: "ada@example.com" },
  version: "0.1",
  vapidPublicKey: null,
};

const respond = (status: number, body: unknown) => vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body, { status }));

/** Types an email address and password and submits them. */
async function signIn(password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email address"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), `${password}{Enter}`);
}

const card = () => screen.getByRole("heading", { name: "Sign in to Ember" }).closest("section")!;

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe(feature("auth.sign-in"), () => {
  it("asks for an email address and password, as ember-rust's sign-in page does", () => {
    render(<SignInPage workspace={workspace} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(document.title).toBe("Sign in");
    expect(screen.getByRole("img", { name: "Ember" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in to Ember" })).toBeInTheDocument();
    expect(screen.getByText("Welcome back. Pick up the conversation.")).toBeInTheDocument();

    const emailAddress = screen.getByLabelText("Email address");
    expect(emailAddress).toHaveFocus();
    expect(emailAddress).toHaveAttribute("type", "email");
    expect(emailAddress).toHaveAttribute("autocomplete", "username");
    expect(emailAddress).toHaveAttribute("placeholder", "Enter your email address");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toHaveAttribute("placeholder", "Enter your password");
    expect(password).toHaveAttribute("maxlength", String(MAX_PASSWORD_LENGTH));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("names the workspace", () => {
    render(<SignInPage workspace={{ ...workspace, account: { ...workspace.account, name: "Analytical Engines" } }} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(screen.getByRole("heading", { name: "Sign in to Analytical Engines" })).toBeInTheDocument();
  });

  it("fills in the email address its link gives", () => {
    history.replaceState(null, "", "/session/new?email_address=ada%40example.com");
    render(<SignInPage workspace={workspace} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(screen.getByLabelText("Email address")).toHaveValue("ada@example.com");
  });

  it("signs in with them", async () => {
    const fetch = respond(201, { user: ada });
    const onSignedIn = vi.fn();
    render(<SignInPage workspace={workspace} onSignedIn={onSignedIn} />, { wrapper: FlashProvider });
    await signIn("correct horse");

    const credentials = { emailAddress: "ada@example.com", password: "correct horse" };
    expect(fetch).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "POST", body: JSON.stringify(credentials) }));
    expect(onSignedIn).toHaveBeenCalledWith(ada);
  });

  it("shakes, flashes ember-rust's alert and empties the password when it's refused", async () => {
    respond(401, { error: SIGN_IN_REFUSED });
    const onSignedIn = vi.fn();
    render(<SignInPage workspace={workspace} onSignedIn={onSignedIn} />, { wrapper: FlashProvider });
    await signIn("wrong horse");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(SIGN_IN_REFUSED);
    expect(card()).toHaveClass("motion-safe:animate-shake");
    expect(screen.getByLabelText("Email address")).toHaveValue("ada@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(onSignedIn).not.toHaveBeenCalled();

    // The card shakes once, and the alert goes once it has faded.
    fireEvent.animationEnd(card());
    expect(card()).not.toHaveClass("motion-safe:animate-shake");
    fireEvent.animationEnd(alert);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("flashes the alert afresh for each refusal", async () => {
    respond(401, { error: SIGN_IN_REFUSED });
    render(<SignInPage workspace={workspace} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    await signIn("wrong horse");
    const first = await screen.findByRole("alert");

    await userEvent.type(screen.getByLabelText("Password"), "still wrong{Enter}");
    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(first));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("says when Ember can't be reached, keeping what was typed", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SignInPage workspace={workspace} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    await signIn("correct horse");

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach Ember. Check your connection and try again.");
    expect(screen.getByLabelText("Password")).toHaveValue("correct horse");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(card()).not.toHaveClass("motion-safe:animate-shake");
  });
});

describe(feature("ui.accessibility"), () => {
  it("starts with Skip to main content, which focuses the main content", async () => {
    render(<SignInPage workspace={workspace} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(document.body.querySelector("a[href], button, input")).toBe(skip);
    await userEvent.click(skip);
    expect(screen.getByRole("main")).toHaveFocus();
  });
});

describe(feature("auth.rate-limit"), () => {
  it("refuses too many attempts the same way as a wrong password", async () => {
    respond(429, { error: SIGN_IN_REFUSED });
    render(<SignInPage workspace={workspace} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    await signIn("correct horse");
    expect(await screen.findByRole("alert")).toHaveTextContent(SIGN_IN_REFUSED);
    expect(card()).toHaveClass("motion-safe:animate-shake");
  });
});

describe(feature("auth.help-contact"), () => {
  it("shows whom to ask for help under the card", () => {
    render(<SignInPage workspace={workspace} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(screen.getByRole("link", { name: "ada@example.com" })).toHaveAttribute("title", "Email Ada Lovelace");
  });
});

describe(feature("auth.guest-sign-in"), () => {
  it("offers joining with just a name when the workspace allows it, and back", async () => {
    const user = userEvent.setup();
    render(<SignInPage workspace={{ ...workspace, guestSignIn: true }} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    await user.click(screen.getByRole("button", { name: "Join with just a name" }));
    expect(screen.getByRole("heading", { name: "Welcome to Ember" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("heading", { name: "Sign in to Ember" })).toBeInTheDocument();
  });

  it("only asks for a password when it doesn't", () => {
    render(<SignInPage workspace={workspace} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(screen.queryByRole("button", { name: "Join with just a name" })).not.toBeInTheDocument();
  });

  it("keeps either card from switching while it's signing in, so only one sign-in is on its way", async () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<SignInPage workspace={{ ...workspace, guestSignIn: true }} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    await signIn("correct horse");
    expect(screen.getByRole("button", { name: "Join with just a name" })).toBeDisabled();

    cleanup();
    render(<SignInPage workspace={{ ...workspace, guestSignIn: true }} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    await user.click(screen.getByRole("button", { name: "Join with just a name" }));
    await user.type(screen.getByLabelText("Your name"), "Ada{Enter}");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });
});
