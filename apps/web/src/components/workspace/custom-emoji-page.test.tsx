import { CUSTOM_EMOJI_NAME_IS_STANDARD, CUSTOM_EMOJI_NAME_TAKEN, CUSTOM_EMOJI_TOO_LARGE, CUSTOM_EMOJI_WRONG_TYPE, MAX_CUSTOM_EMOJI_SIZE, type CustomEmoji, type DirectoryUser, type Me } from "@ember/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashProvider } from "@/components/flash";
import { Sheet } from "@/components/ui/sheet";
import { CustomEmojiContext } from "@/hooks/use-custom-emoji";
import { PeopleContext } from "@/hooks/use-directory";
import { customEmojiPictureOf } from "@/lib/previews";
import { CustomEmojiPage } from "./custom-emoji-page";

// The picture's scaled on a canvas, which jsdom hasn't got: each test says what comes of it.
vi.mock("@/lib/previews", () => ({ customEmojiPictureOf: vi.fn() }));

const ada: Me = { id: "u1", name: "Ada", administrator: false };
const grace: Me = { id: "u2", name: "Grace", administrator: true };
const listed = (me: Me): DirectoryUser => ({ id: me.id, name: me.name, bio: null, role: me.administrator ? "administrator" : "member", status: "active", avatarUrl: `/users/${me.id}/avatar` });
const people = new Map([ada, grace].map((me) => [me.id, listed(me)]));

const emoji = (name: string, creator: Me): CustomEmoji => ({ name, key: `key-${name}`, creatorId: creator.id, createdAt: "2026-11-14T12:00:00.000Z" });
const shipit = emoji("shipit", ada);
const parrot = emoji("party_parrot", grace);

const png = (name: string, size = 1_000) => new File([new Uint8Array(size)], name, { type: "image/png" });

function show(me: Me, ...workspaceEmoji: CustomEmoji[]) {
  const handlers = { onAdded: vi.fn(), onRemoved: vi.fn(), onFailed: vi.fn() };
  render(
    <FlashProvider workspace>
      <PeopleContext value={people}>
        <CustomEmojiContext value={new Map(workspaceEmoji.map((one) => [one.name, one]))}>
          <Sheet>
            <CustomEmojiPage me={me} {...handlers} />
          </Sheet>
        </CustomEmojiContext>
      </PeopleContext>
    </FlashProvider>,
  );
  return { ...handlers, user: userEvent.setup() };
}

