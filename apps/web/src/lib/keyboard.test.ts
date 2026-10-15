import { afterEach, describe, expect, it, vi } from "vitest";
import { opensLink, sendsMessage } from "./keyboard";

function pointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" && coarse }));
}

const press = (key: string, init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key, ...init });

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

  it("starts a new paragraph on Enter while the formatting toolbar is open", () => {
    pointer(false);
    expect(sendsMessage(press("Enter"), { toolbarOpen: true })).toBe(false);
    expect(sendsMessage(press("Enter", { ctrlKey: true }), { toolbarOpen: true })).toBe(true);
  });

  it("sends on Cmd+Enter or Ctrl+Enter everywhere", () => {
    pointer(true);
    expect(sendsMessage(press("Enter", { metaKey: true }))).toBe(true);
    expect(sendsMessage(press("Enter", { ctrlKey: true }))).toBe(true);
  });

  it("leaves Enter to an input method that is still composing", () => {
    pointer(false);
    expect(sendsMessage(press("Enter", { isComposing: true }))).toBe(false);
    expect(sendsMessage(press("Enter", { isComposing: true, metaKey: true }))).toBe(false);
  });

  it("ignores other keys", () => {
    pointer(false);
    expect(sendsMessage(press("a"))).toBe(false);
  });
});

describe("opensLink", () => {
  it("is Ctrl+K or Cmd+K, as Lexxy's toolbar takes them", () => {
    expect(opensLink(press("k", { ctrlKey: true }))).toBe(true);
    expect(opensLink(press("k", { metaKey: true }))).toBe(true);
    expect(opensLink(press("K", { ctrlKey: true }))).toBe(true);
  });

  it("isn't K on its own or with other keys held", () => {
    expect(opensLink(press("k"))).toBe(false);
    expect(opensLink(press("k", { ctrlKey: true, metaKey: true }))).toBe(false);
    expect(opensLink(press("k", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(opensLink(press("k", { metaKey: true, altKey: true }))).toBe(false);
    expect(opensLink(press("j", { ctrlKey: true }))).toBe(false);
  });
});
