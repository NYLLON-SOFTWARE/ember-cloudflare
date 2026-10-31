import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./update-ember.ts", import.meta.url));
const WORKFLOW = ".github/workflows/update-ember.yml";

/**
 * Stands in for the GitHub CLI: it notes each call in $GH_LOG/calls and what it read in
 * $GH_LOG/<command>-body, answers `pr create` with a pull request's address unless
 * $GH_NO_PULL_REQUESTS has it refused as a new repository's settings do, `issue create` with an
 * issue's, and the listings with $GH_PULLS and $GH_ISSUES.
 */
const GH = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG/calls"
case "$1 $2" in
  "pr create")
    cat > "$GH_LOG/pr-body"
    if [ -n "$GH_NO_PULL_REQUESTS" ]; then
      echo "pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)" >&2
      exit 1
    fi
    echo "https://github.com/me/chat/pull/7" ;;
  "issue create") cat > "$GH_LOG/issue-body"; echo "https://github.com/me/chat/issues/8" ;;
  "pr list") echo "\${GH_PULLS:-[]}" ;;
  "issue list") echo "\${GH_ISSUES:-[]}" ;;
esac
`;

let dir: string;
/** git's settings for these repositories alone, whatever the machine's say. */
let gitEnv: Record<string, string>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "update-ember-test-"));
  writeFileSync(path.join(dir, "gitconfig"), "[init]\n\tdefaultBranch = main\n");
  gitEnv = {
    GIT_CONFIG_GLOBAL: path.join(dir, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs git in `repo`, with any commit it makes dated `date`, so a copy's history lines up with Ember's. */
function git(repo: string, args: string[], date = "2026-10-01T12:00:00Z"): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, ...gitEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Writes `files` into `repo`, deleting those given null, and commits them on `date`. */
function commit(repo: string, date: string, files: Record<string, string | null>, message = "A change"): string {
  for (const [file, content] of Object.entries(files)) {
    const at = path.join(repo, file);
    if (content === null) {
      rmSync(at);
    } else {
      mkdirSync(path.dirname(at), { recursive: true });
      writeFileSync(at, content);
    }
  }
  git(repo, ["add", "--all"]);
  git(repo, ["commit", "--quiet", "--message", message], date);
  return git(repo, ["rev-parse", "HEAD"]);
}

const app = (second: string) => `one\n${second}\nthree\nfour\nfive\nsix\nseven\n`;
const wrangler = (name: string, bucket: string, date = "2026-09-01") =>
  `{\n  // The Worker.\n  "name": "${name}",\n  "main": "src/index.ts",\n  "compatibility_date": "${date}",\n  "assets": { "directory": "dist" },\n  // Its files.\n  "r2_buckets": [{ "binding": "FILES", "bucket_name": "${bucket}" }],\n}\n`;

/**
 * Ember's repository: v0.1.0 on October 1st, a change to main on the 5th, and v0.2.0 on the 10th,
 * which changes that line again, and its Worker's settings, and the workflow that makes updates.
 */
function ember(): string {
  const repo = path.join(dir, "ember");
  mkdirSync(repo);
  git(repo, ["init", "--quiet"]);
  commit(repo, "2026-10-01T12:00:00Z", {
    "wrangler.jsonc": wrangler("ember", "ember"),
    "src/app.ts": app("two"),
    "apps/worker/package.json": '{ "version": "0.1.0" }\n',
    [WORKFLOW]: "on: schedule\n",
    ".github/workflows/ci.yml": "on: push\n",
  });
  git(repo, ["tag", "v0.1.0"]);
  commit(repo, "2026-10-05T12:00:00Z", { "src/app.ts": app("TWO") });
  // What the copy below is made from.
  git(repo, ["branch", "copied"]);
  commit(repo, "2026-10-10T12:00:00Z", {
    "src/app.ts": app("Two!"),
    "src/new.ts": "export {};\n",
    "wrangler.jsonc": wrangler("ember", "ember", "2026-10-10"),
    "apps/worker/package.json": '{ "version": "0.2.0" }\n',
    [WORKFLOW]: "on: schedule # weekly\n",
  });
  git(repo, ["tag", "v0.2.0"]);
  return repo;
}

/** Ember's next release, v0.3.0, on the 20th, which changes the line once more. */
function releaseNext(repo: string): void {
  commit(repo, "2026-10-20T12:00:00Z", { "src/app.ts": app("2"), "apps/worker/package.json": '{ "version": "0.3.0" }\n' });
  git(repo, ["tag", "v0.3.0"]);
}

/**
 * A copy as Deploy to Cloudflare makes one: a new repository whose one commit, on October 6th, holds
 * Ember's main of the 5th, with the Worker and bucket named as the deployer named them.
 */
function deployedCopy(ember: string, settings = wrangler("my-chat", "my-files")): string {
  const copy = path.join(dir, "copy");
  mkdirSync(copy);
  git(copy, ["init", "--quiet"]);
  const made = "copied";
  const files = Object.fromEntries(git(ember, ["ls-tree", "-r", "--name-only", made]).split("\n").map((file) => [file, git(ember, ["show", `${made}:${file}`]) + "\n"]));
  commit(copy, "2026-10-06T09:00:00Z", { ...files, "wrangler.jsonc": settings }, "Initial commit");
  return copy;
}

/** Runs the script in `repo` with `args`, fetching Ember from `ember`. */
function update(repo: string, ember: string, args: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, ...gitEnv, EMBER_REPOSITORY: ember, ...env } });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const show = (repo: string, revision: string, file: string) => git(repo, ["show", `${revision}:${file}`]);

