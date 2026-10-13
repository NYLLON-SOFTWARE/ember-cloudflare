import { features } from "./features";
import type { FeatureSpec } from "./spec";

export { AREAS, type Area, type FeatureSpec, type Origin, type Status } from "./spec";
export { features };

export type FeatureId = (typeof features)[number]["id"];

const byId = new Map<string, FeatureSpec>(features.map((f) => [f.id, f]));

/**
 * Names a test block after the ember-rust feature it covers:
 * `describe(feature("messages.edit"), () => { ... })`. The parity checklist (PARITY.md)
 * finds these calls to show where each ported feature is tested.
 */
export function feature(id: FeatureId): string {
  const spec = byId.get(id);
  if (!spec) throw new Error(`Unknown feature "${id}". Add it to packages/parity/src/features.ts first.`);
  return `[${id}] ${spec.title}`;
}
