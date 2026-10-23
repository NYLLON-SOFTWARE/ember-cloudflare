import { feature } from "@ember/parity";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, CustomStyles } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { Sheet } from "@/components/ui/sheet";
import { AccountContext } from "@/hooks/use-account";
import { CustomStylesPage } from "./custom-styles-page";

const CSS = ".mb-app { --mb-ink: rebeccapurple; }";
const styled: Account = { name: "Analytical Engines", hideTranslationButtons: true, customStyles: CSS, restrictRoomCreation: false, logo: null, customDomain: null };

interface Answers {
  /** What loading the CSS answers, rather than `CSS`. */
  loaded?: () => Response | Promise<Response>;
  /** What saving the CSS answers, rather than the workspace with the CSS sent. */
  saved?: () => Response | Promise<Response>;
}

/** Answers the page's requests as the server does for an administrator, or as `answers` says. */
function serve({ loaded = () => Response.json({ customStyles: CSS } satisfies CustomStyles), saved }: Answers = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    switch (request) {
      case "GET /api/account/custom_styles":
        return loaded();
      case "PATCH /api/account/custom_styles":
        return saved ? saved() : Response.json({ account: { ...styled, ...(JSON.parse(String(init?.body)) as CustomStyles) } });
      default:
        throw new Error(`Unexpected request for ${request}`);
    }
  });
}

function showPage(account = styled) {
  const [answered, onFailed] = [vi.fn(), vi.fn()];
  history.replaceState(null, "", "/account/custom_styles/edit");
  render(
    <AccountContext value={account}>
      <FlashProvider workspace>
        <Sheet>
          <CustomStylesPage askForAccount={() => answered} onFailed={onFailed} />
        </Sheet>
      </FlashProvider>
    </AccountContext>,
  );
  return { answered, onFailed, user: userEvent.setup() };
}

const field = () => screen.getByRole("textbox", { name: "Custom CSS" });
/** The field, once the CSS has loaded into it. */
const loadedField = async () => {
  await waitFor(() => expect(field()).toBeEnabled());
  return field();
};
const saveButton = () => screen.getByRole("button", { name: "Save changes" });
/** The CSS each save sent, in order. */
const saved = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => (JSON.parse(String(init?.body)) as CustomStyles).customStyles);

beforeEach(() => {
  serve();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe(feature("accounts.custom-css"), () => {
  it("reads Custom CSS, titled Custom styles, with Go Back to workspace settings", () => {
    showPage();
    expect(document.title).toBe("Custom styles");
    expect(screen.getByRole("heading", { level: 1, name: "Custom CSS" })).toBeInTheDocument();
    expect(screen.getByText("Add custom CSS styles.")).toBeInTheDocument();
    expect(screen.getByText("Use Caution: you could break things.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/account/edit");
  });

  it("is busy until the CSS loads, and then shows it to change", async () => {
    showPage();
    const panel = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(panel).toHaveAttribute("aria-busy", "true");
    expect(field()).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(await loadedField()).toHaveValue(CSS);
    expect(panel).toHaveAttribute("aria-busy", "false");
    expect(saveButton()).toBeEnabled();
  });

  it("takes CSS as ember-rust's field does: as typed, with nothing correcting it", () => {
    showPage();
    expect(field()).toHaveAttribute("placeholder", "Add CSS styles…");
    expect(field()).toHaveAttribute("rows", "16");
    expect(field()).toHaveAttribute("maxlength", "100000");
    expect(field()).toHaveAttribute("spellcheck", "false");
    for (const attribute of ["autocorrect", "autocapitalize", "autocomplete"]) expect(field()).toHaveAttribute(attribute, "off");
  });

  it("saves the CSS with the check, saying ✓, for every page to apply at once", async () => {
    const { answered, user } = showPage();
    const css = await loadedField();
    await user.clear(css);
    await user.type(css, "body {{ color: red; }");
    await user.click(saveButton());

    // The flash's check alone, read as "Changes saved".
    expect(await screen.findByRole("alert")).toHaveTextContent("Changes saved");
    expect(saved()).toEqual(["body { color: red; }"]);
    expect(answered).toHaveBeenCalledWith({ ...styled, customStyles: "body { color: red; }" });
    expect(css).toHaveValue("body { color: red; }");
  });

  it("saves with Ctrl+Enter or ⌘+Enter, where Enter alone starts a new line", async () => {
    const { answered, user } = showPage();
    const css = await loadedField();
    await user.type(css, "{Enter}");
    expect(css).toHaveValue(`${CSS}\n`);
    expect(saved()).toEqual([]);

    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(answered).toHaveBeenCalledTimes(1));
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(answered).toHaveBeenCalledTimes(2));
    expect(saved()).toEqual([`${CSS}\n`, `${CSS}\n`]);
    expect(css).toHaveValue(`${CSS}\n`);
  });

  it("can't save again until the last save is answered", async () => {
    let answer = (_: Response) => {};
    serve({ saved: () => new Promise((resolve) => (answer = resolve)) });
    const { user } = showPage();
    await loadedField();
    await user.click(saveButton());
    expect(saveButton()).toBeDisabled();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(saved()).toEqual([CSS]);
    answer(Response.json({ account: styled }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it("says why a save failed, keeping the CSS typed", async () => {
    serve({ saved: () => Response.json({ error: "Custom CSS must be at most 100,000 characters" }, { status: 422 }) });
    const { answered, onFailed, user } = showPage();
    await user.type(await loadedField(), " /* more */");
    await user.click(saveButton());
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 422, message: "Custom CSS must be at most 100,000 characters" })));
    expect(field()).toHaveValue(`${CSS} /* more */`);
    expect(saveButton()).toBeEnabled();
    expect(answered).not.toHaveBeenCalled();
  });

  it("sends anyone but an administrator to workspace settings, saying why, where ember-rust answers an empty 403", async () => {
    serve({ loaded: () => Response.json({ error: "Only administrators can change the workspace" }, { status: 403 }) });
    const { onFailed } = showPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Only administrators can change the workspace");
    expect(location.pathname).toBe("/account/edit");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("says why the CSS didn't load", async () => {
    serve({ loaded: () => Response.json({ error: "Something went wrong" }, { status: 500 }) });
    const { onFailed } = showPage();
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 500 })));
    expect(location.pathname).toBe("/account/custom_styles/edit");
  });
});

describe(feature("accounts.translation-buttons"), () => {
  it("has a translation button for the CSS once an administrator shows them", () => {
    showPage({ ...styled, hideTranslationButtons: false });
    expect(screen.getByText("Translate")).toBeInTheDocument();
  });

  it("has none while they're hidden", () => {
    showPage();
    expect(screen.queryByText("Translate")).not.toBeInTheDocument();
  });
});
