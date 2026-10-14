import { feature } from "@ember/parity";
import { MAX_MESSAGE_LENGTH, type User } from "@ember/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer, RoomDeleted } from "./composer";

function showComposer({ typing = [] as User[], disabled = false } = {}) {
  const onSend = vi.fn();
  const onTyping = vi.fn();
  const view = render(<Composer roomName="general" typing={typing} disabled={disabled} onSend={onSend} onTyping={onTyping} />);
  return { onSend, onTyping, view, user: userEvent.setup(), input: screen.getByRole("textbox", { name: "Message #general" }) };
}

describe(feature("composer.layout"), () => {
  it("names the box after the room, with a hint about new lines and a Send button", () => {
    showComposer();
    expect(screen.getByRole("textbox", { name: "Message #general" })).toHaveAttribute("placeholder", "Message #general");
    expect(screen.getByText("Shift + Enter for a new line")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});

describe(feature("composer.send"), () => {
  it("sends the trimmed text on Enter, then clears the box and keeps focus", async () => {
    const { onSend, input, user } = showComposer();
    await user.type(input, "  Hello there  {Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("Hello there");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("starts a new line on Shift+Enter instead of sending", async () => {
    const { onSend, input, user } = showComposer();
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("line one\nline two");
  });

  it("won't send a blank message", async () => {
    const { onSend, input, user } = showComposer();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(input, "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("holds on to the text while the room is disconnected", async () => {
    const { onSend, input, user } = showComposer({ disabled: true });
    await user.type(input, "Are you there?{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("Are you there?");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it(`stops at ${MAX_MESSAGE_LENGTH} characters`, () => {
    showComposer();
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", String(MAX_MESSAGE_LENGTH));
  });
});

describe(feature("realtime.typing"), () => {
  it("reports typing while there's text, and stops when it's cleared or the box loses focus", async () => {
    const { onTyping, input, user } = showComposer();
    await user.type(input, "Hi");
    expect(onTyping).toHaveBeenLastCalledWith(true);
    await user.clear(input);
    expect(onTyping).toHaveBeenLastCalledWith(false);
    await user.type(input, "Hi");
    await user.tab();
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  it.each([
    [[], ""],
    [[{ id: "u1", name: "Ada" }], "Ada is typing…"],
    [[{ id: "u1", name: "Ada" }, { id: "u2", name: "Grace" }], "Ada and Grace are typing…"],
    [[{ id: "u1", name: "Ada" }, { id: "u2", name: "Grace" }, { id: "u3", name: "Linus" }], "Several people are typing…"],
  ])("names who is typing: %j", (typing, sentence) => {
    const { view } = showComposer({ typing });
    expect(view.container.querySelector("[aria-live=polite]")).toHaveTextContent(sentence, { normalizeWhitespace: true });
  });
});

describe(feature("rooms.member-only-access"), () => {
  it("says a room that's gone was deleted, in red, shaking once where motion is welcome", () => {
    render(<RoomDeleted />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("This room was deleted.");
    expect(notice).toHaveClass("text-negative", "border-negative", "motion-safe:animate-shake");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
