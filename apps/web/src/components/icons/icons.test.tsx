import { feature } from "@ember/parity";
import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import * as iconoir from "./iconoir";
import * as lucide from "./lucide";
import catalogFile from "./lucide/catalog.json?raw";

function pascalCase(name: string) {
  return name.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}

// ember-rust's crates/assets/overrides/lucide/catalog.json (lucide-static 1.53.0), by lucide-react's
// name for each icon: `face-slightly-smiling-plus` is FaceSlightlySmilingPlus.
const catalog = new Map((JSON.parse(catalogFile) as { name: string; svg: string }[]).map(({ name, svg }) => [pascalCase(name), svg]));

// Iconoir's files in iconoir/, by the name iconoir.tsx gives each icon: `multi-bubble.svg` is MultiBubble.
const iconoirFiles = new Map(
  Object.entries(import.meta.glob<string>("./iconoir/*.svg", { query: "?raw", import: "default", eager: true })).map(([path, svg]) => {
    const name = path.slice("./iconoir/".length, -".svg".length);
    return [pascalCase(name), { name, svg }];
  }),
);

function parseSvg(svg: string): Element {
  return new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
}

function drawing(svg: Element) {
  const stroke = ["viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"].map((name) => svg.getAttribute(name));
  const shapes = [...svg.children].map((shape) => [shape.tagName, ...[...shape.attributes].map(({ name, value }) => `${name}=${value}`).sort()].join(" "));
  return { stroke, shapes: shapes.sort() };
}

describe(feature("ui.icons"), () => {
  describe("Lucide icons", () => {
    it.each(Object.keys(lucide))("draws %s exactly as ember-rust's catalog does", (name) => {
      const svg = catalog.get(name);
      expect(svg, `${name} isn't in the catalog: export Lucide's own name, not an alias`).toBeDefined();
      const Icon = lucide[name as keyof typeof lucide] as ComponentType;
      const { container } = render(<Icon />);
      expect(drawing(container.querySelector("svg")!)).toEqual(drawing(parseSvg(svg!)));
    });
  });

  describe("Iconoir icons", () => {
    it.each(Object.keys(iconoir))("draws %s exactly as Iconoir's file does, named for it", (name) => {
      const file = iconoirFiles.get(name);
      expect(file, `iconoir/ has no file for ${name}: copy it from the pinned release's icons/regular/`).toBeDefined();
      const Icon = iconoir[name as keyof typeof iconoir] as ComponentType;
      const { container } = render(<Icon />);
      const svg = container.querySelector("svg")!;
      expect(svg).toHaveClass(`iconoir-${file!.name}`);
      expect(drawing(svg)).toEqual(drawing(parseSvg(file!.svg)));
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
});