/** Answers adding and removing as the server does, or as `answers` says. */
function serve(answers: { added?: () => Response; removed?: () => Response } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    if (request === "POST /api/emoji") {
      if (answers.added) return answers.added();
      const form = init!.body as FormData;
      return Response.json(emoji(form.get("name") as string, ada), { status: 201 });
    }
    if (request.startsWith("DELETE /api/emoji/")) return answers.removed?.() ?? new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${request}`);
  });
}

const form = () => within(screen.getByRole("form", { name: "Add custom emoji" }));
const fileField = () => form().getByLabelText(/Choose an(other)? image/);
const nameField = () => form().getByRole("textbox", { name: "Name" });
const addButton = () => form().getByRole("button", { name: "Add emoji" });
const rows = () => screen.queryAllByRole("listitem").map((row) => row.textContent);

beforeEach(() => {
  vi.mocked(customEmojiPictureOf).mockImplementation(async (file) => file);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe("Custom emoji page", () => {
  it("lists the workspace's emoji by name, with who added each and when", () => {
    show(ada, shipit, parrot);
    expect(screen.getByRole("heading", { level: 1, name: "Custom emoji" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "2 custom emoji" })).toBeInTheDocument();
    expect(rows()).toEqual([expect.stringMatching(/^:party_parrot:Added by Grace on /), expect.stringMatching(/^:shipit:Added by Ada on /)]);
    expect(screen.getByRole("img", { name: ":shipit:" })).toHaveAttribute("src", "/emoji/key-shipit");
  });

  it("says so when there are none yet", () => {
    show(ada);
    expect(screen.getByRole("heading", { level: 2, name: "No custom emoji yet" })).toBeInTheDocument();
    expect(rows()).toEqual([]);
  });

  it("adds the picture chosen under the name its file suggests, which can be changed, and lists it at once", async () => {
    const fetched = serve();
    const { user, onAdded } = show(ada);
    expect(addButton()).toBeDisabled();

    await user.upload(fileField(), png("Ship It.png"));
    expect(await form().findByLabelText("Preview")).toBeInTheDocument();
    expect(nameField()).toHaveValue("ship_it");
    await user.clear(nameField());
    await user.type(nameField(), "ShipIt");
    // Names are lowercase.
    expect(nameField()).toHaveValue("shipit");
    await user.click(addButton());

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(emoji("shipit", ada)));
    const sent = fetched.mock.calls[0]![1]!.body as FormData;
    expect(sent.get("name")).toBe("shipit");
    expect(sent.get("image")).toBeInstanceOf(File);
    expect(await screen.findByText(":shipit: added")).toBeInTheDocument();
    // The form's ready for the next.
    expect(nameField()).toHaveValue("");
    expect(form().queryByLabelText("Preview")).not.toBeInTheDocument();
  });

  it("sends the picture scaled to an emoji's size", async () => {
    const scaled = new Blob([new Uint8Array(10)], { type: "image/png" });
    vi.mocked(customEmojiPictureOf).mockResolvedValue(scaled);
    const fetched = serve();
    const { user, onAdded } = show(ada);
    await user.upload(fileField(), png("huge.png", MAX_CUSTOM_EMOJI_SIZE * 4));
    await user.click(addButton());
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(((fetched.mock.calls[0]![1]!.body as FormData).get("image") as File).size).toBe(10);
  });

  it("sends the picture picked last, however long one picked before it takes to scale", async () => {
    let scaleFirst: (picture: Blob) => void = () => {};
    vi.mocked(customEmojiPictureOf)
      .mockImplementationOnce(() => new Promise<Blob>((resolve) => (scaleFirst = resolve)))
      .mockImplementationOnce(async (file) => file);
    const fetched = serve();
    const { user, onAdded } = show(ada);
    await user.upload(fileField(), png("first.png", 111));
    await user.upload(fileField(), png("second.png", 222));
    await waitFor(() => expect(form().getByLabelText("Preview")).toBeInTheDocument());
    scaleFirst(png("first.png", 111));
    await waitFor(() => expect(nameField()).toHaveValue("second"));

    await user.click(addButton());
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(((fetched.mock.calls[0]![1]!.body as FormData).get("image") as File).size).toBe(222);
  });

  it("refuses a picture that's still over 256 KB, as an animated GIF can be, and one of another type", async () => {
    const { user } = show(ada);
    await user.upload(fileField(), new File([new Uint8Array(MAX_CUSTOM_EMOJI_SIZE + 1)], "party.gif", { type: "image/gif" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CUSTOM_EMOJI_TOO_LARGE);
    expect(addButton()).toBeDisabled();

    // The file field takes only images, but a file can be dropped on it.
    await userEvent.setup({ applyAccept: false }).upload(fileField(), new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CUSTOM_EMOJI_WRONG_TYPE);
  });

  it("says what's wrong with a name as it's typed: one another emoji has, or that no emoji can have", async () => {
    const { user } = show(ada, shipit);
    await user.upload(fileField(), png("7.png"));
    await waitFor(() => expect(form().getByLabelText("Preview")).toBeInTheDocument());
    // The file's name is too short to be an emoji's.
    expect(nameField()).toHaveValue("7");
    expect(screen.getByRole("alert")).toHaveTextContent("Names have at least 2 characters.");

    await user.clear(nameField());
    await user.type(nameField(), "shipit");
    expect(screen.getByRole("alert")).toHaveTextContent(CUSTOM_EMOJI_NAME_TAKEN);
    expect(nameField()).toBeInvalid();
    expect(addButton()).toBeDisabled();

    await user.clear(nameField());
    await user.type(nameField(), "ship it");
    expect(screen.getByRole("alert")).toHaveTextContent(/lowercase letters, numbers, underscores/);

    await user.clear(nameField());
    await user.type(nameField(), "tada");
    // Once the emoji's own codes have loaded.
    expect(await screen.findByRole("alert")).toHaveTextContent(CUSTOM_EMOJI_NAME_IS_STANDARD);

    await user.clear(nameField());
    await user.type(nameField(), "shipit2");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(addButton()).toBeEnabled();
  });

  it("shows what the server says of a name under its field, until the name's changed", async () => {
    serve({ added: () => Response.json({ error: CUSTOM_EMOJI_NAME_TAKEN, field: "name" }, { status: 409 }) });
    const { user, onAdded, onFailed } = show(ada);
    await user.upload(fileField(), png("shipit.png"));
    await waitFor(() => expect(addButton()).toBeEnabled());
    await user.click(addButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(CUSTOM_EMOJI_NAME_TAKEN);
    expect(onAdded).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    await user.type(nameField(), "2");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hands any other failure to the workspace's alerts, keeping what's chosen", async () => {
    serve({ added: () => Response.json({ error: "Ember isn't set up to store files" }, { status: 503 }) });
    const { user, onFailed } = show(ada);
    await user.upload(fileField(), png("shipit.png"));
    await waitFor(() => expect(addButton()).toBeEnabled());
    await user.click(addButton());
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 503 })));
    expect(nameField()).toHaveValue("shipit");
    expect(addButton()).toBeEnabled();
  });

  it("lets you remove the emoji you added, once you've confirmed, and administrators any", async () => {
    const fetched = serve();
    const confirmed = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    const { user, onRemoved } = show(ada, shipit, parrot);
    expect(screen.queryByRole("button", { name: "Remove :party_parrot:" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove :shipit:" }));
    expect(confirmed).toHaveBeenCalledWith("Remove :shipit:? Messages and reactions that use it will show its name instead.");
    expect(fetched).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove :shipit:" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith("shipit"));
    expect(fetched).toHaveBeenCalledWith("/api/emoji/shipit", expect.objectContaining({ method: "DELETE" }));
    expect(await screen.findByText(":shipit: removed")).toBeInTheDocument();
  });

  it("offers administrators Remove on everyone's emoji", () => {
    show(grace, shipit, parrot);
    expect(screen.getByRole("button", { name: "Remove :shipit:" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove :party_parrot:" })).toBeInTheDocument();
  });

  it("takes an emoji someone else removed first as removed, and hands any other failure on", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetched = serve({ removed: () => Response.json({ error: "No custom emoji has that name" }, { status: 404 }) });
    const { user, onRemoved, onFailed } = show(grace, shipit);
    await user.click(screen.getByRole("button", { name: "Remove :shipit:" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith("shipit"));
    expect(onFailed).not.toHaveBeenCalled();

    fetched.mockImplementation(async () => Response.json({ error: "Only administrators can remove an emoji someone else added" }, { status: 403 }));
    await user.click(screen.getByRole("button", { name: "Remove :shipit:" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
  });

  it("searches the emoji by name once there are a few", async () => {
    const many = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((name) => emoji(name, ada));
    const { user } = show(ada, ...many);
    await user.type(screen.getByRole("searchbox", { name: "Search emoji by name" }), "ETA");
    expect(rows().map((row) => row!.match(/^:[a-z]+:/)![0])).toEqual([":beta:", ":eta:", ":theta:", ":zeta:"]);
    await user.type(screen.getByRole("searchbox"), "x");
    expect(screen.getByText("No emoji match “ETAx”.")).toBeInTheDocument();
  });

  it("keeps the search while it's searching, though fewer emoji are left than it shows for", async () => {
    const many = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((name) => emoji(name, ada));
    const handlers = { onAdded: vi.fn(), onRemoved: vi.fn(), onFailed: vi.fn() };
    const page = (listed: CustomEmoji[]) => (
      <FlashProvider workspace>
        <PeopleContext value={people}>
          <CustomEmojiContext value={new Map(listed.map((one) => [one.name, one]))}>
            <Sheet>
              <CustomEmojiPage me={ada} {...handlers} />
            </Sheet>
          </CustomEmojiContext>
        </PeopleContext>
      </FlashProvider>
    );
    const { rerender } = render(page(many));
    await userEvent.type(screen.getByRole("searchbox"), "eta");
    rerender(page(many.slice(1)));
    expect(screen.getByRole("searchbox")).toHaveValue("eta");
    await userEvent.clear(screen.getByRole("searchbox"));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(rows()).toHaveLength(7);
  });

  it("has no search for a handful", () => {
    show(ada, shipit, parrot);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
