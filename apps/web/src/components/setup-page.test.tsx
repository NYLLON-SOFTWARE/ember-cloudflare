import { feature } from "@ember/parity";
import { PASSWORD_TOO_SHORT } from "@ember/protocol";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPage } from "@/lib/page";
import { SetupPage } from "./setup-page";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn() }));

const workspace = { user: { id: "u1", name: "Ada Lovelace" }, room: { id: "r1", kind: "open", name: "All Talk" } };

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadPage).mockClear();
  history.replaceState(null, "", "/");
});

describe(feature("auth.first-run"), () => {
  it("asks for the administrator's name, email address and password", () => {
    render(<SetupPage onSetUp={() => {}} />);
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
    render(<SetupPage onSetUp={() => {}} />);
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

  it("sets up the workspace and opens All Talk in this page's place", async () => {
    history.replaceState(null, "", "/first_run");
    const length = history.length;
    const fetch = answer(201, workspace);
    const onSetUp = vi.fn();
    render(<SetupPage onSetUp={onSetUp} />);
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
    render(<SetupPage onSetUp={() => {}} />);
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
    render(<SetupPage onSetUp={() => {}} />);
    await fillIn("correct horse");
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/"));
  });

  it("reloads setup's page when the setup link's time has run out, which then says setup is locked", async () => {
    answer(403, { error: "Setup is locked" });
    render(<SetupPage onSetUp={() => {}} />);
    await fillIn("correct horse");
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/first_run"));
  });

  it("says so when Ember can't be reached, and lets you try again", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<SetupPage onSetUp={() => {}} />);
    const user = await fillIn("correct horse");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach Ember. Check your connection and try again.");

    fetch.mockResolvedValueOnce(Response.json(workspace, { status: 201 }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
