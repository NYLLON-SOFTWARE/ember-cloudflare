import { useEffect, useEffectEvent, type RefObject } from "react";

/** How long a finger rests on something to press it long, as iOS's and Android's long press. */
export const LONG_PRESS_MS = 500;

/** How far a finger can drift while it's held before it's scrolling instead. */
const DRIFT_PX = 10;

/** Where a long press doesn't start: in something written in, whose own long press selects text. */
const TYPED_IN = "input, textarea, [contenteditable=true]";

/**
 * Calls `onPress` once a finger has rested on `target` for LONG_PRESS_MS, while `enabled`. Moving the
 * finger, scrolling or lifting it first cancels the press, and the tap a long press ends with does
 * nothing, so a link held doesn't open as the finger lifts. The browser's own long press, its context
 * menu, is kept away, or presses long itself where it comes first.
 */
export function useLongPress(target: RefObject<HTMLElement | null>, onPress: () => void, enabled = true) {
  const pressed = useEffectEvent(onPress);

  useEffect(() => {
    const element = target.current;
    if (!enabled || !element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    // Whether the press that's ending was long, so the tap it ends with is swallowed.
    let long = false;

    const cancel = () => {
      clearTimeout(timer);
      start = null;
      document.removeEventListener("scroll", cancel, { capture: true });
    };
    const press = () => {
      cancel();
      long = true;
      navigator.vibrate?.(10);
      pressed();
    };
    const down = (event: PointerEvent) => {
      long = false;
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      if (event.target instanceof Element && event.target.closest(TYPED_IN)) return;
      cancel();
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(press, LONG_PRESS_MS);
      document.addEventListener("scroll", cancel, { capture: true, passive: true });
    };
    const move = (event: PointerEvent) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRIFT_PX) cancel();
    };
    const click = (event: MouseEvent) => {
      if (!long) return;
      long = false;
      event.preventDefault();
      event.stopPropagation();
    };
    // The tap a long press ends with lands wherever is under the finger by then, which can be what
    // the press opened, so the lift itself is cancelled, and with it the mouse events it'd make.
    const lift = (event: TouchEvent) => {
      if (long && event.cancelable) event.preventDefault();
    };
    const contextMenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(TYPED_IN)) return;
      event.preventDefault();
      if (start) press();
    };

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", cancel);
    element.addEventListener("pointercancel", cancel);
    element.addEventListener("click", click, { capture: true });
    element.addEventListener("touchend", lift, { passive: false });
    element.addEventListener("contextmenu", contextMenu);
    return () => {
      cancel();
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", cancel);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("click", click, { capture: true });
      element.removeEventListener("touchend", lift);
      element.removeEventListener("contextmenu", contextMenu);
    };
  }, [target, enabled]);
}
