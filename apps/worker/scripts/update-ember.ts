// Brings a copy of Ember up to Ember's newest release. Deploy to Cloudflare copies Ember into a new
// repository without Ember's history, so the copy can't merge Ember's changes the usual way: this
// merges them itself, from the Ember commit the copy was made from, or the release its last update
// brought, so whatever the copy changed stays, such as the Worker's and bucket's names Deploy to
// Cloudflare wrote into wrangler.jsonc. The update is one commit on a branch named after the release,
// update-ember/v1.2.3, with conflict markers in any file where one of Ember's changes meets one of the
// copy's. A clone of Ember's repository shares its history, so it merges from where they part.
//
// The Update Ember workflow runs it every week with --publish, which pushes the branch and opens a
// pull request whose merge deploys the update (docs/self-hosting.md#updating). Without --publish, as
// for a copy on GitLab, run it in a clone of the copy, then push the branch it makes:
//
//   node apps/worker/scripts/update-ember.ts [--publish]

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

/** Ember's repository, where its releases are. */
const EMBER = "https://github.com/NYLLON-SOFTWARE/ember-cloudflare";
/** Where to fetch Ember from, which the tests point at a repository of their own. */
const EMBER_REPOSITORY = process.env.EMBER_REPOSITORY || `${EMBER}.git`;
/** Where Ember's main branch and release tags are fetched to, apart from the copy's own. */
const EMBER_MAIN = "refs/ember/main";
const EMBER_TAGS = "refs/ember/tags/";
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
/**
 * What names the release an update brought: the trailer in its commit's message, or the title of
 * its pull request, which a squash merge may keep alone.
 */
const RELEASE_NAMED = /^(?:Ember-Release: |Update Ember to )(v\d+\.\d+\.\d+)\b/gm;
const UPDATE_TITLE = /^Update Ember to v\d+\.\d+\.\d+$/;
/** A workflow's token can't change workflows, so a published update leaves the copy's as they are. */
const WORKFLOWS = ".github/workflows";
const UPDATE_WORKFLOW = `${WORKFLOWS}/update-ember.yml`;
/** The Worker's settings, where Deploy to Cloudflare names the deployer's Worker and bucket. */
const WRANGLER = "wrangler.jsonc";
/** Where in wrangler.jsonc those names are. */
const DEPLOYERS_NAME = /^(?:name|r2_buckets\.\d+\.bucket_name)$/;
/** What GitHub answers a workflow that may not open pull requests, as a new repository's may not. */
const PULL_REQUESTS_NOT_PERMITTED = /not permitted to create or approve pull requests/i;
/** The first git whose merge-tree takes --merge-base. */
const GIT_NEEDED = [2, 40, 0];

interface Release {
  tag: string;
  commit: string;
  version: number[];
}

interface Update {
  release: Release;
  /** The Ember commit the copy's changes are measured from, and how to name it. */
  base: { commit: string; name: string };
  /** The releases it brings, oldest first. */
  releases: Release[];
  commit: string;
  /** The files left with conflict markers. */
  conflicts: string[];
  /** What a published update leaves as the copy has it: Ember's changes to its workflows, and whether its Update Ember differs. */
  workflows: { changed: boolean; updateDiffers: boolean };
}

