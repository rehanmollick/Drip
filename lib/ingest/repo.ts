import { HttpError } from "@/lib/api/envelope";
import type { IngestData } from "@/lib/api/contract";
import { capText, normalizeText } from "./text";
import { devDetails, isAbortError, readCapped, remainingMs } from "./http";

/**
 * GitHub repo ingestion (spec §6.1 path 4). Uses the REST API — never a full
 * clone, never the whole repo in one context. Output: file tree summary +
 * README + key config files. `getRepoFile` is the on-demand hook the writer
 * uses later to pull a specific file when the plan reaches it.
 */

export const REPO_TREE_MAX_PATHS = 400;
export const REPO_FILE_MAX_CHARS = 6_000;
export const REPO_README_MAX_CHARS = 12_000;
export const REPO_TOTAL_MAX_CHARS = 60_000;
export const REPO_RAW_FILE_MAX_CHARS = 20_000;
/** Per-request cap and the whole-ingest budget (route maxDuration is 45s; stay under it). */
const FETCH_TIMEOUT_MS = 12_000;
export const REPO_TOTAL_BUDGET_MS = 40_000;
const TREE_JSON_MAX_BYTES = 8 * 1024 * 1024; // GitHub itself stops at ~7MB / 100k entries
/** Branch names may contain "/" (feat/x): how many extra path segments we try folding into the ref. */
const MAX_REF_SEGMENTS = 5;
const USER_AGENT = "drip/0.1 (+https://drip.app)";
const API = "https://api.github.com";

export type RepoRef = {
  owner: string;
  repo: string;
  ref: string | null;
  /** For /tree/a/b/c urls: ["a", "a/b", "a/b/c"] — branch names can contain "/", so we try longer refs on 404. */
  refCandidates: string[];
};

export type TreeEntry = { path: string; type: "blob" | "tree" | "commit" | string; size?: number };

export type TreeSummary = {
  files: string[];          // kept blob paths, sorted shallow-first, ≤ REPO_TREE_MAX_PATHS
  fileCount: number;        // count of kept files before capping
  totalCount: number;       // raw blob count from the API
  readmePath: string | null;
  keyFiles: string[];       // config files worth pulling (root first)
  truncated: boolean;
};

// ── url parsing ──────────────────────────────────────────────────────────────

/** github.com/{owner}/{repo}(.git)?(/tree/{ref}(/…)?)? → { owner, repo, ref } */
export function parseRepoUrl(input: string): RepoRef {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new HttpError(400, "bad_repo_url", "that doesn't look like a github repo link");
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") throw new HttpError(400, "bad_repo_url", "only github.com repos for now");
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new HttpError(400, "bad_repo_url", "link needs an owner and a repo, like github.com/vercel/next.js");
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new HttpError(400, "bad_repo_url", "that doesn't look like a github repo link");
  }
  let ref: string | null = null;
  const refCandidates: string[] = [];
  if ((parts[2] === "tree" || parts[2] === "blob" || parts[2] === "commits") && parts[3]) {
    const segs = parts.slice(3, 3 + MAX_REF_SEGMENTS).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    ref = segs[0];
    for (let i = 1; i <= segs.length; i++) refCandidates.push(segs.slice(0, i).join("/"));
  }
  return { owner, repo, ref, refCandidates };
}

// ── tree filtering ───────────────────────────────────────────────────────────

