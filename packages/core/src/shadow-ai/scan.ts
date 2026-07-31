import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Finds the traces AI adoption leaves in a repository.
 *
 * Shadow AI is rarely a decision anyone announced. It arrives as a config file somebody committed
 * during a delivery crunch, and by the time it matters it is load-bearing. But it is not actually
 * hidden — every one of these artifacts is checked into git, which means the invisible operating
 * layer can be read off the same source of truth as everything else, with no gateway to install
 * and no runtime to adopt.
 *
 * Deliberately offline: this reads directories that are already on disk. Nothing here talks to a
 * provider, needs a token, or reports usage — it reports *declaration*, which is the only thing a
 * spec-vs-reality check can honestly claim to know.
 */

export type AiArtifactKind =
  /** An MCP server configuration — `.mcp.json`. */
  | "mcp-config"
  /** Instructions written for a coding agent — `AGENTS.md`, `CLAUDE.md`. */
  | "agent-instructions"
  /** Assistant-specific configuration directories — `.claude/`, `.cursor/`. */
  | "assistant-config"
  /** An LLM SDK in a manifest — `package.json`, `requirements.txt`. */
  | "llm-dependency"
  /** A CI workflow step that invokes a model. */
  | "ai-workflow";

export interface AiArtifact {
  kind: AiArtifactKind;
  /** Path relative to the repository root. */
  path: string;
  /** What specifically was recognised — a package name, an action reference. */
  detail?: string;
}

export interface ScannedRepo {
  /** Directory basename. Matched against the tail of a declared `services[].repository`. */
  name: string;
  artifacts: AiArtifact[];
}

const MARKER_FILES: { file: string; kind: AiArtifactKind }[] = [
  { file: ".mcp.json", kind: "mcp-config" },
  { file: "AGENTS.md", kind: "agent-instructions" },
  { file: "CLAUDE.md", kind: "agent-instructions" },
  { file: ".cursorrules", kind: "assistant-config" },
];

const MARKER_DIRS: { dir: string; kind: AiArtifactKind }[] = [
  { dir: ".claude", kind: "assistant-config" },
  { dir: ".cursor", kind: "assistant-config" },
  { dir: ".github/chatmodes", kind: "assistant-config" },
];

/** Recognised by package name rather than by import, because a manifest is the one place a
 * dependency is declared once instead of scattered across call sites. */
const LLM_PACKAGES = [
  /^@anthropic-ai\//,
  /^anthropic$/,
  /^openai$/,
  /^@openai\//,
  /^langchain/,
  /^@langchain\//,
  /^llama-index/,
  /^llamaindex$/,
  /^google-genai$/,
  /^google-generativeai$/,
  /^@google\/generative-ai$/,
  /^cohere/,
  /^mistralai$/,
  /^ollama$/,
  /^crewai/,
  /^@modelcontextprotocol\//,
  /^litellm$/,
];

/** Loose on purpose: an action reference naming a model vendor is the signal, and pinning an
 * exact allow-list of action names would go stale faster than the check is worth. */
const AI_ACTION = /claude|anthropic|openai|copilot|gemini|bedrock-runtime/i;

const isLlmPackage = (name: string) => LLM_PACKAGES.some((pattern) => pattern.test(name));

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return null;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function scanManifests(repoRoot: string): Promise<AiArtifact[]> {
  const artifacts: AiArtifact[] = [];

  const packageJson = await readIfPresent(path.join(repoRoot, "package.json"));
  if (packageJson) {
    let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      manifest = JSON.parse(packageJson) as typeof manifest;
    } catch {
      manifest = {}; // an unparseable manifest is not evidence of anything
    }
    const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
    for (const name of names.filter(isLlmPackage).sort()) {
      artifacts.push({ kind: "llm-dependency", path: "package.json", detail: name });
    }
  }

  const requirements = await readIfPresent(path.join(repoRoot, "requirements.txt"));
  if (requirements) {
    const names = requirements
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) =>
        line
          .split(/[=<>!~[;]/)[0]!
          .trim()
          .toLowerCase(),
      );
    for (const name of names.filter(isLlmPackage).sort()) {
      artifacts.push({ kind: "llm-dependency", path: "requirements.txt", detail: name });
    }
  }

  return artifacts;
}

async function scanWorkflows(repoRoot: string): Promise<AiArtifact[]> {
  const workflowDir = path.join(repoRoot, ".github", "workflows");
  let entries: string[];
  try {
    entries = await readdir(workflowDir);
  } catch {
    return [];
  }

  const artifacts: AiArtifact[] = [];
  for (const entry of entries.filter((e) => /\.ya?ml$/.test(e)).sort()) {
    const content = await readIfPresent(path.join(workflowDir, entry));
    if (!content) continue;
    for (const line of content.split("\n")) {
      const uses = /^\s*-?\s*uses:\s*(\S+)/.exec(line);
      if (uses && AI_ACTION.test(uses[1]!)) {
        artifacts.push({
          kind: "ai-workflow",
          path: path.posix.join(".github/workflows", entry),
          detail: uses[1],
        });
        break; // one finding per workflow file is enough to make the point
      }
    }
  }
  return artifacts;
}

async function scanRepo(repoRoot: string): Promise<AiArtifact[]> {
  const artifacts: AiArtifact[] = [];

  for (const marker of MARKER_FILES) {
    if (await isFile(path.join(repoRoot, marker.file))) {
      artifacts.push({ kind: marker.kind, path: marker.file });
    }
  }
  for (const marker of MARKER_DIRS) {
    if (await isDirectory(path.join(repoRoot, marker.dir))) {
      artifacts.push({ kind: marker.kind, path: `${marker.dir}/` });
    }
  }

  artifacts.push(...(await scanManifests(repoRoot)));
  artifacts.push(...(await scanWorkflows(repoRoot)));
  return artifacts;
}

/**
 * Scans every immediate subdirectory of `root` as a repository checkout. Directory basename is
 * the repository identity, which is what a `git clone` gives you by default and what
 * `services[].repository` ends with.
 */
export async function scanForAiArtifacts(root: string): Promise<ScannedRepo[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const repos: ScannedRepo[] = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    repos.push({ name: entry.name, artifacts: await scanRepo(path.join(root, entry.name)) });
  }
  return repos;
}
