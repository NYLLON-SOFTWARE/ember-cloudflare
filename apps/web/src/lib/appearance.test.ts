import { feature } from "@ember/parity";
import { describe, expect, it, vi } from "vitest";
import { setPrefersDark } from "@/test-media";
import { applyAppearance, saveAppearance, savedAppearance, watchAppearance } from "./appearance";

const isDark = () => document.documentElement.classList.contains("dark");

describe(feature("ui.appearance"), () => {
  it("saves Light or Dark in this browser and applies it", () => {
    saveAppearance("dark");
    expect(localStorage.getItem("ember:appearance")).toBe("dark");
    expect(savedAppearance()).toBe("dark");
    expect(isDark()).toBe(true);

    saveAppearance("light");
    expect(localStorage.getItem("ember:appearance")).toBe("light");
    expect(isDark()).toBe(false);
  });

  it("follows the system by default, and forgets the choice when set back to System", () => {
    expect(savedAppearance()).toBe("system");
    saveAppearance("dark");
    saveAppearance("system");
    expect(localStorage.getItem("ember:appearance")).toBeNull();

    setPrefersDark(true);
    applyAppearance("system");
    expect(isDark()).toBe(true);
  });

  it("treats anything unexpected in storage as System", () => {
    localStorage.setItem("ember:appearance", "sepia");
    expect(savedAppearance()).toBe("system");
  });

  it("keeps up with the system theme while following it", () => {
    const onChange = vi.fn();
    const stop = watchAppearance(onChange);
    setPrefersDark(true);
    expect(isDark()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith("system");

    saveAppearance("light");
    setPrefersDark(false);
    setPrefersDark(true);
    expect(isDark()).toBe(false);
    stop();
  });

  it("picks up a choice made in another tab", () => {
    const onChange = vi.fn();
    const stop = watchAppearance(onChange);
    localStorage.setItem("ember:appearance", "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "ember:appearance", newValue: "dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
    expect(isDark()).toBe(true);

    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });
});
