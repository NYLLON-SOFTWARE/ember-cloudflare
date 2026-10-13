import { describe, expect, it } from "vitest";
import { featureCalls } from "./scan";

describe("featureCalls", () => {
  it("finds the feature each suite names, with its line, in TypeScript and TSX", () => {
    const source = ['describe(feature("messages.edit"), () => {', "  render(<MessageItem />);", "});", "test.describe(feature('ui.scroll'), () => {});"].join("\n");
    expect(featureCalls(source, "message-item.test.tsx")).toEqual([
      { id: "messages.edit", line: 1 },
      { id: "ui.scroll", line: 4 },
    ]);
  });

  it("ignores suites that are commented out, and the name in strings", () => {
    const source = [
      '// describe(feature("messages.edit"), () => {});',
      "/*",
      'describe(feature("messages.delete"), () => {});',
      "*/",
      "const note = 'feature(\"boosts.add\")';",
      "describe(feature(`ui.scroll`), () => {});",
    ].join("\n");
    expect(featureCalls(source, "history.spec.ts")).toEqual([{ id: "ui.scroll", line: 6 }]);
  });
});
