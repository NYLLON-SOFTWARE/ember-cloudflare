import { version } from "../package.json";
import type { Env } from "./env";

/** The version this Ember was released as, apps/worker/package.json's, such as "0.1.0". */
export const VERSION = version;

/** A release, named: its version without a trailing ".0". */
export const releaseNameOf = (version: string) => version.replace(/\.0$/, "");

/** A setting's value, unless it's blank, which counts as unset. */
const present = (value: string | undefined) => (value?.trim() ? value : undefined);

/** This deployment's version: APP_VERSION, else GIT_REVISION, else the release. */
export const versionOf = (env: Env) => present(env.APP_VERSION) ?? present(env.GIT_REVISION) ?? releaseNameOf(VERSION);
