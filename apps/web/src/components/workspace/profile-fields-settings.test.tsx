import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PROFILE_FIELDS, PROFILE_FIELDS_FULL, type ProfileField } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { Sheet } from "@/components/ui/sheet";
import { CONFIRM_REMOVE_FIELD, ProfileFieldsSettings } from "./profile-fields-settings";
import { CHANGES_SAVED } from "./settings-page";

/** The workspace's fields, Title free text and Pronouns with set choices, in the order their profiles show them. */
const FIELDS: ProfileField[] = [
  { id: "field-1", name: "Title", options: null },
  { id: "field-2", name: "Pronouns", options: ["she/her", "they/them"] },
];

interface Answers {
  /** What loading the fields answers, rather than `FIELDS`. */
  loaded?: () => Response | Promise<Response>;
  /** What adding a field answers, rather than the fields with the one sent added. */
  added?: () => Response | Promise<Response>;
  /** What changing a field answers, rather than the fields with the change made. */
  changed?: () => Response | Promise<Response>;
  /** What reordering answers, rather than the fields in the order sent. */
  ordered?: (ids: string[]) => Response | Promise<Response>;
  /** What deleting answers, rather than the fields without the one deleted. */
  deleted?: () => Response | Promise<Response>;
}

/** Answers the card's requests as the server does, or as `answers` says, keeping the fields as it has. */
function serve({ loaded, added, changed, ordered, deleted }: Answers = {}) {
  let fields = FIELDS;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    const fresh = () => Response.json({ fields });
    if (request === "GET /api/account/profile_fields") return loaded ? loaded() : fresh();
    if (request === "POST /api/account/profile_fields") {
      if (added) return added();
      const { name, options } = JSON.parse(String(init?.body)) as { name: string; options: string[] | null };
      fields = [...fields, { id: `field-${fields.length + 1}`, name, options }];
      return fresh();
    }
    if (/^PATCH \/api\/account\/profile_fields\/\S+$/.test(request)) {
      if (changed) return changed();
      const { name, options } = JSON.parse(String(init?.body)) as { name: string; options: string[] | null };
      fields = fields.map((field) => (request.endsWith(field.id) ? { ...field, name, options } : field));
      return fresh();
    }
    if (request === "PUT /api/account/profile_fields/order") {
      const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
      return ordered ? ordered(ids) : Response.json({ fields: ids.map((id) => fields.find((field) => field.id === id)!) });
    }
    if (/^DELETE \/api\/account\/profile_fields\/\S+$/.test(request)) {
      if (deleted) return deleted();
      fields = fields.filter((field) => !request.endsWith(field.id));
      return fresh();
    }
    throw new Error(`Unexpected request for ${request}`);
  });
}

/** The card, with what its answers answer, for a test to press. */
function show(answers: Answers = {}) {
  serve(answers);
  const onFailed = vi.fn();
  render(
    <FlashProvider workspace>
      <Sheet>
        <ProfileFieldsSettings onFailed={onFailed} />
      </Sheet>
    </FlashProvider>,
  );
  return { onFailed, user: userEvent.setup() };
}

/** The card once its fields have loaded, with the list they came in. */
const shown = async () => {
  const list = await screen.findByRole("list", { name: "Profile fields" });
  await waitFor(() => expect(list).not.toBeEmptyDOMElement());
  return list;
};

/** The names of the fields, in the order they're listed, "(editing)" for a row whose form is open. */
const listed = () =>
  screen
    .getAllByRole("listitem")
    .map((row) => within(row).queryByText(/^(Title|Pronouns|Phone|Job title|Shirt size)$/)?.textContent ?? "(editing)");

/** What each change sent, in order. */
const sent = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "POST" || init?.method === "PATCH" || init?.method === "DELETE" || init?.method === "PUT")
    .map(([input, init]) => ({ path: String(input), method: init?.method, body: init?.body && JSON.parse(String(init?.body)) }));

