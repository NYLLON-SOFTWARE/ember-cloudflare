import { feature } from "@ember/parity";
import { AVATAR_TOO_LARGE, MAX_AVATAR_SIZE, MAX_PASSWORD_LENGTH, PASSWORD_TOO_LONG, type Bootstrap } from "@ember/protocol";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "@/hooks/use-account";
import { loadPage } from "@/lib/page";
import { CHROME_MAC } from "@/test-platforms";
import avatarPlaceholder from "./avatar-placeholder.svg";
import { JoinPage } from "./join-page";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn() }));
vi.mock("@/lib/previews", () => ({ avatarVariantOf: vi.fn(async () => new Blob(["variant"], { type: "image/webp" })) }));

const grace = { id: "u2", name: "Grace Hopper" };
const workspace: Omit<Bootstrap, "user"> = {
  setup: "complete",
  setupProtected: false,
  guestSignIn: false,
  account: { name: "Ember", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false },
  helpContact: { name: "Ada Lovelace", emailAddress: "ada@example.com" },
  version: "0.1",
  vapidPublicKey: null,
  platform: CHROME_MAC,
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

beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:moon");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadPage).mockClear();
  history.replaceState(null, "", "/");
});

const photo = () => screen.getByRole("img", { name: "Your profile photo" });
const photoField = () => screen.getByLabelText("Upload photo");
const moon = () => new File(["moon"], "moon.jpg", { type: "image/jpeg" });

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

  it("offers a photo, optional, with Upload photo, which shows as it's chosen, as ember-rust's join page does", async () => {
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    expect(photo()).toHaveAttribute("src", avatarPlaceholder);
    expect(photoField()).toMatchObject({ type: "file", accept: "image/*" });
    expect(screen.getByText("Optional")).toBeInTheDocument();
    expect(photoField().compareDocumentPosition(screen.getByLabelText("Name"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await userEvent.upload(photoField(), moon());
    expect(photo()).toHaveAttribute("src", "blob:moon");
  });

  it("sends the photo chosen, and its variant, with the rest of the form", async () => {
    const fetch = respond(201, { user: grace });
    const onJoined = vi.fn();
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={onJoined} />);
    await userEvent.upload(photoField(), moon());
    await join();

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(grace));
    const form = fetch.mock.calls[0]![1]!.body as FormData;
    expect(JSON.parse(String(form.get("user")))).toEqual({ name: "Grace Hopper", emailAddress: "grace@example.com", password: "compiler" });
    expect(form.get("avatar")).toMatchObject({ name: "moon.jpg", type: "image/jpeg" });
    expect(form.get("variant")).toMatchObject({ type: "image/webp" });
  });

  it("refuses a photo over 16 MB at once, saying so in place of Optional", async () => {
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    const huge = moon();
    Object.defineProperty(huge, "size", { value: MAX_AVATAR_SIZE + 1 });
    await userEvent.upload(photoField(), huge);

    expect(screen.getByRole("alert")).toHaveTextContent(AVATAR_TOO_LARGE);
    expect(screen.queryByText("Optional")).toBeNull();
    expect(photo()).toHaveAttribute("src", avatarPlaceholder);
  });

  it("lets go of a photo the Worker refuses, saying why, so the form can be sent without it", async () => {
    const fetch = respond(413, { error: AVATAR_TOO_LARGE, field: "avatar" });
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    await userEvent.upload(photoField(), moon());
    await join();

    expect(await screen.findByRole("alert")).toHaveTextContent(AVATAR_TOO_LARGE);
    expect(photo()).toHaveAttribute("src", avatarPlaceholder);
    expect(photoField()).toBeEnabled();
    fetch.mockResolvedValue(Response.json({ user: grace }, { status: 201 }));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(typeof fetch.mock.calls[1]![1]!.body).toBe("string");
  });

  it("sends the form once while it's on its way, and keeps the photo it sends", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    render(<JoinPage workspace={workspace} joinCode={JOIN_CODE} onJoined={vi.fn()} />);
    await userEvent.upload(photoField(), moon());
    await join();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    expect(photoField()).toBeDisabled();
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
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
