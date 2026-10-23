import { feature } from "@ember/parity";
import { MAX_PASSWORD_LENGTH, MEMBERFUL_SIGN_IN_NEEDED, SIGN_IN_REFUSED, type Bootstrap } from "@ember/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { returnPath } from "@/lib/return-path";
import { CHROME_MAC } from "@/test-platforms";
import { FlashProvider } from "./flash";
import { SignInPage } from "./sign-in-page";

const ada = { id: "u1", name: "Ada" };
const workspace: Omit<Bootstrap, "user"> = {
  setup: "complete",
  setupAccess: "link",
  setupPlaceholders: { name: "Kevin Rose", emailAddress: "kevin@kevinrose.com" },
  guestSignIn: false,
  account: { name: "Ember", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, memberfulSignIn: false },
  helpContact: { name: "Ada Lovelace", emailAddress: "ada@example.com" },
  version: "0.1",
  vapidPublicKey: null,
  platform: CHROME_MAC,
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
  sessionStorage.clear();
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

describe(feature("accounts.logo"), () => {
  const logo = "/account/logo?v=20261017120000";
  const withLogo = { ...workspace, account: { ...workspace.account, logo }, guestSignIn: true };

  it("shows the workspace's logo in place of Ember's flame, as ember-rust's sign-in page does", () => {
    render(<SignInPage workspace={withLogo} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(screen.getByRole("img", { name: "Account logo" })).toHaveAttribute("src", logo);
    expect(screen.queryByRole("img", { name: "Ember" })).toBeNull();
  });

  it("shows it over joining with just a name too", async () => {
    render(<SignInPage workspace={withLogo} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    await userEvent.click(screen.getByRole("button", { name: "Join with just a name" }));
    expect(screen.getByRole("heading", { name: "Welcome to Ember" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Account logo" })).toHaveAttribute("src", logo);
  });
});

describe(feature("accounts.custom-css"), () => {
  it("keeps the password typed out of its field's value attribute, where custom CSS could read it", async () => {
    render(<SignInPage workspace={workspace} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    const password = screen.getByLabelText("Password");
    await userEvent.type(password, "correct horse");
    expect(password).toHaveValue("correct horse");
    expect(password).not.toHaveAttribute("value");
  });
});

describe(feature("auth.memberful-sign-in"), () => {
  const withMemberful = { ...workspace, account: { ...workspace.account, memberfulSignIn: true } };

  it("offers Sign in with Memberful in place of the password form, coming back to the page this tab was sent from", async () => {
    // As the app remembers the page it was on before it sends a tab to sign in.
    sessionStorage.setItem("ember:return-to", "/rooms/abc?tab=pins");
    history.replaceState(null, "", "/session/new");
    render(<SignInPage workspace={withMemberful} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    const memberful = screen.getByRole("link", { name: "Sign in with Memberful" });
    expect(memberful).toHaveAttribute("href", "/auth/memberful?return_to=%2Frooms%2Fabc%3Ftab%3Dpins");
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.getByText("Administrator?")).toBeInTheDocument();

    // The Worker opens that page once it's signed in, so this tab forgets it. jsdom can't follow the link.
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await userEvent.click(memberful);
    expect(returnPath()).toBeNull();
  });

  it("goes home once signed in when this tab came to sign in itself", () => {
    render(<SignInPage workspace={withMemberful} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(screen.getByRole("link", { name: "Sign in with Memberful" })).toHaveAttribute("href", "/auth/memberful");
  });

  it("lets an administrator sign in with a password instead, and back", async () => {
    const user = userEvent.setup();
    render(<SignInPage workspace={withMemberful} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    await user.click(screen.getByRole("button", { name: "Sign in with a password" }));
    expect(screen.getByLabelText("Email address")).toHaveFocus();
    expect(screen.queryByRole("link", { name: "Sign in with Memberful" })).not.toBeInTheDocument();
    expect(screen.getByText("Member?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign in with Memberful" }));
    expect(screen.getByRole("link", { name: "Sign in with Memberful" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("flashes what the server says when a member signs in with a password", async () => {
    respond(403, { error: MEMBERFUL_SIGN_IN_NEEDED });
    render(<SignInPage workspace={withMemberful} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    await userEvent.click(screen.getByRole("button", { name: "Sign in with a password" }));
    await signIn("compiler");
    expect(await screen.findByRole("alert")).toHaveTextContent(MEMBERFUL_SIGN_IN_NEEDED);
    expect(card()).toHaveClass("motion-safe:animate-shake");
  });

  it("says why signing in with Memberful didn't work, once, taking it out of the address", () => {
    history.replaceState(null, "", "/session/new?memberful=membership&email_address=ada%40example.com#top");
    render(<SignInPage workspace={withMemberful} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(screen.getByRole("alert")).toHaveTextContent("Your Memberful account has no active membership.");
    expect(`${location.pathname}${location.search}${location.hash}`).toBe("/session/new?email_address=ada%40example.com#top");

    cleanup();
    render(<SignInPage workspace={withMemberful} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says nothing of a problem it doesn't know", () => {
    history.replaceState(null, "", "/session/new?memberful=toString");
    render(<SignInPage workspace={withMemberful} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(location.search).toBe("");
  });

  it("asks only for a password while it's off", () => {
    render(<SignInPage workspace={workspace} onSignedIn={vi.fn()} />, { wrapper: FlashProvider });
    expect(screen.queryByRole("link", { name: "Sign in with Memberful" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Memberful" })).not.toBeInTheDocument();
    expect(screen.queryByText("Administrator?")).not.toBeInTheDocument();
  });
});