describe("updating a copy made with Deploy to Cloudflare", () => {
  it("brings Ember's newest release onto a branch, keeping the copy's own changes", () => {
    const copy = deployedCopy(ember());
    const { status, output } = update(copy, path.join(dir, "ember"));
    expect(status, output).toBe(0);
    expect(output).toContain("update-ember/v0.2.0 brings this copy up to Ember v0.2.0");
    const branch = "update-ember/v0.2.0";
    expect(git(copy, ["rev-parse", `${branch}~1`])).toBe(git(copy, ["rev-parse", "main"]));
    expect(show(copy, branch, "wrangler.jsonc")).toBe(wrangler("my-chat", "my-files", "2026-10-10").trim());
    expect(show(copy, branch, "src/new.ts")).toBe("export {};");
    // Without --publish, whoever runs it pushes it, so the workflows come too.
    expect(show(copy, branch, WORKFLOW)).toBe("on: schedule # weekly");
    expect(git(copy, ["log", "-1", "--format=%B", branch])).toMatch(/^Update Ember to v0\.2\.0\n[\s\S]*\nEmber-Release: v0\.2\.0$/);
  });

  it("measures the copy's changes from the commit it was made from, not the release before", () => {
    const copy = deployedCopy(ember());
    expect(update(copy, path.join(dir, "ember")).output).toContain("from Ember's commit");
    // From v0.1.0, the copy's line would look changed on both sides, and conflict.
    expect(show(copy, "update-ember/v0.2.0", "src/app.ts")).toBe(app("Two!").trim());
  });

  it("finds nothing to do once the update is merged", () => {
    const repo = ember();
    const copy = deployedCopy(repo);
    update(copy, repo);
    git(copy, ["merge", "--quiet", "--ff-only", "update-ember/v0.2.0"]);
    const { status, output } = update(copy, repo);
    expect(status, output).toBe(0);
    expect(output).toContain("This copy has everything in Ember's newest release, v0.2.0.");
  });

  it("measures the next update from the release the last one brought, even squashed under its pull request's title", () => {
    const repo = ember();
    const copy = deployedCopy(repo);
    update(copy, repo);
    git(copy, ["checkout", "--quiet", "update-ember/v0.2.0", "--", "."]);
    git(copy, ["commit", "--quiet", "--message", "Update Ember to v0.2.0 (#3)"], "2026-10-12T12:00:00Z");
    releaseNext(repo);
    const { status, output } = update(copy, repo);
    expect(status, output).toBe(0);
    expect(output).toContain("update-ember/v0.3.0 brings this copy up to Ember v0.3.0 from v0.2.0.");
    expect(show(copy, "update-ember/v0.3.0", "src/app.ts")).toBe(app("2").trim());
  });

  it("leaves conflict markers where one of Ember's changes meets one of the copy's", () => {
    const repo = ember();
    const copy = deployedCopy(repo);
    commit(copy, "2026-10-07T12:00:00Z", { "src/app.ts": app("our two") });
    const { status, output } = update(copy, repo);
    expect(status, output).toBe(0);
    expect(output).toContain("First fix the conflict markers in src/app.ts on it and commit.");
    expect(show(copy, "update-ember/v0.2.0", "src/app.ts")).toMatch(/<<<<<<< [\s\S]*our two[\s\S]*=======[\s\S]*Two![\s\S]*>>>>>>> /);
  });

  it("keeps the copy's names for its Worker and bucket where Ember changes the lines beside them", () => {
    const repo = ember();
    const commented = wrangler("ember", "ember", "2026-10-10").replace("// The Worker.", "// The Worker, named.").replace("// Its files.", "// Its files, named.");
    commit(repo, "2026-10-11T12:00:00Z", { "wrangler.jsonc": commented, "apps/worker/package.json": '{ "version": "0.2.1" }\n' });
    git(repo, ["tag", "v0.2.1"]);
    const copy = deployedCopy(repo);
    const { status, output } = update(copy, repo);
    expect(status, output).toBe(0);
    expect(output).not.toContain("conflict markers");
    expect(show(copy, "update-ember/v0.2.1", "wrangler.jsonc")).toBe(wrangler("my-chat", "my-files", "2026-10-10").replace("// The Worker.", "// The Worker, named.").replace("// Its files.", "// Its files, named.").trim());
  });

  it("takes Ember's settings with the copy's names however the copy laid its settings out", () => {
    const repo = ember();
    const settings = { name: "my-chat", main: "src/index.ts", compatibility_date: "2026-09-01", assets: { directory: "dist" }, r2_buckets: [{ binding: "FILES", bucket_name: "my-files" }] };
    const rewritten = `${JSON.stringify(settings, null, 2)}\n`;
    const copy = deployedCopy(repo, rewritten);
    const { status, output } = update(copy, repo);
    expect(status, output).toBe(0);
    expect(show(copy, "update-ember/v0.2.0", "wrangler.jsonc")).toBe(wrangler("my-chat", "my-files", "2026-10-10").trim());
  });

  it("merges settings the copy changed beyond its names", () => {
    const repo = ember();
    const copy = deployedCopy(repo, wrangler("my-chat", "my-files").replace("src/index.ts", "src/ours.ts"));
    const { status, output } = update(copy, repo);
    expect(status, output).toBe(0);
    expect(output).toContain("First fix the conflict markers in wrangler.jsonc on it and commit.");
    expect(show(copy, "update-ember/v0.2.0", "wrangler.jsonc")).toMatch(/<<<<<<< [\s\S]*src\/ours\.ts[\s\S]*=======[\s\S]*2026-10-10[\s\S]*>>>>>>> /);
  });

  it("waits for Ember's first release", () => {
    const repo = ember();
    git(repo, ["tag", "--delete", "v0.1.0", "v0.2.0"]);
    const { status, output } = update(deployedCopy(repo), repo);
    expect(status, output).toBe(0);
    expect(output).toContain("Ember has no releases yet.");
  });
});

