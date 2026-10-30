import { version as packageVersion } from "../package.json";
import type { Env } from "./env";

/** The release, named: the package's version without a trailing ".0". */
const RELEASE = packageVersion.replace(/\.0$/, "");

/** A setting's value, unless it's blank, which counts as unset. */
const present = (value: string | undefined) => (value?.trim() ? value : undefined);

/** This deployment's version: APP_VERSION, else GIT_REVISION, else the release. */
export const versionOf = (env: Env) => present(env.APP_VERSION) ?? present(env.GIT_REVISION) ?? RELEASE;
