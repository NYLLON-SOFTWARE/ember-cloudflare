import type { ReleaseCheck } from "@ember/protocol";

/** A release or a beta of Ember as the Worker names it, with its notes and whether it's newer than this one. */
export type NamedRelease = NonNullable<ReleaseCheck["newest"]>;

/**
 * What Update Ember would bring this Ember now, which the rail's Admin marks: the newest release once it's
 * newer, or for a beta, the beta after it, as a copy on a beta is brought the betas after it until its
 * release is out (docs/self-hosting.md#betas).
 */
export function updateOf({ beta, newest, newestBeta }: ReleaseCheck): NamedRelease | null {
  if (newest?.newer) return newest;
  return beta && newestBeta?.newer ? newestBeta : null;
}

/**
 * The beta this Ember is offered to try, which it takes only if asked: the newest beta once it's newer,
 * beside any release to update to, so that a new beta isn't missed, unless it's the update itself, as
 * for a beta no release has passed.
 */
export function betaToTryOf(check: ReleaseCheck): NamedRelease | null {
  const { newestBeta } = check;
  return newestBeta?.newer && updateOf(check)?.version !== newestBeta.version ? newestBeta : null;
}