describe("updating a clone of Ember's repository", () => {
  it("merges from where the clone and Ember part", () => {
    const repo = ember();
    const clone = path.join(dir, "clone");
    git(dir, ["clone", "--quiet", "--branch", "v0.1.0", repo, clone]);
    git(clone, ["switch", "--quiet", "--create", "main"]);
    commit(clone, "2026-10-02T12:00:00Z", { "wrangler.jsonc": wrangler("our-ember", "our-files") });
    const { status, output } = update(clone, repo);
    expect(status, output).toBe(0);
    expect(output).toContain("from v0.1.0");
    expect(show(clone, "update-ember/v0.2.0", "wrangler.jsonc")).toBe(wrangler("our-ember", "our-files", "2026-10-10").trim());
    expect(show(clone, "update-ember/v0.2.0", "src/app.ts")).toBe(app("Two!").trim());
  });
});

describe("publishing an update, as the Update Ember workflow does", () => {
  /** The copy with its repository on GitHub, a bare one here, and the GitHub CLI's stand-in on its PATH. */
  function published() {
    const repo = ember();
    const copy = deployedCopy(repo);
    const origin = path.join(dir, "origin.git");
    git(dir, ["init", "--quiet", "--bare", origin]);
    git(copy, ["remote", "add", "origin", origin]);
    git(copy, ["push", "--quiet", "origin", "main"]);
    const bin = path.join(dir, "bin");
    const log = path.join(dir, "gh");
    mkdirSync(bin);
    mkdirSync(log);
    writeFileSync(path.join(bin, "gh"), GH);
    chmodSync(path.join(bin, "gh"), 0o755);
    const env = { PATH: `${bin}:${process.env.PATH}`, GH_LOG: log, GITHUB_REPOSITORY: "me/chat" };
    const calls = () => readFileSync(path.join(log, "calls"), "utf8").trim().split("\n");
    const body = (command: string) => readFileSync(path.join(log, `${command}-body`), "utf8");
    return { repo, copy, origin, env, calls, body };
  }

  it("pushes the branch, keeping the copy's workflows, and opens a pull request", () => {
    const { repo, copy, origin, env, calls, body } = published();
    const { status, output } = update(copy, repo, ["--publish"], env);
    expect(status, output).toBe(0);
    expect(output).toContain("Opened https://github.com/me/chat/pull/7, which brings this copy up to Ember v0.2.0.");
    expect(show(origin, "update-ember/v0.2.0", "src/new.ts")).toBe("export {};");
    // The workflow's token can't push a change to a workflow.
    expect(show(origin, "update-ember/v0.2.0", WORKFLOW)).toBe("on: schedule");
    expect(calls()).toContain("pr create --base main --head update-ember/v0.2.0 --title Update Ember to v0.2.0 --body-file -");
    expect(body("pr")).toContain("This brings your copy of Ember up to [v0.2.0](https://github.com/NYLLON-SOFTWARE/ember-cloudflare/releases/tag/v0.2.0)");
    expect(body("pr")).toContain(`copy [Ember's](https://github.com/NYLLON-SOFTWARE/ember-cloudflare/blob/v0.2.0/${WORKFLOW}) over \`${WORKFLOW}\``);
  });

  it("opens a draft when the update needs a hand", () => {
    const { repo, copy, env, calls, body } = published();
    commit(copy, "2026-10-07T12:00:00Z", { "src/app.ts": app("our two") });
    git(copy, ["push", "--quiet", "origin", "main"]);
    expect(update(copy, repo, ["--publish"], env).status).toBe(0);
    expect(calls()).toContain("pr create --base main --head update-ember/v0.2.0 --title Update Ember to v0.2.0 --body-file - --draft");
    expect(body("pr")).toContain("- `src/app.ts`");
  });

  it("opens an issue linking to the pull request when GitHub won't let it open one", () => {
    const { repo, copy, env, calls, body } = published();
    const { status, output } = update(copy, repo, ["--publish"], { ...env, GH_NO_PULL_REQUESTS: "1" });
    expect(status, output).toBe(0);
    expect(output).toContain("so https://github.com/me/chat/issues/8 links to the one that brings this copy up to Ember v0.2.0.");
    expect(calls()).toContain("issue create --title Update Ember to v0.2.0 --body-file -");
    expect(body("issue")).toContain("https://github.com/me/chat/compare/main...update-ember/v0.2.0?expand=1&title=Update%20Ember%20to%20v0.2.0&body=This%20brings");
    expect(body("issue")).toContain("Allow GitHub Actions to create and approve pull requests");
  });

  it("makes each update once", () => {
    const { repo, copy, env, calls } = published();
    update(copy, repo, ["--publish"], env);
    const { status, output } = update(copy, repo, ["--publish"], env);
    expect(status, output).toBe(0);
    expect(output).toContain("update-ember/v0.2.0 is waiting already");
    expect(calls().filter((call) => call.startsWith("pr create"))).toHaveLength(1);
  });

  it("closes the pull requests and issues of the updates it replaces", () => {
    const { repo, copy, env, calls } = published();
    const pulls = JSON.stringify([{ number: 4, headRefName: "update-ember/v0.1.5" }, { number: 5, headRefName: "fix-typo" }]);
    const issues = JSON.stringify([{ number: 6, title: "Update Ember to v0.1.5" }, { number: 9, title: "Something else" }]);
    expect(update(copy, repo, ["--publish"], { ...env, GH_PULLS: pulls, GH_ISSUES: issues }).status).toBe(0);
    const reason = "Ember v0.2.0 is out, so https://github.com/me/chat/pull/7 brings this copy up to it instead.";
    expect(calls()).toContain(`pr close 4 --delete-branch --comment ${reason}`);
    expect(calls()).toContain(`issue close 6 --comment ${reason}`);
    expect(calls().filter((call) => call.includes("close"))).toHaveLength(2);
  });

  it("says Update Ember's workflow has a new version until the copy has it", () => {
    const { repo, copy, env, body } = published();
    update(copy, repo, ["--publish"], env);
    git(copy, ["pull", "--quiet", "--ff-only", "origin", "update-ember/v0.2.0"]);
    releaseNext(repo);
    expect(update(copy, repo, ["--publish"], env).status).toBe(0);
    expect(body("pr")).toContain(`/blob/v0.3.0/${WORKFLOW}) over \`${WORKFLOW}\``);
  });

  it("closes what's left once the copy has the newest release", () => {
    const { repo, copy, env, calls } = published();
    update(copy, repo, ["--publish"], env);
    git(copy, ["pull", "--quiet", "--ff-only", "origin", "update-ember/v0.2.0"]);
    const issues = JSON.stringify([{ number: 8, title: "Update Ember to v0.2.0" }]);
    expect(update(copy, repo, ["--publish"], { ...env, GH_ISSUES: issues }).status).toBe(0);
    expect(calls()).toContain("issue close 8 --comment This copy has Ember's newest release now.");
  });
});
