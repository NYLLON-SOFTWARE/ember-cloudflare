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

describe("MessageItem", () => {
  it("caps edits at the length the server accepts", () => {
    const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(), remove: vi.fn() };
    render(<MessageItem message={message} me={ada} threaded={false} actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", String(MAX_MESSAGE_LENGTH));
  });
});
