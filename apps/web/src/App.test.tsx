import { feature } from "@ember/parity";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const session = { user: { id: "u1", name: "Ada" }, token: "t" };

class QuietSocket {
  static readonly OPEN = 1;
  readyState = 0;
  send() {}
  close() {}
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", QuietSocket);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    String(input).endsWith("/api/session") ? Response.json(session, { status: 201 }) : Response.json({ rooms: [{ id: "general", name: "general", kind: "open" }] }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(feature("auth.sessions"), () => {
  it("opens straight into the workspace for someone already signed in", async () => {
    localStorage.setItem("ember:session", JSON.stringify(session));
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "general" })).toBeInTheDocument();
  });
});

describe(feature("auth.guest-sign-in"), () => {
  it("goes from the sign-in card to the workspace and remembers the session", async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText("Your name"), "Ada{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "general" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("ember:session")!)).toEqual(session);
  });
});

describe(feature("auth.sign-out"), () => {
  it("returns to the sign-in card and forgets the session", async () => {
    localStorage.setItem("ember:session", JSON.stringify(session));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "general" });
    await user.click(screen.getAllByRole("button", { name: "Your profile" })[0]!);
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Welcome to Ember" })).toBeInTheDocument();
    expect(localStorage.getItem("ember:session")).toBeNull();
  });
});