const SKIP_DIRS = [
  "node_modules", ".git", "vendor", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", "coverage",
  "__pycache__", ".venv", "venv", "target", ".cache", ".turbo", ".parcel-cache", "bower_components",
  ".idea", ".vscode", "Pods", "DerivedData", ".gradle", "storybook-static", ".yarn",
];
const SKIP_FILES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "Cargo.lock", "poetry.lock",
  "Pipfile.lock", "Gemfile.lock", "go.sum", "composer.lock", "flake.lock", "uv.lock", ".DS_Store", "Thumbs.db",
]);
const SKIP_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "avif", "bmp", "tiff", "psd", "ai", "sketch", "fig",
  "woff", "woff2", "ttf", "otf", "eot", "mp4", "mov", "webm", "mp3", "wav", "ogg", "flac", "pdf", "zip", "gz",
  "tar", "tgz", "bz2", "xz", "7z", "rar", "bin", "exe", "dll", "so", "dylib", "class", "jar", "war", "wasm",
  "pyc", "pyo", "o", "a", "lib", "obj", "map", "snap", "ipynb_checkpoints", "lockb", "db", "sqlite", "sqlite3",
]);
const KEY_FILE_NAMES = [
  "package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "tsconfig.json",
  "next.config.js", "next.config.mjs", "next.config.ts", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
  ".env.example", "Makefile", "setup.py", "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts", "composer.json",
  "vite.config.ts", "vite.config.js", "vercel.json", "fly.toml", "Procfile", "CLAUDE.md", "AGENTS.md",
];
const KEY_FILE_RANK = new Map(KEY_FILE_NAMES.map((n, i) => [n, i]));
const README_RE = /^readme(\.(md|mdx|markdown|rst|txt))?$/i;
const MAX_KEY_FILES = 10;

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}
function ext(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i === -1 ? "" : b.slice(i + 1).toLowerCase();
}
function depth(p: string): number {
  return p.split("/").length;
}

/** Should this blob path be shown in the tree at all? */
export function keepPath(path: string): boolean {
  const segs = path.split("/");
  const dirs = segs.slice(0, -1);
  if (dirs.some((d) => SKIP_DIRS.includes(d))) return false;
  const base = segs[segs.length - 1];
  if (SKIP_FILES.has(base)) return false;
  if (/\.min\.(js|css)$/i.test(base)) return false;
  if (SKIP_EXT.has(ext(base))) return false;
  return true;
}

/** Pure: raw git tree entries → filtered, shallow-first summary. */
export function summarizeTree(entries: TreeEntry[]): TreeSummary {
  const blobs = entries.filter((e) => e.type === "blob");
  const kept = blobs.map((e) => e.path).filter(keepPath);
  kept.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));

  const readmes = kept.filter((p) => README_RE.test(basename(p)));
  readmes.sort((a, b) => depth(a) - depth(b) || (ext(a) === "md" ? -1 : 1));
  const readmePath = readmes[0] ?? null;

  const keyFiles = kept
    .filter((p) => KEY_FILE_RANK.has(basename(p)))
    .sort((a, b) => depth(a) - depth(b) || (KEY_FILE_RANK.get(basename(a)) ?? 99) - (KEY_FILE_RANK.get(basename(b)) ?? 99))
    .slice(0, MAX_KEY_FILES);

  return {
    files: kept.slice(0, REPO_TREE_MAX_PATHS),
    fileCount: kept.length,
    totalCount: blobs.length,
    readmePath,
    keyFiles,
    truncated: kept.length > REPO_TREE_MAX_PATHS,
  };
}

// ── text assembly ────────────────────────────────────────────────────────────

export type RepoTextInput = {
  owner: string;
  repo: string;
  ref: string;
  description?: string | null;
  language?: string | null;
  tree: TreeSummary;
  readme: string | null;
  keyFiles: { path: string; content: string }[];
};

