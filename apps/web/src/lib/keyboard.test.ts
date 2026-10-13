import type { KeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendsMessage } from "./keyboard";

function pointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" && coarse }));
}

const press = (key: string, modifiers: Partial<Pick<KeyboardEvent, "shiftKey" | "metaKey" | "ctrlKey">> = {}, isComposing = false) =>
  ({ key, shiftKey: false, metaKey: false, ctrlKey: false, ...modifiers, nativeEvent: { isComposing } }) as unknown as KeyboardEvent;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendsMessage", () => {
  it("sends on Enter and starts a new line on Shift+Enter with a physical keyboard", () => {
    pointer(false);
    expect(sendsMessage(press("Enter"))).toBe(true);
    expect(sendsMessage(press("Enter", { shiftKey: true }))).toBe(false);
  });

  it("starts a new line on Enter with a touch keyboard", () => {
    pointer(true);
    expect(sendsMessage(press("Enter"))).toBe(false);
  });

  it("sends on Cmd+Enter or Ctrl+Enter everywhere", () => {
    pointer(true);
    expect(sendsMessage(press("Enter", { metaKey: true }))).toBe(true);
    expect(sendsMessage(press("Enter", { ctrlKey: true }))).toBe(true);
  });

  it("leaves Enter to an input method that is still composing", () => {
    pointer(false);
    expect(sendsMessage(press("Enter", {}, true))).toBe(false);
  });

  it("ignores other keys", () => {
    pointer(false);
    expect(sendsMessage(press("a"))).toBe(false);
  });
});
