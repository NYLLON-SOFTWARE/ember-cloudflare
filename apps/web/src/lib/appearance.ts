// Light / Dark / System, saved per browser and kept in step across tabs, like ember-rust's picker.

export type Appearance = "light" | "dark" | "system";

const KEY = "ember:appearance";
const media = () => matchMedia("(prefers-color-scheme: dark)");

export function savedAppearance(): Appearance {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyAppearance(appearance: Appearance): void {
  const dark = appearance === "dark" || (appearance === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function saveAppearance(appearance: Appearance): void {
  try {
    if (appearance === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, appearance);
  } catch {
    // Storage can be unavailable; the choice still applies to this page.
  }
  applyAppearance(appearance);
}

/** Re-applies on OS theme changes and on changes made in other tabs. */
export function watchAppearance(onChange: (appearance: Appearance) => void): () => void {
  const update = () => {
    const appearance = savedAppearance();
    applyAppearance(appearance);
    onChange(appearance);
  };
  const onStorage = (event: StorageEvent) => event.key === KEY && update();
  const mql = media();
  mql.addEventListener("change", update);
  window.addEventListener("storage", onStorage);
  return () => {
    mql.removeEventListener("change", update);
    window.removeEventListener("storage", onStorage);
  };
}
