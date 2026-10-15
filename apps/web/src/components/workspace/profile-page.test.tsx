import { feature } from "@ember/parity";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Profile, ProfileChanges } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { Sheet } from "@/components/ui/sheet";
import { AccountContext } from "@/hooks/use-account";
import { navigate } from "@/hooks/use-route";
import { ProfilePage } from "./profile-page";

const ada = { id: "u1", name: "Ada Lovelace", administrator: false };
const profile: Profile = { name: "Ada Lovelace", emailAddress: "ada@example.com", bio: "Wrote the first program" };
const account: Account = { name: "Analytical Engines", hideTranslationButtons: true, customStyles: "" };

interface Answers {
  /** What loading the profile answers, rather than `profile`. */
  loaded?: () => Response | Promise<Response>;
  /** What saving it answers, rather than the profile with the changes sent. */
  saved?: () => Response | Promise<Response>;
}

/** Answers the page's requests as the server does, or as `answers` says. */
function serve({ loaded = () => Response.json({ profile }), saved }: Answers = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    switch (request) {
      case "GET /api/users/me/profile":
        return loaded();
      case "PATCH /api/users/me/profile": {
        const { password: _, ...changes } = JSON.parse(String(init?.body)) as ProfileChanges;
        return saved ? saved() : Response.json({ profile: { ...profile, ...changes } });
      }
      default:
        throw new Error(`Unexpected request for ${request}`);
    }
  });
}

function showPage(shown = account) {
  const [onSignOut, onFailed] = [vi.fn(), vi.fn()];
  render(
    <AccountContext value={shown}>
      <FlashProvider workspace>
        <Sheet>
          <ProfilePage me={ada} onSignOut={onSignOut} onFailed={onFailed} />
        </Sheet>
      </FlashProvider>
    </AccountContext>,
  );
  return { onSignOut, onFailed, user: userEvent.setup() };
}

const field = (label: string) => screen.getByLabelText(label);
/** The page once your profile has loaded into it. */
const loaded = () => waitFor(() => expect(field("Name")).toBeEnabled());
const saveButton = () => screen.getByRole("button", { name: "Save changes" });
/** What each save sent, in order. */
const saved = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => JSON.parse(String(init?.body)) as ProfileChanges);

