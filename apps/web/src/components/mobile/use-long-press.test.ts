import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, useLongPress } from "./use-long-press";

function pointer(type: string, pointerType = "touch") {
  return Object.assign(new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 }), {
    pointerType,
    isPrimary: true,
  });
}

function lift() {
  return new Event("touchend", { bubbles: true, cancelable: true });
}

describe("useLongPress", () => {
  let element: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement("div");
    document.body.append(element);
  });

  afterEach(() => {
    element.remove();
    vi.useRealTimers();
  });

  it("presses once a finger rests long enough", () => {
    const onPress = vi.fn();
    renderHook(() => useLongPress({ current: element }, onPress));
    element.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("doesn't press when the finger lifts first or for a mouse", () => {
    const onPress = vi.fn();
    renderHook(() => useLongPress({ current: element }, onPress));
    element.dispatchEvent(pointer("pointerdown"));
    element.dispatchEvent(pointer("pointerup"));
    element.dispatchEvent(pointer("pointerdown", "mouse"));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("cancels the lift that ends a long press, so its tap can't land on what the press opened", () => {
    renderHook(() => useLongPress({ current: element }, () => {}));
    const short = lift();
    element.dispatchEvent(pointer("pointerdown"));
    element.dispatchEvent(short);
    expect(short.defaultPrevented).toBe(false);

    const long = lift();
    element.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    element.dispatchEvent(long);
    expect(long.defaultPrevented).toBe(true);
  });
});
