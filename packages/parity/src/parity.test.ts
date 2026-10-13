import path from "node:path";
import { describe, expect, it } from "vitest";
import { areaOf, renderChecklist } from "./checklist";
import { features as inventory } from "./index";
import { findTestReferences } from "./scan";
import { AREAS, type FeatureSpec } from "./spec";

// Widened from the literal types, so checks read the same whatever the inventory holds.
const features: readonly FeatureSpec[] = inventory;
const root = path.resolve(import.meta.dirname, "../../..");
const references = findTestReferences(root);
const ids = new Set<string>(features.map((f) => f.id));
const isPorted = (status: string) => status === "ported" || status === "partial";

describe("the feature inventory", () => {
  it("has unique ids that start with a known area", () => {
    const duplicates = features.map((f) => f.id).filter((id, index, all) => all.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
    expect(features.filter((f) => !(areaOf(f) in AREAS) || !/^[a-z]+\.[a-z0-9-]+$/.test(f.id)).map((f) => f.id)).toEqual([]);
  });

  it("says what each feature does and where ember-rust does it", () => {
    expect(features.filter((f) => f.behaviors.length === 0).map((f) => f.id)).toEqual([]);
    expect(features.filter((f) => f.origin !== "cloudflare" && f.sources.length === 0).map((f) => f.id)).toEqual([]);
  });

  it("explains every partial and not-applicable feature", () => {
    expect(features.filter((f) => (f.status === "partial" || f.status === "n/a") && !f.notes).map((f) => f.id)).toEqual([]);
  });
});

describe("the test suites", () => {
  it("name only features in the inventory", () => {
    const unknown = [...references].filter(([id]) => !ids.has(id)).map(([id, refs]) => `${id} (${refs[0]!.file}:${refs[0]!.line})`);
    expect(unknown).toEqual([]);
  });

  it("test every ported and partial feature", () => {
    expect(features.filter((f) => isPorted(f.status) && !references.has(f.id)).map((f) => f.id)).toEqual([]);
  });

  it("only test features marked ported or partial", () => {
    expect(features.filter((f) => !isPorted(f.status) && references.has(f.id)).map((f) => f.id)).toEqual([]);
  });
});

// Regenerate with `pnpm parity` after changing the inventory or the tests that name features.
it("keeps PARITY.md up to date", async () => {
  await expect(renderChecklist(features, references)).toMatchFileSnapshot(path.join(root, "PARITY.md"));
});