beforeEach(() => {
  history.replaceState(null, "", "/account/edit#profile-fields-settings");
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe("Profile fields on workspace settings", () => {
  it("lists the fields in the order their profiles show them, each said to take plain text or its choices", async () => {
    show();
    const list = await shown();
    expect(listed()).toEqual(["Title", "Pronouns"]);
    expect(within(list).getByText("Plain text")).toBeInTheDocument();
    expect(within(list).getByText("Set choices: she/her, they/them")).toBeInTheDocument();
    // The form to add one follows.
    expect(screen.getByRole("button", { name: "Add field" })).toBeInTheDocument();
  });

  it("says why the fields didn't load", async () => {
    const { onFailed } = show({ loaded: () => Response.json({ error: "Something went wrong" }, { status: 500 }) });
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 500 })));
  });

  it("adds a field that takes plain text, and one with set choices given a line each", async () => {
    const { user } = show();
    await shown();
    await user.type(screen.getByLabelText("Name"), "Phone");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await waitFor(() => expect(listed()).toEqual(["Title", "Pronouns", "Phone"]));
    expect(sent()).toEqual([{ path: "/api/account/profile_fields", method: "POST", body: { name: "Phone", options: null } }]);

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Shirt size");
    await user.selectOptions(screen.getByLabelText("Kind"), "Set choices");
    const choices = screen.getByLabelText("Choices, one per line");
    await user.type(choices, "S\nM\nL");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await waitFor(() => expect(listed()).toEqual(["Title", "Pronouns", "Phone", "Shirt size"]));
    expect(sent()[1]).toEqual({ path: "/api/account/profile_fields", method: "POST", body: { name: "Shirt size", options: ["S", "M", "L"] } });
    expect(within(screen.getByRole("list", { name: "Profile fields" })).getByText("Set choices: S, M, L")).toBeInTheDocument();
  });

  it("leaves the form as it was, saying why a field wasn't added", async () => {
    const { onFailed, user } = show({ added: () => Response.json({ error: PROFILE_FIELDS_FULL }, { status: 422 }) });
    await shown();
    await user.type(screen.getByLabelText("Name"), "Phone");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 422, message: PROFILE_FIELDS_FULL })));
    expect(screen.getByLabelText("Name")).toHaveValue("Phone");
  });

  it("renames a field with its pencil, and its choices stay", async () => {
    const { user } = show();
    await shown();
    await user.click(screen.getByRole("button", { name: "Edit Title" }));
    const form = screen.getByRole("form", { name: "Edit Title" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Title");
    expect(within(form).queryByLabelText("Choices, one per line")).toBeNull();
    await user.clear(within(form).getByLabelText("Name"));
    await user.type(within(form).getByLabelText("Name"), "Job title");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(listed()).toEqual(["Job title", "Pronouns"]));
    expect(sent()).toEqual([{ path: "/api/account/profile_fields/field-1", method: "PATCH", body: { name: "Job title", options: null } }]);
    // The form went away, and Cancel leaves the field as it is.
    await user.click(screen.getByRole("button", { name: "Edit Job title" }));
    const again = screen.getByRole("form", { name: "Edit Job title" });
    await user.type(within(again).getByLabelText("Name"), "!");
    await user.click(within(again).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Edit Job title" })).toBeNull();
    expect(listed()).toEqual(["Job title", "Pronouns"]);
  });

  it("edits a field's choices, one in each line", async () => {
    const { user } = show();
    await shown();
    await user.click(screen.getByRole("button", { name: "Edit Pronouns" }));
    const form = screen.getByRole("form", { name: "Edit Pronouns" });
    const choices = within(form).getByLabelText("Choices, one per line");
    expect(choices).toHaveValue("she/her\nthey/them");
    await user.clear(choices);
    await user.type(choices, "she/her\nhe/him\nthey/them");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Profile fields" })).getByText("Set choices: she/her, he/him, they/them")).toBeInTheDocument());
    expect(sent()).toEqual([{ path: "/api/account/profile_fields/field-2", method: "PATCH", body: { name: "Pronouns", options: ["she/her", "he/him", "they/them"] } }]);
  });

  it("moves a field up and down, saving the order", async () => {
    const { user } = show({ ordered: (ids) => Response.json({ fields: ids.map((id) => FIELDS.find((field) => field.id === id)!) }) });
    await shown();
    expect(screen.getByRole("button", { name: "Move Title up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Pronouns down" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Move Title down" }));
    await waitFor(() => expect(listed()).toEqual(["Pronouns", "Title"]));
    expect(sent()).toEqual([{ path: "/api/account/profile_fields/order", method: "PUT", body: { ids: ["field-2", "field-1"] } }]);
    expect(screen.getByRole("button", { name: "Move Pronouns up" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Move Title up" }));
    await waitFor(() => expect(listed()).toEqual(["Title", "Pronouns"]));
  });

  it("takes a field away, asking first", async () => {
    const askConfirm = vi.spyOn(globalThis, "confirm").mockImplementation(() => false);
    const { user } = show();
    await shown();
    await user.click(screen.getByRole("button", { name: "Delete Title" }));
    expect(askConfirm).toHaveBeenCalledWith(CONFIRM_REMOVE_FIELD);
    expect(sent()).toEqual([]);
    expect(listed()).toEqual(["Title", "Pronouns"]);

    askConfirm.mockImplementation(() => true);
    await user.click(screen.getByRole("button", { name: "Delete Title" }));
    await waitFor(() => expect(listed()).toEqual(["Pronouns"]));
    expect(sent()).toEqual([{ path: "/api/account/profile_fields/field-1", method: "DELETE", body: undefined }]);
  });

  it("says the workspace can't take another field once it has as many as it can, without the form", async () => {
    const many: ProfileField[] = Array.from({ length: MAX_PROFILE_FIELDS }, (_, n) => ({ id: `field-${n + 1}`, name: `Field ${n + 1}`, options: null }));
    show({ loaded: () => Response.json({ fields: many }) });
    await waitFor(() => expect(screen.getByText(PROFILE_FIELDS_FULL)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Add field" })).toBeNull();
  });

  it("says why a change was refused, keeping the list as it was", async () => {
    const { onFailed, user } = show({ changed: () => Response.json({ error: "Give the field a name of at most 100 characters." }, { status: 422 }) });
    await shown();
    await user.click(screen.getByRole("button", { name: "Edit Title" }));
    const form = screen.getByRole("form", { name: "Edit Title" });
    await user.clear(within(form).getByLabelText("Name"));
    await user.type(within(form).getByLabelText("Name"), "Job title");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 422 })));
    // The form stays, with what was typed, and the field is as it was.
    expect(within(form).getByLabelText("Name")).toHaveValue("Job title");
    expect(listed()).toEqual(["(editing)", "Pronouns"]);
  });

  it("says Changes saved. once a field is added", async () => {
    const { user } = show();
    await shown();
    await user.type(screen.getByLabelText("Name"), "Phone");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CHANGES_SAVED);
  });
});
