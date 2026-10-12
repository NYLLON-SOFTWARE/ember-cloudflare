import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import * as lucide from "./lucide";

// The same icons in ember-rust's crates/assets/overrides/lucide/catalog.json (lucide-static 1.53.0).
const catalog: Record<keyof typeof lucide, string> = {
  Check: '<path d="M20 6 9 17l-5-5"/>',
  Ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  FaceSlightlySmilingPlus:
    '<path d="M13.267 2.08a10 10 0 108.653 8.653"/><path d="M15 10V9"/><path d="M16 5h6"/><path d="M16.472 15a6 6 0 01-8.943 0"/><path d="M19 2v6"/><path d="M9 10V9"/>',
  Monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  Moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  Pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  Sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
};

function catalogSvg(shapes: string): Element {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
  return new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
}

function drawing(svg: Element) {
  const stroke = ["viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"].map((name) => svg.getAttribute(name));
  const shapes = [...svg.children].map((shape) => [shape.tagName, ...[...shape.attributes].map(({ name, value }) => `${name}=${value}`).sort()].join(" "));
  return { stroke, shapes: shapes.sort() };
}

describe("Lucide icons", () => {
  it.each(Object.entries(catalog))("draws %s exactly as ember-rust's catalog does", (name, shapes) => {
    const Icon = lucide[name as keyof typeof lucide] as ComponentType;
    const { container } = render(<Icon />);
    expect(drawing(container.querySelector("svg")!)).toEqual(drawing(catalogSvg(shapes)));
  });
});

describe("icon imports", () => {
  const sources = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/components/icons/**"], { query: "?raw", import: "default", eager: true });
  // The package or any of its subpaths, in either quote style, so dynamic imports and re-exports count too.
  const lucideReact = /["']lucide-react(\/[^"']*)?["']/;

  it.each([
    `import { Trash2 } from "lucide-react";`,
    `import { Trash2 } from 'lucide-react';`,
    `const icons = await import("lucide-react");`,
    `export { DynamicIcon } from "lucide-react/dynamic";`,
  ])("treat %s as importing lucide-react", (code) => {
    expect(code).toMatch(lucideReact);
  });

  it("take every icon from ember-rust's sets in this folder, never straight from lucide-react", () => {
    const strays = Object.entries(sources)
      .filter(([, code]) => lucideReact.test(code))
      .map(([file]) => file);
    expect(strays).toEqual([]);
  });
});
