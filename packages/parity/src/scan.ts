import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Where each layer's tests live, relative to the repository root. */
export const LAYERS = [
  { name: "Protocol", dir: "packages/protocol/src", files: /\.test\.ts$/ },
  { name: "Rich text", dir: "packages/richtext/src", files: /\.test\.ts$/ },
  { name: "Worker", dir: "apps/worker/test", files: /\.test\.ts$/ },
  { name: "Scripts", dir: "apps/worker/scripts", files: /\.test\.ts$/ },
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

/** Every `feature("id")` call in the test suites, grouped by feature id. */
export function findTestReferences(root: string): Map<string, TestReference[]> {
  const found = new Map<string, TestReference[]>();
  for (const layer of LAYERS) {
    const entries = readdirSync(path.join(root, layer.dir), { recursive: true, encoding: "utf8" });
    for (const entry of entries.sort()) {
      if (!layer.files.test(entry) || entry.includes("node_modules")) continue;
      const file = path.posix.join(layer.dir, entry.split(path.sep).join("/"));
      for (const { id, line } of featureCalls(readFileSync(path.join(root, file), "utf8"), file)) {
        found.set(id, [...(found.get(id) ?? []), { layer: layer.name, file, line }]);
      }
    }
  }
  return found;
}

/**
 * The `feature("id")` calls in one file, read from its syntax tree rather than its text, so a suite
 * that's commented out, or the name in a string, doesn't count as a test.
 */
export function featureCalls(source: string, fileName: string): { id: string; line: number }[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest);
  const calls: { id: string; line: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "feature") {
      const [id] = node.arguments;
      if (id && ts.isStringLiteralLike(id)) calls.push({ id: id.text, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}
