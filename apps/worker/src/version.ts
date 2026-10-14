import { version as packageVersion } from "../package.json";
import type { Env } from "./env";

/** The release, named as ember-rust names its own: the package's version without a trailing ".0". */
const RELEASE = packageVersion.replace(/\.0$/, "");

/** A setting's value, unless it's blank, which counts as unset (crates/ember/src/config.rs). */
const present = (value: string | undefined) => (value?.trim() ? value : undefined);

/** This deployment's version, as ember-rust's config.rs finds it: APP_VERSION, else GIT_REVISION, else the release. */
export const versionOf = (env: Env) => present(env.APP_VERSION) ?? present(env.GIT_REVISION) ?? RELEASE;