interface Result {
  status: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], input?: string, env: Record<string, string> = {}): Result {
  const result = spawnSync(command, args, { encoding: "utf8", input, env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** Runs `command` and answers its output, or throws with what it said if it fails. */
function check(command: string, args: string[], input?: string, env?: Record<string, string>): string {
  const result = run(command, args, input, env);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

const git = (args: string[], input?: string, env?: Record<string, string>) => check("git", args, input, env).trim();
/** Whether a git command whose exit status is its answer says yes. */
const gitSays = (args: string[]) => run("git", args).status === 0;
const isAncestor = (older: string, newer: string) => gitSays(["merge-base", "--is-ancestor", older, newer]);
const lastLine = (output: string) => output.trim().split("\n").at(-1) ?? "";

const compareVersions = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

function requireGit(): void {
  const version = git(["--version"]);
  const [major = 0, minor = 0] = /(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number) ?? [];
  if (compareVersions([major, minor, 0], GIT_NEEDED) < 0) {
    throw new Error(`Updating needs git ${GIT_NEEDED.slice(0, 2).join(".")} or newer, for merge-tree's --merge-base: this is ${version}.`);
  }
}

function fetchEmber(): void {
  git(["fetch", "--quiet", "--no-tags", "--force", EMBER_REPOSITORY, `+refs/heads/main:${EMBER_MAIN}`, `+refs/tags/v*:${EMBER_TAGS}v*`]);
}

/** Ember's releases, oldest first: its tags named for a version. */
function releases(): Release[] {
  const listing = git(["for-each-ref", "--format=%(refname:lstrip=3) %(objectname) %(*objectname)", EMBER_TAGS]);
  return listing
    .split("\n")
    .flatMap((line) => {
      // A lightweight tag's object is its commit; an annotated tag's commit is the one it points at.
      const [tag = "", object = "", tagged] = line.split(" ");
      const version = RELEASE_TAG.exec(tag)?.slice(1).map(Number);
      return version ? [{ tag, commit: tagged || object, version }] : [];
    })
    .sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * The commit of Ember's main that Deploy to Cloudflare copied: the last one before the copy's first
 * commit was made, since that commit's date is all that ties the copy to Ember's history.
 */
function madeFrom(): string | undefined {
  const roots = git(["rev-list", "--max-parents=0", "HEAD"]).split("\n");
  const dates = git(["show", "--no-patch", "--format=%ct %cI", ...roots]).split("\n").map((line) => line.split(" "));
  const [, created] = dates.sort(([a], [b]) => Number(a) - Number(b))[0]!;
  return git(["rev-list", "-1", "--first-parent", `--before=${created}`, EMBER_MAIN]) || undefined;
}

/** The releases the copy's updates brought, as their commits' messages name them. */
const releasesBrought = () => new Set([...git(["log", "--format=%B", "HEAD"]).matchAll(RELEASE_NAMED)].map((match) => match[1]!));

/**
 * The Ember commit the copy's changes are measured from. A clone of Ember's repository shares its
 * history, which says. A copy made with Deploy to Cloudflare doesn't, so it's the latest of the commit
 * it was made from and the releases its updates brought.
 */
function baseOf(newest: Release, all: Release[]): string {
  const shared = run("git", ["merge-base", "HEAD", newest.commit]);
  if (shared.status === 0) return shared.stdout.trim();
  const brought = releasesBrought();
  const candidates = [madeFrom(), ...all.filter((release) => brought.has(release.tag)).map((release) => release.commit)];
  const known = candidates.filter((commit) => commit !== undefined);
  if (known.length === 0) throw new Error("This copy's first commit is older than Ember's, so it can't be a copy of Ember.");
  return known.reduce((latest, commit) => (isAncestor(latest, commit) ? commit : latest));
}

/** A base's name for people: its release's tag, or the commit's short hash. */
function nameOf(commit: string, all: Release[]): string {
  return all.find((release) => release.commit === commit)?.tag ?? `Ember's commit ${git(["rev-parse", "--short", commit])}`;
}

/** Ember's changes from `base` to `release`, merged into the copy's as a tree, and the files left with conflict markers. */
function merge(base: string, release: Release): { tree: string; conflicts: string[] } {
  const result = run("git", ["merge-tree", "--write-tree", "-z", "--name-only", "--no-messages", `--merge-base=${base}`, "HEAD", release.commit]);
  // It answers 1 for a merge with conflicts, whose tree holds the markers, and more for one it couldn't make.
  if (result.status > 1) throw new Error(`git merge-tree failed: ${result.stderr.trim()}`);
  const [tree = "", ...conflicts] = result.stdout.split("\0").filter(Boolean);
  return { tree, conflicts };
}

/** `tree` as `edit` leaves it, edited in an index of its own. */
function edited(tree: string, edit: (env: Record<string, string>) => void): string {
  const scratch = mkdtempSync(path.join(tmpdir(), "update-ember-"));
  const env = { GIT_INDEX_FILE: path.join(scratch, "index") };
  try {
    git(["read-tree", tree], undefined, env);
    edit(env);
    return git(["write-tree"], undefined, env);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** `tree` with the copy's workflows in place of what the merge made of them. */
function withCopysWorkflows(tree: string): string {
  return edited(tree, (env) => {
    git(["rm", "-r", "--cached", "--force", "--quiet", "--ignore-unmatch", "--", WORKFLOWS], undefined, env);
    const workflows = check("git", ["ls-tree", "-r", "-z", "HEAD", "--", WORKFLOWS]);
    if (workflows) git(["update-index", "-z", "--index-info"], workflows, env);
  });
}

const withFile = (tree: string, file: string, content: string) =>
  edited(tree, (env) => git(["update-index", "--add", "--cacheinfo", `100644,${git(["hash-object", "-w", "--stdin"], content)},${file}`], undefined, env));

/** A file as `revision` has it, if it has it. */
function fileAt(revision: string, file: string): string | undefined {
  const result = run("git", ["show", `${revision}:${file}`]);
  return result.status === 0 ? result.stdout : undefined;
}

interface Token {
  text: string;
  start: number;
  kind: "string" | "punctuation" | "scalar" | "comment" | "space";
}

/** JSONC's tokens: JSON's, and the comments between them. */
function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  for (let at = 0; at < text.length; ) {
    const start = at;
    let kind: Token["kind"];
    if (text[at] === '"') {
      for (at++; at < text.length && text[at] !== '"'; at += text[at] === "\\" ? 2 : 1);
      at++;
      kind = "string";
    } else if (text.startsWith("//", at) || text.startsWith("/*", at)) {
      const end = text.startsWith("//", at) ? text.indexOf("\n", at) : text.indexOf("*/", at + 2) + 2;
      at = end > start ? end : text.length;
      kind = "comment";
    } else if ("{}[]:,".includes(text[at]!)) {
      at++;
      kind = "punctuation";
    } else {
      kind = /\s/.test(text[at]!) ? "space" : "scalar";
      const sameKind = kind === "space" ? /\s/ : /[^\s{}[\]:,"/]/;
      do at++;
      while (at < text.length && sameKind.test(text[at]!));
    }
    tokens.push({ text: text.slice(start, at), start, kind });
  }
  return tokens.filter((token) => token.kind !== "comment" && token.kind !== "space");
}

/** A JSONC file's data, without its comments or the commas it may have before a closing bracket. */
function dataOf(text: string): unknown {
  const tokens = tokensOf(text);
  const json = tokens.filter((token, at) => !(token.text === "," && "}]".includes(tokens[at + 1]?.text || "}")));
  return JSON.parse(json.map((token) => token.text).join(""));
}

/** Each string value in a JSONC file, with its path, such as `name` or `r2_buckets.0.bucket_name`. */
function stringsOf(text: string): { path: string; start: number; end: number; value: string }[] {
  const strings = [];
  const open: { kind: string; segment: string; key?: string; index: number; expectingKey: boolean }[] = [];
  const segmentHere = () => {
    const container = open.at(-1);
    return container?.kind === "[" ? String(container.index) : (container?.key ?? "");
  };
  for (const token of tokensOf(text)) {
    const container = open.at(-1);
    if (token.text === "{" || token.text === "[") {
      open.push({ kind: token.text, segment: segmentHere(), index: 0, expectingKey: token.text === "{" });
    } else if (token.text === "}" || token.text === "]") {
      open.pop();
    } else if (container && token.text === ":") {
      container.expectingKey = false;
    } else if (container && token.text === ",") {
      container.index++;
      container.expectingKey = container.kind === "{";
    } else if (token.kind === "string" && container?.expectingKey) {
      container.key = JSON.parse(token.text) as string;
    } else if (token.kind === "string") {
      const path = [...open.slice(1).map((outer) => outer.segment), segmentHere()].join(".");
      strings.push({ path, start: token.start, end: token.start + token.text.length, value: JSON.parse(token.text) as string });
    }
  }
  return strings;
}

/** The names Deploy to Cloudflare wrote into wrangler.jsonc, by where they are. */
const deployersNames = (text: string) => new Map(stringsOf(text).flatMap(({ path, value }) => (DEPLOYERS_NAME.test(path) ? [[path, value]] : [])));

/** `text` with the values at `names`' paths set to theirs. */
function withNames(text: string, names: Map<string, string>): string {
  const named = stringsOf(text).filter(({ path }) => names.has(path));
  return named.reduceRight((result, { path, start, end }) => result.slice(0, start) + JSON.stringify(names.get(path)) + result.slice(end), text);
}

/**
 * Ember's wrangler.jsonc at `release` with the copy's names for its Worker and bucket, when those are
 * all the copy changed there, however Deploy to Cloudflare laid the file out: the names sit beside
 * lines Ember changes, such as their comments, where a merge would leave conflict markers.
 */
function wranglerWithCopysNames(base: string, release: Release): string | undefined {
  const [ours, was, now] = ["HEAD", base, release.commit].map((revision) => fileAt(revision, WRANGLER));
  if (ours === undefined || was === undefined || now === undefined) return undefined;
  try {
    const onlyNamed = isDeepStrictEqual(dataOf(withNames(ours, deployersNames(was))), dataOf(was));
    return onlyNamed ? withNames(now, deployersNames(ours)) : undefined;
  } catch {
    // Not JSONC that this reads, so it's the merge's to make.
    return undefined;
  }
}

/** What a published update leaves of Ember's at `release`: whether it changed workflows since `base`, and its Update Ember from the copy's. */
function workflowsLeft(base: string, release: Release): Update["workflows"] {
  const changed = !gitSays(["diff", "--quiet", base, release.commit, "--", WORKFLOWS]);
  const blob = (revision: string) => run("git", ["rev-parse", "--verify", "--quiet", `${revision}:${UPDATE_WORKFLOW}`]).stdout.trim();
  return { changed, updateDiffers: blob("HEAD") !== blob(release.commit) };
}

/** The update's commit, whose message names its release for the next update to measure from. */
function commitOf(tree: string, release: Release, base: Update["base"]): string {
  const message = `Update Ember to ${release.tag}\n\nBrings this copy up to Ember ${release.tag} from ${base.name}: ${EMBER}/compare/${base.commit}...${release.tag}\n\nEmber-Release: ${release.tag}\n`;
  return git(["commit-tree", tree, "-p", "HEAD", "-F", "-"], message);
}

const branchOf = (release: Release) => `update-ember/${release.tag}`;
const titleOf = (release: Release) => `Update Ember to ${release.tag}`;
const releaseLink = (release: Release) => `[${release.tag}](${EMBER}/releases/tag/${release.tag})`;

/** What the update brings and what it needs, for its pull request or issue. */
function details(update: Update): string[] {
  const { release, base } = update;
  const lines = [
    `What's new: ${update.releases.map(releaseLink).join(", ")}, and [every change](${EMBER}/compare/${base.commit}...${release.tag}). ` +
      "Whatever your copy changed stays as it is, such as your Worker's and bucket's names, and Ember's tables bring themselves up to date as each opens after the deploy.",
  ];
  if (update.conflicts.length > 0) {
    lines.push(
      "",
      "**This needs a hand before it's merged.** Some of Ember's changes meet ones made in your copy, so these files have conflict markers " +
        "(`<<<<<<<`, `=======` and `>>>>>>>`) around both. Edit each on this branch to keep what both need:",
      "",
      ...update.conflicts.map((file) => `- \`${file}\``),
    );
  }
  if (update.workflows.updateDiffers) {
    lines.push(
      "",
      "GitHub doesn't let a workflow change workflows, so this leaves your copy's as they are. Ember's others run only in its own repository, " +
        `but the one that makes these updates has a new version: copy [Ember's](${EMBER}/blob/${release.tag}/${UPDATE_WORKFLOW}) over \`${UPDATE_WORKFLOW}\` to have it.`,
    );
  } else if (update.workflows.changed) {
    lines.push("", "GitHub doesn't let a workflow change workflows, so this leaves out Ember's changes to its own, which run only in Ember's repository.");
  }
  return lines;
}

function pullRequestBody(update: Update): string {
  const merging = update.conflicts.length > 0 ? "Once that's done, merging it" : "Merging it";
  const intro = `This brings your copy of Ember up to ${releaseLink(update.release)} from ${update.base.name}. ${merging} deploys the update, as every push to your main branch does.`;
  return [intro, "", ...details(update)].join("\n");
}

function issueBody(update: Update, openLink: string): string {
  return [
    `Ember ${releaseLink(update.release)} is out, and the branch \`${branchOf(update.release)}\` brings your copy up to it from ${update.base.name}. ` +
      `**[Open its pull request](${openLink})**, then merge it to deploy the update. This issue closes itself once your copy has it.`,
    "",
    "The Update Ember workflow can open the pull request itself once GitHub lets it: in your repository's **Settings**, under " +
      "**Actions** → **General** → **Workflow permissions**, tick **Allow GitHub Actions to create and approve pull requests**, and save.",
    "",
    ...details(update),
  ].join("\n");
}

/** GitHub's page for opening the update's pull request, with its title and description filled in. */
function openPullRequestLink(main: string, branch: string, title: string, body: string): string {
  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  const query = `expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return `${server}/${process.env.GITHUB_REPOSITORY}/compare/${main}...${branch}?${query}`;
}

/** What a gh listing finds, or nothing if it can't look, as when the repository has no issues. */
function listed<T>(args: string[]): T[] {
  const result = run("gh", args);
  return result.status === 0 ? (JSON.parse(result.stdout) as T[]) : [];
}

/**
 * Closes the pull requests and issues for updates the copy needs no more: all of them once it has
 * Ember's newest release, or those for older releases than the one `offered` at `where`.
 */
function closeStale(offered?: { update: Update; where: string }): void {
  const release = offered?.update.release;
  const reason = offered ? `Ember ${offered.update.release.tag} is out, so ${offered.where} brings this copy up to it instead.` : "This copy has Ember's newest release now.";
  for (const pull of listed<{ number: number; headRefName: string }>(["pr", "list", "--state", "open", "--limit", "100", "--json", "number,headRefName"])) {
    if (pull.headRefName.startsWith("update-ember/") && (!release || pull.headRefName !== branchOf(release))) {
      run("gh", ["pr", "close", String(pull.number), "--delete-branch", "--comment", reason]);
    }
  }
  const issues = listed<{ number: number; title: string }>(["issue", "list", "--state", "open", "--limit", "100", "--json", "number,title"]);
  for (const issue of issues) {
    if (UPDATE_TITLE.test(issue.title) && (!release || issue.title !== titleOf(release))) run("gh", ["issue", "close", String(issue.number), "--comment", reason]);
  }
}

/** Says what happened, in the log and, in a workflow, its run's summary. */
function report(message: string): void {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

/** Leaves the update on its branch, for whoever ran this to push. */
function makeBranch(update: Update): void {
  const branch = branchOf(update.release);
  git(["branch", "--force", branch, update.commit]);
  const conflicts = update.conflicts.length > 0 ? ` First fix the conflict markers in ${update.conflicts.join(", ")} on it and commit.` : "";
  report(
    `${branch} brings this copy up to Ember ${update.release.tag} from ${update.base.name}.${conflicts} ` +
      `Then push it (git push -u origin ${branch}) and merge it into your main branch to deploy it.`,
  );
}

/**
 * Pushes the update's branch and opens its pull request. A new repository doesn't let workflows open
 * pull requests, so then it opens an issue with a link that opens it in a click.
 */
function publish(update: Update): void {
  const branch = branchOf(update.release);
  if (gitSays(["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`])) {
    return report(`${branch} is waiting already: merge its pull request to update, or delete the branch to have it made again.`);
  }
  git(["push", "--quiet", "origin", `${update.commit}:refs/heads/${branch}`]);
  const main = git(["symbolic-ref", "--short", "HEAD"]);
  const title = titleOf(update.release);
  const body = pullRequestBody(update);
  const draft = update.conflicts.length > 0 ? ["--draft"] : [];
  const opened = run("gh", ["pr", "create", "--base", main, "--head", branch, "--title", title, "--body-file", "-", ...draft], body);
  if (opened.status === 0) {
    const where = lastLine(opened.stdout);
    closeStale({ update, where });
    return report(`Opened ${where}, which brings this copy up to Ember ${update.release.tag}.`);
  }
  if (!PULL_REQUESTS_NOT_PERMITTED.test(opened.stderr)) throw new Error(`gh pr create failed: ${opened.stderr.trim()}`);
  const link = openPullRequestLink(main, branch, title, body);
  const filed = run("gh", ["issue", "create", "--title", title, "--body-file", "-"], issueBody(update, link));
  if (filed.status !== 0) {
    report(`GitHub doesn't let this workflow open pull requests, so open ${branch}'s yourself: ${link}`);
    throw new Error(`gh issue create failed too: ${filed.stderr.trim()}`);
  }
  const where = lastLine(filed.stdout);
  closeStale({ update, where });
  report(`GitHub doesn't let this workflow open pull requests, so ${where} links to the one that brings this copy up to Ember ${update.release.tag}.`);
}

function update(args: string[]): void {
  const publishing = args.includes("--publish");
  requireGit();
  process.chdir(git(["rev-parse", "--show-toplevel"]));
  if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
    throw new Error("This clone is shallow, so it lacks the copy's first commit: run git fetch --unshallow, then this again.");
  }
  fetchEmber();
  const all = releases();
  const newest = all.at(-1);
  if (!newest) return report("Ember has no releases yet.");
  const base = baseOf(newest, all);
  if (isAncestor(newest.commit, base)) {
    if (publishing) closeStale();
    return report(`This copy has everything in Ember's newest release, ${newest.tag}.`);
  }
  const merged = merge(base, newest);
  const wrangler = wranglerWithCopysNames(base, newest);
  const named = wrangler === undefined ? merged.tree : withFile(merged.tree, WRANGLER, wrangler);
  // A workflow's token can't push a commit that changes workflows, so a published update keeps the copy's.
  const tree = publishing ? withCopysWorkflows(named) : named;
  const conflicts = merged.conflicts.filter((file) => !(wrangler !== undefined && file === WRANGLER) && !(publishing && file.startsWith(`${WORKFLOWS}/`)));
  const workflows = publishing ? workflowsLeft(base, newest) : { changed: false, updateDiffers: false };
  if (tree === git(["rev-parse", "HEAD^{tree}"])) {
    return report(`Ember ${newest.tag} changes nothing this copy has${workflows.changed ? " but Ember's own workflows" : ""}.`);
  }
  const from = { commit: base, name: nameOf(base, all) };
  const brought = all.filter((release) => compareVersions(release.version, newest.version) <= 0 && !isAncestor(release.commit, base));
  const result = { release: newest, base: from, releases: brought, commit: commitOf(tree, newest, from), conflicts, workflows };
  if (publishing) publish(result);
  else makeBranch(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    update(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
