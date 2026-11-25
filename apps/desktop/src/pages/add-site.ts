import type { AddSiteBridge, AddSiteProblem } from "../add-site-bridge.ts";

// The Add Site page: it hands the app the address typed, and says why, if the app can't add it. Once
// the app has, it opens the site's window and closes this one.

declare global {
  interface Window {
    emberDesktop: AddSiteBridge;
  }
}

const form = document.querySelector("form")!;
const field = document.querySelector<HTMLInputElement>("#address")!;
const button = form.querySelector("button")!;
const problem = document.querySelector<HTMLElement>("#problem")!;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const typed = field.value;
  checking(true);
  const outcome = await window.emberDesktop.addSite(typed).catch(() => ({ problem: "unreachable" as const }));
  if ("added" in outcome) return;
  checking(false);
  problem.textContent = messageOf(outcome.problem, typed);
  problem.hidden = false;
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", problem.id);
  field.select();
});

function checking(busy: boolean): void {
  button.disabled = busy;
  button.textContent = busy ? "Checking…" : "Add site";
  field.readOnly = busy;
}

function messageOf(problem: AddSiteProblem, typed: string): string {
  const host = hostOf(typed);
  switch (problem) {
    case "address":
      return "Type the address you open Ember at, such as chat.example.com.";
    case "unreachable":
      return `Couldn't reach ${host}. Check the address, and that you're online.`;
    case "not-ember":
      return `${host} isn't an Ember site. Check the address you open Ember at in your browser.`;
  }
}

/** The host in `typed`, as the app reads it, or what was typed. */
function hostOf(typed: string): string {
  const text = typed.trim();
  return URL.parse(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`)?.host ?? text;
}
