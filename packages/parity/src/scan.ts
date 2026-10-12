import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Where each layer's tests live, relative to the repository root. */
export const LAYERS = [
  { name: "Protocol", dir: "packages/protocol/src", files: /\.test\.ts$/ },
  { name: "Worker", dir: "apps/worker/test", files: /\.test\.ts$/ },
  { name: "Web", dir: "apps/web/src", files: /\.test\.tsx?$/ },
  { name: "E2E", dir: "e2e/tests", files: /\.spec\.ts$/ },
] as const;

export type Layer = (typeof LAYERS)[number]["name"];

export interface TestReference {
  layer: Layer;
  /** Repository-relative, with forward slashes. */
  file: string;
  line: number;
}

const FEATURE_CALL = /\bfeature\(\s*(["'`])([^"'`]*)\1\s*\)/g;

/** Every `feature("id")` call in the test suites, grouped by feature id. */
export function findTestReferences(root: string): Map<string, TestReference[]> {
  const found = new Map<string, TestReference[]>();
  for (const layer of LAYERS) {
    const entries = readdirSync(path.join(root, layer.dir), { recursive: true, encoding: "utf8" });
    for (const entry of entries.sort()) {
      if (!layer.files.test(entry) || entry.includes("node_modules")) continue;
      const file = path.posix.join(layer.dir, entry.split(path.sep).join("/"));
      const source = readFileSync(path.join(root, file), "utf8");
      for (const match of source.matchAll(FEATURE_CALL)) {
        const id = match[2]!;
        const line = source.slice(0, match.index).split("\n").length;
        found.set(id, [...(found.get(id) ?? []), { layer: layer.name, file, line }]);
      }
    }
  }
  return found;
}
