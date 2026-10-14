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
  it("sends the trimmed text on Enter, as the paragraph Lexxy sends, then clears the box and keeps focus", async () => {
    const { onSend, input, user } = showComposer();
    await user.type(input, "  Hello there  {Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>Hello there</p>");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("starts a new line on Shift+Enter instead of sending", async () => {
    const { onSend, input, user } = showComposer();
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("<p>line one<br>line two</p>");
  });

  it("sends what's typed as text, never as markup", async () => {
    const { onSend, input, user } = showComposer();
    await user.type(input, "<b>1</b> < 2 & 3{Enter}");
    expect(onSend).toHaveBeenCalledWith("<p>&lt;b&gt;1&lt;/b&gt; &lt; 2 &amp; 3</p>");
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
  it("reports typing while there's text, and stops when it's cleared, but not when the box loses focus", async () => {
    const { onTyping, input, user } = showComposer();
    await user.type(input, "Hi");
    expect(onTyping).toHaveBeenLastCalledWith(true);
    await user.clear(input);
    expect(onTyping).toHaveBeenLastCalledWith(false);
    await user.type(input, "Hi");
    onTyping.mockClear();
    await user.tab();
    expect(onTyping).not.toHaveBeenCalled();
  });

  const typist = (name: string, i: number): User => ({ id: `u${i}`, name });

  it.each([
    [["Ada"], "Ada"],
    [["Grace", "Ada"], "Ada, Grace"],
    [["Linus", "Grace", "Ada", "Ken"], "Ada, Grace, Ken, Linus"],
    // Sorted by code unit, as JavaScript sorts strings, so capitals come first.
    [["ada", "Bob"], "Bob, ada"],
  ])("names whoever is typing after a spinner, sorted and comma-separated: %j", (names, line) => {
    const { view } = showComposer({ typing: names.map(typist) });
    const indicator = view.container.querySelector(".spinner")!;
    expect(indicator).toHaveTextContent(line, { normalizeWhitespace: false });
    expect(indicator).not.toHaveClass("hidden");
    expect(indicator.parentElement).not.toHaveClass("opacity-0");
    expect(indicator.closest("[aria-live]")).toBeNull();
  });

  it("shows nothing while nobody is typing, and fades in when someone starts", () => {
    const { view } = showComposer();
    const indicator = view.container.querySelector(".spinner")!;
    expect(indicator).toHaveTextContent("");
    expect(indicator).toHaveClass("hidden");
    expect(indicator.parentElement).toHaveClass("opacity-0", "transition-opacity", "duration-300");
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
