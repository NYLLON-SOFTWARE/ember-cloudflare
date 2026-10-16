// The shape of one entry in the ember-rust feature inventory (features.ts).

/** Where a feature comes from: inherited from Campfire, added by Ember, or specific to this port. */
export type Origin = "campfire" | "ember" | "cloudflare";

/**
 * How far this repository has ported a feature.
 * - ported: every behavior listed is implemented and tested here.
 * - partial: some behaviors are; `notes` says what's missing.
 * - todo: not started.
 * - n/a: won't be ported, being tied to ember-rust's platform (Rails compatibility, self-hosting) or left out on
 *   purpose; `notes` says why.
 */
export type Status = "ported" | "partial" | "todo" | "n/a";

/** Areas in checklist order. A feature's id starts with its area, e.g. `messages.edit`. */
export const AREAS = {
  auth: "Sign-in and sessions",
  accounts: "Workspace administration",
  users: "People and profiles",
  rooms: "Rooms",
  dms: "Direct messages",
  sidebar: "Sidebar and navigation",
  messages: "Messages",
  boosts: "Reactions",
  mentions: "Mentions",
  attachments: "Attachments",
  unfurl: "Link previews",
  search: "Search",
  realtime: "Presence, typing and live updates",
  notifications: "Notifications",
  bots: "Bots and webhooks",
  composer: "Composer",
  ui: "Workspace interface",
  platform: "Platform",
} as const;

export type Area = keyof typeof AREAS;

export interface FeatureSpec {
  /** `<area>.<name>`, lowercase with hyphens. Tests refer to features by this id. */
  id: `${Area}.${string}`;
  title: string;
  origin: Origin;
  status: Status;
  /** What ember-rust does, written as checks a test can make. */
  behaviors: readonly string[];
  /**
   * Where ember-rust implements it, relative to its repository root. Paths under `reference/`
   * are in the pinned Campfire submodule.
   */
  sources: readonly string[];
  /** Where ember-rust or Campfire tests it, as paths like `sources`. Worth mirroring when porting. */
  upstreamTests?: readonly string[];
  /** What's missing (partial), why it won't be ported (n/a), or how this port differs. */
  notes?: string;
}
