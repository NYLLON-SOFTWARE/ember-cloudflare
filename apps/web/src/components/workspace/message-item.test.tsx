import { MAX_MESSAGE_LENGTH, type Message, type User } from "@ember/protocol";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageItem } from "./message-item";

const ada: User = { id: "u1", name: "Ada" };
const message: Message = {
  id: "m1",
  clientMessageId: "c1",
  roomId: "general",
  creator: ada,
  body: "hi",
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  boosts: [],
};

const shown = (sent = true) => {
  const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(() => sent), remove: vi.fn() };
  render(<MessageItem message={message} me={ada} threaded={false} actions={actions} />);
  return actions;
};

/** The Message options button on the message that says `body`. */
const optionsOn = (body: string) => within(screen.getByText(body).closest("article")!).getByRole("button", { name: "Message options" });

const editing = (sent = true) => {
  const actions = shown(sent);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  return { actions, textbox: screen.getByRole("textbox") };
};

afterEach(() => vi.unstubAllGlobals());

/** Lays components out as they are on a phone, where nothing can hover. */
const onTouchScreen = () => {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(hover: none)", media, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
};

describe("MessageItem", () => {
  it("caps edits at the length the server accepts", () => {
    expect(editing().textbox).toHaveAttribute("maxlength", String(MAX_MESSAGE_LENGTH));
  });

  it("saves an edit on Enter, but not while an input method is composing", () => {
    const { actions, textbox } = editing();
    fireEvent.change(textbox, { target: { value: "こんにちは" } });
    fireEvent.keyDown(textbox, { key: "Enter", isComposing: true });
    expect(actions.edit).not.toHaveBeenCalled();
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(actions.edit).toHaveBeenCalledWith("m1", "こんにちは");
    expect(textbox).not.toBeInTheDocument();
  });

  it("keeps the editor and its draft when the edit can't be sent", () => {
    const { actions, textbox } = editing(false);
    fireEvent.change(textbox, { target: { value: "hello" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(actions.edit).toHaveBeenCalledWith("m1", "hello");
    expect(screen.getByRole("textbox")).toHaveValue("hello");
  });

  it("puts the options button before the actions it opens, so a keyboard reaches them", () => {
    shown();
    const options = screen.getByRole("button", { name: "Message options" });
    const bar = screen.getByRole("group", { name: "Message actions" });
    expect(options.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // While editing there's no bar to open.
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: "Message options" })).not.toBeInTheDocument();
  });

  it("closes the actions after a reaction and hands focus to Message options", () => {
    const actions = shown();
    const options = optionsOn("hi");
    fireEvent.click(options);
    expect(options).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Thumbs up" }));
    expect(actions.boost).toHaveBeenCalledWith("m1", "👍");
    expect(options).toHaveAttribute("aria-expanded", "false");
    expect(options).toHaveFocus();
  });

  it("closes the actions on a click or focus anywhere else, so only one message has them open", () => {
    const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(() => true), remove: vi.fn() };
    render(
      <>
        <MessageItem message={message} me={ada} threaded={false} actions={actions} />
        <MessageItem message={{ ...message, id: "m2", clientMessageId: "c2", body: "there" }} me={ada} threaded actions={actions} />
      </>,
    );
    fireEvent.click(optionsOn("hi"));
    fireEvent.click(screen.getByText("hi"));
    expect(optionsOn("hi")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(optionsOn("hi"));
    fireEvent.click(optionsOn("there"));
    expect(optionsOn("hi")).toHaveAttribute("aria-expanded", "false");
    expect(optionsOn("there")).toHaveAttribute("aria-expanded", "true");

    // A keyboard moving on to the other message closes them too.
    act(() => optionsOn("hi").focus());
    expect(optionsOn("there")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a touch screen's actions from the options button, which closes them again", () => {
    onTouchScreen();
    const actions = shown();
    const options = screen.getByRole("button", { name: "Message options" });
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();

    fireEvent.click(options);
    expect(options).toHaveAttribute("aria-expanded", "true");
    // They open beside the message, not over its button.
    expect(screen.getByRole("article").contains(screen.getByRole("group", { name: "Message actions" }))).toBe(false);
    fireEvent.click(options);
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();

    // Sending a reaction closes them, as on ember-rust.
    fireEvent.click(options);
    fireEvent.click(screen.getByRole("button", { name: "Thumbs up" }));
    expect(actions.boost).toHaveBeenCalledWith("m1", "👍");
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();
  });
});