beforeEach(() => {
  history.replaceState(null, "", "/users/me/profile");
  serve();
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe(feature("users.profile"), () => {
  it("reads Your profile, titled with your name, with Go Back and Log out in the top bar", () => {
    showPage();
    expect(document.title).toBe("Ada Lovelace");
    expect(screen.getByRole("heading", { level: 1, name: "Your profile" })).toBeInTheDocument();
    expect(screen.getByText("Manage how you appear to the people in your workspace.")).toBeInTheDocument();
    const topBar = screen.getByRole("navigation", { name: "Page" });
    expect(topBar).toContainElement(screen.getByRole("link", { name: "Go Back" }));
    expect(topBar).toContainElement(screen.getByRole("button", { name: "Log out" }));
  });

  it("is busy until your profile loads, then shows it to change, with nothing focused", async () => {
    showPage();
    const panel = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(panel).toHaveAttribute("aria-busy", "true");
    for (const label of ["Name", "Email address", "New password", "Bio"]) expect(field(label)).toBeDisabled();
    expect(saveButton()).toBeDisabled();

    await loaded();
    expect(panel).toHaveAttribute("aria-busy", "false");
    expect(field("Name")).toHaveValue("Ada Lovelace");
    expect(field("Email address")).toHaveValue("ada@example.com");
    expect(field("New password")).toHaveValue("");
    expect(field("Bio")).toHaveValue("Wrote the first program");
    expect(saveButton()).toBeEnabled();
    expect(document.body).toHaveFocus();
  });

  it("shows no email address or bio as blank fields", async () => {
    serve({ loaded: () => Response.json({ profile: { name: "Grace Hopper", emailAddress: null, bio: null } }) });
    showPage();
    await loaded();
    expect(field("Email address")).toHaveValue("");
    expect(field("Bio")).toHaveValue("");
  });

  it("asks for each field as ember-rust's form does", () => {
    showPage();
    const name = field("Name");
    expect(name).toHaveAttribute("autocomplete", "name");
    expect(name).toHaveAttribute("placeholder", "Enter your name");
    expect(name).toBeRequired();
    expect(name).toHaveAttribute("data-1p-ignore");

    const email = field("Email address");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).toHaveAttribute("placeholder", "Enter your email address");
    expect(email).not.toBeRequired();

    const password = field("New password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).toHaveAttribute("placeholder", "Change password");
    expect(password).toHaveAttribute("maxlength", "72");
    expect(password).toHaveAccessibleDescription("Leave blank to keep your current password.");

    const bio = field("Bio");
    expect(bio.tagName).toBe("TEXTAREA");
    expect(bio).toHaveAttribute("rows", "3");
    expect(bio).toHaveAttribute("placeholder", "A few words about yourself…");
    expect(bio).toHaveAttribute("maxlength", "200");
  });

  it("saves what you changed with the notice ✓, and empties the new password, as ember-rust's page comes back", async () => {
    const { onFailed, user } = showPage();
    await loaded();
    await user.clear(field("Name"));
    await user.type(field("Name"), "Ada King");
    await user.clear(field("Bio"));
    await user.type(field("New password"), "difference engine");
    await user.click(saveButton());

    // The flash's check alone, read as "Changes saved".
    expect(await screen.findByRole("alert")).toHaveTextContent("Changes saved");
    expect(saved()).toEqual([{ name: "Ada King", password: "difference engine", bio: "" }]);
    expect(field("Name")).toHaveValue("Ada King");
    expect(field("Bio")).toHaveValue("");
    expect(field("New password")).toHaveValue("");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("sends only what you changed, then shows what's saved, so it doesn't undo another tab's save", async () => {
    // Another tab saved a new name after this page loaded.
    serve({ saved: () => Response.json({ profile: { ...profile, name: "Ada King", bio: "Countess of Lovelace" } }) });
    const { user } = showPage();
    await loaded();
    await user.clear(field("Bio"));
    await user.type(field("Bio"), "Countess of Lovelace");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Changes saved");
    expect(saved()).toEqual([{ bio: "Countess of Lovelace" }]);
    expect(field("Name")).toHaveValue("Ada King");
    // Nor does saving again put back the name the page loaded.
    await user.click(saveButton());
    await waitFor(() => expect(saved()).toEqual([{ bio: "Countess of Lovelace" }, {}]));
  });

  it("can't save again until the last save is answered, keeping a password typed meanwhile", async () => {
    let answer = (_: Response) => {};
    serve({ saved: () => new Promise((resolve) => (answer = resolve)) });
    const { user } = showPage();
    await loaded();
    await user.type(field("New password"), "difference engine");
    await user.click(saveButton());
    expect(saveButton()).toBeDisabled();
    await user.type(field("New password"), "s");
    await user.keyboard("{Enter}");
    expect(saved()).toHaveLength(1);

    await act(async () => answer(Response.json({ profile })));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(field("New password")).toHaveValue("difference engines");
  });

  it("says why a save failed, keeping what's typed", async () => {
    serve({ saved: () => Response.json({ error: "That email address has an account already" }, { status: 422 }) });
    const { onFailed, user } = showPage();
    await loaded();
    await user.clear(field("Email address"));
    await user.type(field("Email address"), "grace@example.com");
    await user.type(field("New password"), "difference engine");
    await user.click(saveButton());

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 422, message: "That email address has an account already" })));
    expect(field("Email address")).toHaveValue("grace@example.com");
    expect(field("New password")).toHaveValue("difference engine");
    expect(saveButton()).toBeEnabled();
  });

  it("says why your profile didn't load", async () => {
    serve({ loaded: () => Response.json({ error: "Something went wrong" }, { status: 500 }) });
    const { onFailed } = showPage();
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 500 })));
    expect(saveButton()).toBeDisabled();
  });

  it("goes back to the page it was opened from, or home, as ember-rust's `link_back` goes to the referrer", () => {
    showPage();
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/");
    act(() => navigate("/rooms/general"));
    act(() => navigate("/users/me/profile"));
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/rooms/general");
  });
});

describe(feature("auth.sign-out"), () => {
  it("logs out from the top bar, as ember-rust's profile does", async () => {
    const { onSignOut, user } = showPage();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe(feature("accounts.translation-buttons"), () => {
  it("has a translation button by each field once an administrator shows them", () => {
    showPage({ ...account, hideTranslationButtons: false });
    expect(screen.getAllByText("Translate")).toHaveLength(4);
  });

  it("has none while they're hidden", () => {
    showPage();
    expect(screen.queryByText("Translate")).not.toBeInTheDocument();
  });
});