/** Pure: assemble the planner-facing sourceText, honoring per-file + total caps. */
export function buildRepoText(input: RepoTextInput): string {
  const { owner, repo, ref, tree } = input;
  const head = [`REPO ${owner}/${repo} (${ref})`];
  if (input.description) head.push(`DESCRIPTION: ${input.description.trim()}`);
  if (input.language) head.push(`PRIMARY LANGUAGE: ${input.language}`);

  const treeLines = tree.files.map((p) => `  ${p}`);
  if (tree.truncated) treeLines.push(`  … and ${tree.fileCount - tree.files.length} more files`);
  const treeBlock = `FILE TREE (${tree.fileCount} files):\n${treeLines.join("\n")}`;

  const readmeBlock = `README:\n${input.readme ? capText(normalizeText(input.readme), REPO_README_MAX_CHARS) : "(none)"}`;

  const parts = [head.join("\n"), treeBlock, readmeBlock];
  let used = parts.join("\n\n").length + "\n\nKEY FILES:\n".length;
  const keyBlocks: string[] = [];
  for (const f of input.keyFiles) {
    const body = capText(f.content.replace(/\r\n?/g, "\n").trimEnd(), REPO_FILE_MAX_CHARS);
    const block = `--- ${f.path} ---\n${body}`;
    if (used + block.length + 2 > REPO_TOTAL_MAX_CHARS) break;
    keyBlocks.push(block);
    used += block.length + 2;
  }
  parts.push(`KEY FILES:\n${keyBlocks.length ? keyBlocks.join("\n\n") : "(none)"}`);
  return capText(parts.join("\n\n"), REPO_TOTAL_MAX_CHARS);
}

// ── github i/o ───────────────────────────────────────────────────────────────

function ghHeaders(raw = false): Record<string, string> {
  const h: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: raw ? "text/plain, */*" : "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

type Budget = { deadline: number };
const newBudget = (): Budget => ({ deadline: Date.now() + REPO_TOTAL_BUDGET_MS });

/**
 * fetch + read under ONE abort signal that lives until the body is consumed
 * (the old version cleared its timer as soon as headers arrived, so a slow
 * multi-MB body was uncapped). `read` gets the response and the signal.
 */
async function timedFetch<T>(url: string, init: RequestInit, budget: Budget, read: (res: Response) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), remainingMs(budget.deadline, FETCH_TIMEOUT_MS));
  const timedOut = () => new HttpError(504, "github_timeout", "github took too long to answer");
  try {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      if (ctrl.signal.aborted || isAbortError(e)) throw timedOut();
      throw new HttpError(502, "github_unreachable", "couldn't reach github", devDetails(e));
    }
    try {
      return await read(res);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (ctrl.signal.aborted || isAbortError(e)) throw timedOut();
      throw new HttpError(502, "github_error", "github cut out mid-answer", devDetails(e));
    }
  } finally {
    clearTimeout(timer);
  }
}

function throwForStatus(res: Response, what: string): never {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const retryAfter = res.headers.get("retry-after");
  res.body?.cancel().catch(() => {});
  if (res.status === 429 || (res.status === 403 && (remaining === "0" || retryAfter !== null))) {
    throw new HttpError(429, "github_rate_limited", "github is rate-limiting; add GITHUB_TOKEN");
  }
  if (res.status === 404) throw new HttpError(404, "repo_not_found", `couldn't find that ${what} on github`);
  if (res.status === 401 || res.status === 403) throw new HttpError(403, "github_forbidden", `github won't let us read that ${what}`);
  throw new HttpError(502, "github_error", `github answered ${res.status} for that ${what}`);
}

async function ghJson<T>(path: string, what: string, budget: Budget): Promise<T> {
  return timedFetch(`${API}${path}`, { headers: ghHeaders() }, budget, async (res) => {
    if (!res.ok) throwForStatus(res, what);
    const raw = await readCapped(res, TREE_JSON_MAX_BYTES);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new HttpError(502, "github_error", `that ${what} is too big to read in one go`);
    }
  });
}

/** Raw file from raw.githubusercontent.com, capped (Range + streamed cap). Returns null on 404. */
async function fetchRaw(owner: string, repo: string, ref: string, path: string, maxChars: number, budget: Budget): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const maxBytes = maxChars * 4;
  return timedFetch(url, { headers: { ...ghHeaders(true), range: `bytes=0-${maxBytes - 1}` } }, budget, async (res) => {
    if (res.status === 404) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    if (!res.ok) throwForStatus(res, "file");
    const text = await readCapped(res, maxBytes);
    return capText(text, maxChars);
  });
}

