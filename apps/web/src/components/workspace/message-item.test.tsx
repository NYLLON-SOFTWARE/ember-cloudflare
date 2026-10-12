import { MAX_MESSAGE_LENGTH, type Message, type User } from "@ember/protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

const editing = (sent = true) => {
  const actions = shown(sent);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  return { actions, textbox: screen.getByRole("textbox") };
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
});
