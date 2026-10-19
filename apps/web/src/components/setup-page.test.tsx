import { feature } from "@ember/parity";
import { AVATAR_TOO_LARGE, MAX_AVATAR_SIZE, PASSWORD_TOO_SHORT } from "@ember/protocol";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPage } from "@/lib/page";
import avatarPlaceholder from "./avatar-placeholder.svg";
import { SetupPage } from "./setup-page";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn() }));
vi.mock("@/lib/previews", () => ({ avatarVariantOf: vi.fn(async () => new Blob(["variant"], { type: "image/webp" })) }));

const workspace = { user: { id: "u1", name: "Ada Lovelace" }, room: { id: "r1", kind: "open", name: "general", icon: null } };
/** ember-rust's placeholders, which the Worker suggests unless the deployment names its own. */
const JANE = { name: "Jane Cooper", emailAddress: "jane@company.com" };

/** The server's answer to the form. */
const answer = (status: number, body: object) => vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body, { status }));

async function fillIn(password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("Email address"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return user;
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

const preview = () => screen.getByRole("img", { name: "Avatar preview" });
const photoField = () => screen.getByLabelText("Upload profile image (optional)", { exact: false });
const moon = () => new File(["moon"], "moon.jpg", { type: "image/jpeg" });
/** What the form sent, as a form when it brought a photo. */
const sent = () => vi.mocked(fetch).mock.calls.at(-1)![1]!.body;

describe(feature("auth.first-run"), () => {
  it("asks for the administrator's name, email address and password", () => {
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    expect(document.title).toBe("Set up Ember");
    expect(screen.getByRole("region", { name: "Set up Ember" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Set up Ember" })).toBeInTheDocument();
    expect(screen.getByText("Create the admin account for your workspace.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ember" })).toHaveAttribute("src", "/ember-icon.png");

    const name = screen.getByLabelText("Name");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("placeholder", "Jane Cooper");
    expect(name).toHaveAttribute("autocomplete", "name");
    const email = screen.getByLabelText("Email address");
    expect(email).toMatchObject({ type: "email", placeholder: "jane@company.com", required: true });
    expect(email).toHaveAttribute("autocomplete", "username");
    const password = screen.getByLabelText("Password");
    expect(password).toMatchObject({ type: "password", placeholder: "••••••••", required: true, minLength: 8, maxLength: 72 });
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).toHaveAccessibleDescription("Must be at least 8 characters.");
    expect(password).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute("type", "submit");
  });

  it("shows and hides the password", async () => {
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    const password = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", password.id);

    await userEvent.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(toggle).toHaveAccessibleName("Hide password");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle);
    expect(password).toHaveAttribute("type", "password");
    expect(toggle).toHaveAccessibleName("Show password");
  });

  it("sets up the workspace and opens general in this page's place", async () => {
    history.replaceState(null, "", "/first_run");
    const length = history.length;
    const fetch = answer(201, workspace);
    const onSetUp = vi.fn();
    render(<SetupPage placeholders={JANE} onSetUp={onSetUp} />);
    await fillIn("correct horse");

    await waitFor(() => expect(onSetUp).toHaveBeenCalledWith(workspace));
    expect(location.pathname).toBe("/rooms/r1");
    expect(history.length).toBe(length);
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe("/api/first_run");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init!.body))).toEqual({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "correct horse" });
  });

  it("starts the password over when it's too short, keeping the name and email", async () => {
    answer(422, { error: PASSWORD_TOO_SHORT, field: "password" });
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    await fillIn("🔐🔐🔐🔐");

    const password = await screen.findByLabelText("Password");
    await waitFor(() => expect(password).toHaveFocus());
    expect(password).toHaveValue("");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(PASSWORD_TOO_SHORT);
    expect(password).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);
    expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText("Email address")).toHaveValue("ada@example.com");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("goes home when someone else set Ember up first", async () => {
    answer(409, { error: "Ember is already set up", redirect: "/" });
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    await fillIn("correct horse");
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/"));
  });

  it("reloads setup's page when the setup link's time has run out, which then says setup is locked", async () => {
    answer(403, { error: "Setup is locked" });
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    await fillIn("correct horse");
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/first_run"));
  });

  it("says so when Ember can't be reached, and lets you try again", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    const user = await fillIn("correct horse");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach Ember. Check your connection and try again.");

    fetch.mockResolvedValueOnce(Response.json(workspace, { status: 201 }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("offers a photo, optional, which shows as it's chosen, as ember-rust's `ui::avatar` does", async () => {
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    expect(preview()).toHaveAttribute("src", avatarPlaceholder);
    expect(photoField()).toMatchObject({ type: "file", accept: "image/*" });
    expect(photoField()).toHaveAccessibleDescription("Add a profile photo (optional).");
    expect(photoField().compareDocumentPosition(screen.getByLabelText("Name"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await userEvent.upload(photoField(), moon());
    expect(preview()).toHaveAttribute("src", "blob:moon");
  });

  it("sends the photo chosen, and its variant, with the rest of the form", async () => {
    answer(201, workspace);
    const onSetUp = vi.fn();
    render(<SetupPage placeholders={JANE} onSetUp={onSetUp} />);
    await userEvent.upload(photoField(), moon());
    await fillIn("correct horse");

    await waitFor(() => expect(onSetUp).toHaveBeenCalledWith(workspace));
    const form = sent() as FormData;
    expect(JSON.parse(String(form.get("user")))).toEqual({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "correct horse" });
    expect(form.get("avatar")).toMatchObject({ name: "moon.jpg", type: "image/jpeg" });
    expect(form.get("variant")).toMatchObject({ type: "image/webp" });
  });

  it("keeps the photo when the password is too short", async () => {
    answer(422, { error: PASSWORD_TOO_SHORT, field: "password" });
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    await userEvent.upload(photoField(), moon());
    await fillIn("🔐🔐🔐🔐");

    await waitFor(() => expect(screen.getByLabelText("Password")).toHaveFocus());
    expect(preview()).toHaveAttribute("src", "blob:moon");
    expect(photoField()).toBeEnabled();
  });

  it("keeps the photo it sends until it's answered", async () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    await userEvent.upload(photoField(), moon());
    await fillIn("correct horse");

    expect(photoField()).toBeDisabled();
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  });

  it("refuses a photo over 16 MB at once, saying so in place of its description", async () => {
    answer(201, workspace);
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    const huge = moon();
    Object.defineProperty(huge, "size", { value: MAX_AVATAR_SIZE + 1 });
    await userEvent.upload(photoField(), huge);

    expect(screen.getByRole("alert")).toHaveTextContent(AVATAR_TOO_LARGE);
    expect(photoField()).toHaveAccessibleDescription(AVATAR_TOO_LARGE);
    expect(photoField()).toHaveAttribute("aria-invalid", "true");
    expect(preview()).toHaveAttribute("src", avatarPlaceholder);
    await fillIn("correct horse");
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(typeof sent()).toBe("string");
  });

  it("lets go of a photo the Worker refuses, saying why, so the form can be sent without it", async () => {
    const fetch = answer(503, { error: "Ember isn't set up to store files", field: "avatar" });
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    await userEvent.upload(photoField(), moon());
    const user = await fillIn("correct horse");

    expect(await screen.findByRole("alert")).toHaveTextContent("Ember isn't set up to store files");
    expect(preview()).toHaveAttribute("src", avatarPlaceholder);
    expect(photoField()).toHaveValue("");
    fetch.mockResolvedValue(Response.json(workspace, { status: 201 }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(sent()))).toEqual({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "correct horse" });
  });
});

describe(feature("ui.accessibility"), () => {
  it("starts with Skip to main content, which focuses the main content, as ember-rust's first run does", async () => {
    render(<SetupPage placeholders={JANE} onSetUp={() => {}} />);
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(document.body.querySelector("a[href], button, input")).toBe(skip);
    await userEvent.click(skip);
    expect(screen.getByRole("main")).toHaveFocus();
  });
});