/**
 * On-demand file read for the writer's `getFile(path)` tool. ≤ 20k chars.
 * Throws HttpError(404, "file_not_found") when the path doesn't exist at that ref.
 */
export async function getRepoFile(owner: string, repo: string, ref: string, path: string): Promise<string> {
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.split("/").includes("..")) throw new HttpError(400, "bad_path", "bad file path");
  const text = await fetchRaw(owner, repo, ref, clean, REPO_RAW_FILE_MAX_CHARS, newBudget());
  if (text === null) throw new HttpError(404, "file_not_found", `no ${clean} in ${owner}/${repo}@${ref}`);
  return text;
}

type RepoMeta = {
  default_branch: string;
  description: string | null;
  language: string | null;
  full_name: string;
  html_url: string;
  stargazers_count?: number;
  private?: boolean;
};
type TreeResponse = { sha: string; tree: TreeEntry[]; truncated: boolean };

/**
 * GITHUB_TOKEN raises rate limits, but it also lets this unauthenticated
 * endpoint read whatever the token can — including the owner's private repos.
 * Refuse private repos unless explicitly allowed; use the same 404 as GitHub
 * would give an anonymous caller so we don't confirm they exist.
 */
function assertRepoReadable(meta: RepoMeta): void {
  if (meta.private === true && process.env.DRIP_ALLOW_PRIVATE_REPOS !== "1") {
    throw new HttpError(404, "repo_not_found", "couldn't find that repo on github");
  }
}

/** Fetch the recursive tree, folding extra path segments into the ref when a branch name contains "/". */
async function fetchTree(owner: string, repo: string, candidates: string[], budget: Budget): Promise<{ ref: string; tree: TreeResponse }> {
  let lastErr: unknown = null;
  for (const ref of candidates) {
    try {
      const tree = await ghJson<TreeResponse>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, "branch", budget);
      return { ref, tree };
    } catch (e) {
      lastErr = e;
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
  }
  throw lastErr ?? new HttpError(404, "repo_not_found", "couldn't find that branch on github");
}

/** POST /api/ingest/repo — github url → tree summary + README + key files. */
export async function ingestRepo(input: string): Promise<IngestData> {
  const { owner, repo, ref: wantedRef, refCandidates } = parseRepoUrl(input);
  const budget = newBudget();
  const meta = await ghJson<RepoMeta>(`/repos/${owner}/${repo}`, "repo", budget);
  assertRepoReadable(meta);
  const candidates = wantedRef ? (refCandidates.length ? refCandidates : [wantedRef]) : [meta.default_branch];
  const { ref, tree: treeRes } = await fetchTree(owner, repo, candidates, budget);
  const tree = summarizeTree(treeRes.tree ?? []);

  const [readme, ...keyContents] = await Promise.all([
    tree.readmePath ? fetchRaw(owner, repo, ref, tree.readmePath, REPO_README_MAX_CHARS, budget).catch(() => null) : Promise.resolve(null),
    ...tree.keyFiles.map((p) => fetchRaw(owner, repo, ref, p, REPO_FILE_MAX_CHARS, budget).catch(() => null)),
  ]);
  const keyFiles = tree.keyFiles
    .map((path, i) => ({ path, content: keyContents[i] }))
    .filter((f): f is { path: string; content: string } => typeof f.content === "string" && f.content.length > 0);

  const text = buildRepoText({ owner, repo, ref, description: meta.description, language: meta.language, tree, readme, keyFiles });
  return {
    text,
    sourceKind: "repo",
    title: `${owner}/${repo}`,
    meta: {
      owner,
      repo,
      ref,
      url: meta.html_url ?? `https://github.com/${owner}/${repo}`,
      description: meta.description,
      language: meta.language,
      fileCount: tree.fileCount,
      tree: tree.files,
      treeTruncated: tree.truncated || Boolean(treeRes.truncated),
      readmePath: tree.readmePath,
      keyFiles: keyFiles.map((f) => f.path),
    },
  };
}
