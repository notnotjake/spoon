#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";
import os from "os";
import readline from "readline";
import kleur from "kleur";
import { cancel, isCancel, multiselect, outro } from "@clack/prompts";
import {
  isHelpFlag,
  isNamedCommand,
  printCommandHelp,
  printMainHelp,
  resolveHelpTarget,
} from "./help";

function parseMs(value: string): number {
  const match = value.match(/^(\d+)\s*(d|h|m|s|ms)$/);
  if (!match) return NaN;
  const n = parseInt(match[1]);
  const unit: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * unit[match[2]];
}

function formatMs(ms: number): string {
  if (ms >= 86400000) return `${(ms / 86400000).toFixed(1)}d`;
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)}h`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

const DEFAULT_TTL = parseMs("14d");
const DEFAULT_DIR = "~/ai-scratch/gh";
const CONFIG_PATH = join(os.homedir(), ".config", "spoon", "config.json");
const LOG_PATH = join(os.homedir(), ".config", "spoon", "history.jsonl");
const META_FILENAME = ".spoon.json";
const COMMANDS = new Set(["config", "remove", "ls"]);
type LaunchTarget = {
  name: string;
  command: string;
};

type LaunchConfig = Record<string, LaunchTarget>;

const DEFAULT_LAUNCH: LaunchConfig = {
  c: { name: "Claude", command: "claude" },
  x: { name: "Codex", command: "codex" },
};

const styles = {
  title: (text: string) => kleur.bold().cyan(text),
  label: (text: string) => kleur.bold().white(text),
  info: (text: string) => kleur.cyan(text),
  warn: (text: string) => kleur.yellow(text),
  error: (text: string) => kleur.red(text),
  muted: (text: string) => kleur.gray(text),
  green: (text: string) => kleur.green(text),
  orange: (text: string) => kleur.yellow(text),
  bold: (text: string) => kleur.bold(text),
};

type SpoonConfig = {
  launch: LaunchConfig;
  ttlMs: number;
  baseDir: string;
};

type RepoMeta = {
  repoUrl: string;
  repoFullName: string;
  branch: string;
  clonedAt: string;
  lastAccess: string;
};

type RepoEntry = {
  path: string;
  meta: RepoMeta;
};

function logLine(line: string) {
  process.stdout.write(`${line}\n`);
}

function logInfo(message: string) {
  logLine(`${styles.title("spoon")} ${message}`);
}

function logWarn(message: string) {
  logLine(`${styles.warn("warning")} ${message}`);
}

function logError(message: string) {
  logLine(`${styles.error("error")} ${message}`);
}

function expandHome(value: string) {
  if (value.startsWith("~/")) {
    return join(os.homedir(), value.slice(2));
  }
  return value;
}

function deriveLaunchName(command: string, fallback = "Launch") {
  const trimmed = command.trim();
  if (!trimmed) return fallback;

  const tokens = trimmed.split(/\s+/);
  let executable = "";
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) continue;
    executable = token;
    break;
  }

  const token = executable || tokens[0] || "";
  const commandName = basename(token.replace(/^['"`]+|['"`]+$/g, "")).replace(/\.(cmd|exe|bat)$/i, "");
  const words = commandName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  return words.join(" ") || fallback;
}

function ensureDir(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function readConfig(): SpoonConfig {
  const base: SpoonConfig = {
    launch: { ...DEFAULT_LAUNCH },
    ttlMs: DEFAULT_TTL,
    baseDir: expandHome(DEFAULT_DIR),
  };

  if (!existsSync(CONFIG_PATH)) {
    return base;
  }

  try {
    const data = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
    const configuredLaunch: LaunchConfig = {};
    if (typeof data.launch === "object" && data.launch !== null) {
      for (const [rawAlias, rawLaunchValue] of Object.entries(data.launch as Record<string, unknown>)) {
        const alias = rawAlias.trim();
        if (!alias) continue;

        if (typeof rawLaunchValue === "string") {
          const command = rawLaunchValue.trim();
          if (!command) continue;
          configuredLaunch[alias] = {
            name: deriveLaunchName(command, alias),
            command,
          };
          continue;
        }

        if (typeof rawLaunchValue === "object" && rawLaunchValue !== null) {
          const launchValue = rawLaunchValue as Record<string, unknown>;
          const rawName = typeof launchValue.name === "string" ? launchValue.name.trim() : "";
          const command = typeof launchValue.command === "string" ? launchValue.command.trim() : "";
          if (!command) continue;
          configuredLaunch[alias] = {
            name: rawName || deriveLaunchName(command, alias),
            command,
          };
        }
      }
    }
    return {
      launch: Object.keys(configuredLaunch).length > 0 ? configuredLaunch : base.launch,
      ttlMs: typeof data.ttlMs === "number" ? data.ttlMs : base.ttlMs,
      baseDir: typeof data.baseDir === "string" ? expandHome(data.baseDir) : base.baseDir,
    };
  } catch (error) {
    logWarn("Config file unreadable, using defaults.");
    return base;
  }
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const options: Record<string, string> = {};
  const launchCommand: string[] = [];
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      launchCommand.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "-l" || arg === "--launch") {
      options.launch = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "-b" || arg === "--branch") {
      options.branch = argv[i + 1];
      i += 1;
      continue;
    }
    positional.push(arg);
  }

  return { positional, options, help, launchCommand };
}

async function runCommand(command: string, args: string[], options?: { cwd?: string }) {
  const proc = Bun.spawn([command, ...args], {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Command failed: ${command}`);
  }

  return stdout.trim();
}

async function openPathWithDefaultApp(path: string) {
  const platform = os.platform();
  if (platform === "darwin") {
    await runCommand("open", [path]);
    return;
  }
  if (platform === "win32") {
    await runCommand("explorer", [path]);
    return;
  }
  await runCommand("xdg-open", [path]);
}

async function runInteractiveShell(commandLine: string, options?: { cwd?: string }) {
  const proc = Bun.spawn(["sh", "-lc", commandLine], {
    cwd: options?.cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

async function fzfSelect(lines: string[], args: string[]) {
  if (lines.length === 0) {
    return null;
  }
  const input = lines.join("\n");
  const proc = Bun.spawn(["fzf", ...args], {
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return null;
  }
  return output.trim();
}

function isUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("git@");
}

function parseRepoSlug(input: string) {
  if (isUrl(input)) {
    const match = input.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
    if (!match) {
      return null;
    }
    return { owner: match[1], repo: match[2].replace(/\.git$/, ""), url: input };
  }

  if (/^[^/\s]+\/[^/\s]+$/.test(input)) {
    return {
      owner: input.split("/")[0],
      repo: input.split("/")[1],
      url: `https://github.com/${input}`,
    };
  }

  return null;
}

async function resolveRepo(input: string, baseDir: string) {
  const parsed = parseRepoSlug(input);
  if (parsed) {
    return parsed;
  }

  const local = await searchLocalAndHistory(input, baseDir);
  if (local) {
    return local;
  }

  return await searchRepo(input);
}

async function searchRepo(query: string) {
  logInfo(`${styles.muted(`Searching for "${query}"...`)}`);
  const json = await runCommand("gh", ["search", "repos", query, "--limit", "50", "--json", "fullName,url" ]);
  const results = JSON.parse(json) as { fullName: string; url: string }[];
  if (results.length === 0) {
    throw new Error(`No repositories found for "${query}".`);
  }

  const lines = results.map((item) => `${item.fullName}\t${item.url}`);
  const selection = await fzfSelect(lines, [
    "--prompt",
    "Repo > ",
    "--with-nth",
    "1",
    "--delimiter",
    "\t",
  ]);
  if (!selection) {
    throw new Error("Search canceled.");
  }

  const [fullName, url] = selection.split("\t");
  const [owner, repo] = fullName.split("/");
  return { owner, repo, url };
}

async function searchLocalAndHistory(query: string, baseDir: string) {
  const lowerQuery = query.toLowerCase();
  const localRepos = collectRepos(baseDir);
  const history = readHistory();

  // Deduplicate: collect all unique fullNames with their source
  const seen = new Map<string, "local" | "history">();
  for (const entry of localRepos) {
    seen.set(entry.meta.repoFullName, "local");
  }
  // History entries not already local
  const historyNames = new Set<string>();
  for (const entry of history) {
    historyNames.add(entry.repoFullName);
  }
  for (const name of historyNames) {
    if (!seen.has(name)) {
      seen.set(name, "history");
    }
  }

  // Match against the repo name part (after /)
  const exactMatches: { fullName: string; source: "local" | "history" }[] = [];
  const substringMatches: { fullName: string; source: "local" | "history" }[] = [];

  for (const [fullName, source] of seen) {
    const repoName = fullName.split("/")[1]?.toLowerCase() ?? "";
    if (repoName === lowerQuery) {
      exactMatches.push({ fullName, source });
    } else if (repoName.includes(lowerQuery) || fullName.toLowerCase().includes(lowerQuery)) {
      substringMatches.push({ fullName, source });
    }
  }

  const pickFrom = exactMatches.length > 0 ? exactMatches : substringMatches;

  if (pickFrom.length === 0) {
    return null;
  }

  let chosen: string;

  if (pickFrom.length === 1) {
    chosen = pickFrom[0].fullName;
  } else {
    const lines = pickFrom.map(
      (m) => `${m.fullName}\t[${m.source}]`
    );
    const selection = await fzfSelect(lines, [
      "--prompt",
      "Repo > ",
      "--with-nth",
      "1,2",
      "--delimiter",
      "\t",
    ]);
    if (!selection) {
      throw new Error("Selection canceled.");
    }
    chosen = selection.split("\t")[0];
  }

  const [owner, repo] = chosen.split("/");
  return { owner, repo, url: `https://github.com/${chosen}` };
}

async function selectBranch(repoUrl: string, forcedBranch?: string) {
  if (forcedBranch) {
    return forcedBranch;
  }

  const headInfo = await runCommand("git", ["ls-remote", "--symref", repoUrl, "HEAD"]);
  const defaultMatch = headInfo.match(/ref: refs\/heads\/(\S+)/);
  const defaultBranch = defaultMatch ? defaultMatch[1] : "main";

  let refs = "";
  try {
    refs = await runCommand("git", ["ls-remote", "--sort=-committerdate", "--heads", repoUrl]);
  } catch (error) {
    refs = await runCommand("git", ["ls-remote", "--heads", repoUrl]);
  }
  const branches = refs
    .split("\n")
    .map((line) => line.split("\t")[1])
    .filter(Boolean)
    .map((ref) => ref.replace("refs/heads/", ""));

  const uniqueBranches = Array.from(new Set(branches));
  const ordered = [defaultBranch, ...uniqueBranches.filter((branch) => branch !== defaultBranch)];
  const display = ordered.map((branch) => (branch === defaultBranch ? `${branch}\t(default)` : branch));

  const selection = await fzfSelect(display, [
    "--prompt",
    "Branch > ",
    "--with-nth",
    "1",
    "--delimiter",
    "\t",
    "--header",
    `Default branch: ${defaultBranch}`,
  ]);

  if (!selection) {
    throw new Error("Branch selection canceled.");
  }

  return selection.split("\t")[0];
}

function formatDate(value: string) {
  const date = new Date(value);
  return date.toLocaleString();
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Unknown";
  }

  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minute = String(date.getMinutes()).padStart(2, "0");
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const dayPart = sameYear ? `${month}/${day}` : `${month}/${day}/${year}`;
  return `${dayPart} ${hour12}:${minute}${meridiem}`;
}

function padCell(value: string, width: number) {
  return value.padEnd(width, " ");
}

function formatRelativeDate(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return "Unknown";
  }

  const diffMs = Date.now() - time;
  if (diffMs < 0) {
    return "Just now";
  }

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;

  if (diffMs < 45 * 1000) return "Just now";
  if (diffMs < 90 * 1000) return "Last minute";
  if (diffMs < 45 * minute) return `${Math.round(diffMs / minute)} minutes ago`;
  if (diffMs < 90 * minute) return "Last hour";
  if (diffMs < 24 * hour) return `${Math.round(diffMs / hour)} hours ago`;
  if (diffMs < 36 * hour) return "Yesterday";
  if (diffMs < 30 * day) return `${Math.round(diffMs / day)} days ago`;
  if (diffMs < 45 * day) return "Last month";
  if (diffMs < year) return `${Math.round(diffMs / month)} months ago`;
  if (diffMs < 545 * day) return "Last year";
  return `${Math.round(diffMs / year)} years ago`;
}

function repoDir(baseDir: string, owner: string, repo: string) {
  return join(baseDir, owner, repo);
}

function metaPath(dir: string) {
  return join(dir, META_FILENAME);
}

function readMeta(dir: string): RepoMeta | null {
  const path = metaPath(dir);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return null;
  }
}

function writeMeta(dir: string, meta: RepoMeta) {
  writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2));
}

type HistoryEntry = {
  repoFullName: string;
  timestamp: string;
};

function readHistory(): HistoryEntry[] {
  if (!existsSync(LOG_PATH)) {
    return [];
  }
  const entries: HistoryEntry[] = [];
  const content = readFileSync(LOG_PATH, "utf8");
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

function appendHistory(repoFullName: string) {
  ensureDir(join(os.homedir(), ".config", "spoon"));
  const entry: HistoryEntry = {
    repoFullName,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
}

function syncHistory(baseDir: string) {
  const entries = collectRepos(baseDir);
  if (entries.length === 0) return;

  const history = readHistory();
  const logged = new Set(history.map((h) => h.repoFullName));

  for (const entry of entries) {
    if (!logged.has(entry.meta.repoFullName)) {
      appendHistory(entry.meta.repoFullName);
    }
  }
}

function collectRepos(baseDir: string): RepoEntry[] {
  if (!existsSync(baseDir)) {
    return [];
  }
  const entries: RepoEntry[] = [];
  const owners = readdirSync(baseDir).filter((owner) => statSync(join(baseDir, owner)).isDirectory());
  for (const owner of owners) {
    const ownerDir = join(baseDir, owner);
    const repos = readdirSync(ownerDir).filter((repo) => statSync(join(ownerDir, repo)).isDirectory());
    for (const repo of repos) {
      const repoPath = join(ownerDir, repo);
      const meta = readMeta(repoPath);
      if (meta) {
        entries.push({ path: repoPath, meta });
      }
    }
  }
  return entries;
}

async function pickLocalRepo(entries: RepoEntry[]) {
  if (entries.length === 0) {
    return null;
  }

  const sorted = entries
    .slice()
    .sort((a, b) => new Date(b.meta.lastAccess).getTime() - new Date(a.meta.lastAccess).getTime());

  const rows = sorted.map((entry) => {
    const [org, project = entry.meta.repoFullName] = entry.meta.repoFullName.split("/");
    return {
      org,
      project,
      relativeDate: formatRelativeDate(entry.meta.lastAccess),
    };
  });

  const projectWidth = rows.reduce((max, row) => Math.max(max, row.project.length), "Project".length);
  const orgWidth = rows.reduce((max, row) => Math.max(max, row.org.length), "Org".length);
  const dateWidth = rows.reduce((max, row) => Math.max(max, row.relativeDate.length), "Last Active".length);

  const columnGap = "   ";
  const header = `${padCell("Project", projectWidth)}${columnGap}${padCell("Org", orgWidth)}${columnGap}${padCell("Last Active", dateWidth)}`;
  const lines = sorted.map((entry, index) => {
    const row = rows[index];
    const number = String(index + 1).padStart(3, " ");
    const display = [
      padCell(row.project, projectWidth),
      padCell(row.org, orgWidth),
      styles.muted(padCell(row.relativeDate, dateWidth)),
    ].join(columnGap);
    return `${number}\t${display}`;
  });

  const selection = await fzfSelect(lines, [
    "--prompt",
    "Project > ",
    "--ansi",
    "--with-nth",
    "2",
    "--delimiter",
    "\t",
    "--header",
    header,
  ]);

  if (!selection) {
    return null;
  }

  const rawNumber = selection.split("\t")[0];
  const selectedIndex = Number.parseInt(rawNumber.trim(), 10) - 1;
  if (selectedIndex < 0 || selectedIndex >= sorted.length) {
    return null;
  }

  return sorted[selectedIndex];
}

function removeDir(path: string) {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
  const parent = resolve(path, "..");
  if (existsSync(parent)) {
    const remaining = readdirSync(parent);
    if (remaining.length === 0) {
      rmSync(parent, { recursive: true, force: true });
    }
  }
}

function shouldPurge(repo: RepoEntry, ttlMs: number) {
  const lastAccess = new Date(repo.meta.lastAccess).getTime();
  return Number.isFinite(lastAccess) && Date.now() - lastAccess > ttlMs;
}

function purgeRepos(entries: RepoEntry[], ttlMs: number) {
  const expired = entries.filter((entry) => shouldPurge(entry, ttlMs));
  for (const entry of expired) {
    removeDir(entry.path);
  }
  return expired.length;
}

async function purgeOnInvoke(baseDir: string, ttlMs: number) {
  const entries = collectRepos(baseDir);
  if (entries.length < 10) {
    return;
  }
  const purged = purgeRepos(entries, ttlMs);
  if (purged > 0) {
    logInfo(`${styles.label("purged")} ${purged} expired repos.`);
  }
}

async function removeRepos(baseDir: string, ttlMs: number) {
  const entries = collectRepos(baseDir);
  if (entries.length === 0) {
    logInfo("No repos to remove.");
    return;
  }

  const active: RepoEntry[] = [];
  const expired: RepoEntry[] = [];

  for (const entry of entries) {
    if (shouldPurge(entry, ttlMs)) {
      expired.push(entry);
    } else {
      active.push(entry);
    }
  }

  // Sort both by last access (newest first)
  active.sort((a, b) => new Date(b.meta.lastAccess).getTime() - new Date(a.meta.lastAccess).getTime());
  expired.sort((a, b) => new Date(b.meta.lastAccess).getTime() - new Date(a.meta.lastAccess).getTime());

  type SelectOption = { value: string; label: string; hint?: string };
  const options: SelectOption[] = [];

  if (active.length > 0) {
    options.push({ value: "_active_header", label: "── Active ──", hint: "" });
    for (const entry of active) {
      options.push({
        value: entry.path,
        label: entry.meta.repoFullName,
        hint: formatDate(entry.meta.lastAccess),
      });
    }
  }

  if (expired.length > 0) {
    options.push({ value: "_expired_header", label: "── Expired ──", hint: "" });
    for (const entry of expired) {
      options.push({
        value: entry.path,
        label: entry.meta.repoFullName,
        hint: formatDate(entry.meta.lastAccess),
      });
    }
  }

  // Pre-select expired repos
  const initialValues = expired.map((e) => e.path);

  const selection = await multiselect({
    message: "Select repos to remove",
    options,
    initialValues,
    required: false,
  });

  if (isCancel(selection)) {
    cancel("Canceled.");
    return;
  }

  const paths = (selection as string[]).filter((p) => !p.startsWith("_"));
  if (paths.length === 0) {
    outro("No repos removed.");
    return;
  }

  const removed: string[] = [];
  for (const path of paths) {
    const entry = entries.find((e) => e.path === path);
    if (entry) {
      removed.push(entry.meta.repoFullName);
      removeDir(path);
    }
  }

  outro(`Removed ${removed.join(", ")}`);
}

function resolveDefaultLaunchAlias(config: SpoonConfig) {
  const aliases = Object.keys(config.launch);
  if (aliases.length === 0) {
    throw new Error("No launch aliases configured. Add at least one entry to config.launch.");
  }
  return aliases[0];
}

function resolveLaunchTarget(config: SpoonConfig, requestedAlias?: string, launchCommand?: string[]) {
  if (launchCommand && launchCommand.length > 0) {
    const command = launchCommand.join(" ").trim();
    return {
      name: deriveLaunchName(command, launchCommand[0]),
      command,
    };
  }

  const alias = (requestedAlias ?? resolveDefaultLaunchAlias(config)).trim();
  if (!alias) {
    throw new Error("Launch alias is required.");
  }

  const configuredLaunch = config.launch[alias];
  const command = configuredLaunch?.command.trim();
  if (!command) {
    throw new Error(`Unknown launch alias "${alias}". Add it to config.launch.`);
  }

  return {
    name: configuredLaunch.name.trim() || deriveLaunchName(command, alias),
    command,
  };
}

async function commandExists(command: string) {
  const name = command.trim();
  if (!name) return false;
  try {
    if (os.platform() === "win32") {
      await runCommand("where", [name]);
    } else {
      await runCommand("which", [name]);
    }
    return true;
  } catch {
    return false;
  }
}

async function recoverLeadingDoubleDash(
  command: string,
  positional: string[],
  launchCommand: string[],
  launchAliases: LaunchConfig,
): Promise<{ command: string; positional: string[]; launchCommand: string[] }> {
  if (command !== "run") {
    return { command, positional, launchCommand };
  }
  if (launchCommand.length > 0) {
    return { command, positional, launchCommand };
  }
  if (positional.length === 0) {
    return { command, positional, launchCommand };
  }
  if (COMMANDS.has(positional[0])) {
    return { command, positional, launchCommand };
  }
  if (parseRepoSlug(positional.join(" ").trim())) {
    return { command, positional, launchCommand };
  }
  if (positional.length === 1) {
    const single = positional[0].trim();
    const aliasMatch = Object.prototype.hasOwnProperty.call(launchAliases, single);
    const commandMatch = Object.values(launchAliases).some((value) => value.command === single);
    if (!aliasMatch && !commandMatch) {
      return { command, positional, launchCommand };
    }
  }
  if (!(await commandExists(positional[0]))) {
    return { command, positional, launchCommand };
  }

  return {
    command: "pick",
    positional: [],
    launchCommand: positional,
  };
}

async function promptLine(question: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return await new Promise<string>((resolveLine) => {
    rl.question(question, (answer) => {
      rl.close();
      resolveLine(answer);
    });
  });
}

async function readSingleKey(prompt: string) {
  if (!process.stdin.isTTY) {
    const line = await promptLine(prompt);
    return line.trim();
  }

  return await new Promise<string>((resolveKey) => {
    const stdin = process.stdin;
    const onData = (data: Buffer) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      const key = data.toString("utf8");
      if (key === "\x03") {
        logLine("");
        process.exit(0);
      }
      resolveKey(key);
    };

    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function cloneRepo(repoUrl: string, branch: string, targetDir: string) {
  ensureDir(resolve(targetDir, ".."));
  logInfo(`${styles.label("clone")} ${styles.muted(repoUrl)}`);
  const start = Date.now();
  await runCommand("git", ["clone", "--branch", branch, "--single-branch", repoUrl, targetDir]);
  const elapsed = Date.now() - start;
  logInfo(`${styles.label("cloned")} ${styles.muted(`in ${formatMs(elapsed)}`)}`);
}

async function refExists(dir: string, ref: string) {
  try {
    await runCommand("git", ["show-ref", "--verify", ref], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

async function getCurrentBranch(dir: string) {
  try {
    const branch = await runCommand("git", ["branch", "--show-current"], { cwd: dir });
    return branch || null;
  } catch {
    return null;
  }
}

async function getLastCommitDate(dir: string, ref: string) {
  try {
    const isoDate = await runCommand("git", ["log", "-1", "--format=%cI", ref], { cwd: dir });
    return isoDate || null;
  } catch {
    return null;
  }
}

type RepoStatusInfo = {
  display: string;
  behind: number | null;
};

async function describeRepoStatus(dir: string, branch: string, meta: RepoMeta | null): Promise<RepoStatusInfo> {
  const clonedSegment = meta?.clonedAt ? `Cloned ${formatShortDate(meta.clonedAt)}` : null;
  const localRef = (await refExists(dir, `refs/heads/${branch}`)) ? `refs/heads/${branch}` : "HEAD";

  try {
    await runCommand("git", ["fetch", "origin", branch], { cwd: dir });
    const remoteRef = `refs/remotes/origin/${branch}`;
    if (!(await refExists(dir, remoteRef))) {
      const segments: string[] = [];
      if (clonedSegment) segments.push(clonedSegment);
      segments.push(styles.orange("Failed to check remote branch"));
      return { display: segments.join(" - "), behind: null };
    }

    const behindRaw = await runCommand("git", ["rev-list", "--count", `${localRef}..${remoteRef}`], { cwd: dir });
    const behind = Number.parseInt(behindRaw, 10);
    const remoteUpdated = await getLastCommitDate(dir, remoteRef);

    if (Number.isFinite(behind) && behind <= 0) {
      return { display: styles.green("Up to date"), behind: 0 };
    }

    const segments: string[] = [];
    let commitsBehind: number | null = null;
    if (Number.isFinite(behind) && behind > 0) {
      segments.push(`${behind} ${behind === 1 ? "commit" : "commits"} behind`);
      commitsBehind = behind;
    } else {
      segments.push("Behind remote");
    }
    if (clonedSegment) segments.push(clonedSegment);
    if (remoteUpdated) segments.push(`Updated ${formatShortDate(remoteUpdated)}`);
    return { display: segments.join(" - "), behind: commitsBehind };
  } catch {
    const localUpdated = await getLastCommitDate(dir, localRef);
    const segments: string[] = [];
    if (clonedSegment) segments.push(clonedSegment);
    if (localUpdated) segments.push(`Updated ${formatShortDate(localUpdated)}`);
    segments.push(styles.orange("Failed to fetch origin"));
    return { display: segments.join(" - "), behind: null };
  }
}

async function checkoutBranch(dir: string, branch: string) {
  try {
    await runCommand("git", ["show-ref", "--verify", `refs/heads/${branch}`], { cwd: dir });
  } catch (error) {
    await runCommand("git", ["fetch", "origin", branch], { cwd: dir });
    await runCommand("git", ["checkout", "-b", branch, `origin/${branch}`], { cwd: dir });
    return;
  }
  await runCommand("git", ["checkout", branch], { cwd: dir });
}

async function pullRepo(dir: string, branch: string) {
  await runCommand("git", ["fetch", "origin"], { cwd: dir });
  await checkoutBranch(dir, branch);
  await runCommand("git", ["pull", "--ff-only"], { cwd: dir });
}

async function launchTarget(target: LaunchTarget, cwd: string) {
  const detail = target.command === target.name ? target.name : `${target.name} (${target.command})`;
  logInfo(`${styles.label("open")} ${styles.muted(`with ${detail}`)}`);
  const exitCode = await runInteractiveShell(target.command, { cwd });
  if (exitCode !== 0) {
    throw new Error(`${target.name} exited with code ${exitCode}.`);
  }
}

function updateMetaAccess(meta: RepoMeta, branch: string) {
  return {
    ...meta,
    branch,
    lastAccess: new Date().toISOString(),
  };
}

async function runSpoon(command: string, positional: string[], options: Record<string, string>, launchCommand: string[]) {
  if (command === "config") {
    const hasExtraPositional = positional.length > 1;
    const optionKeys = Object.keys(options);
    const hasUnexpectedOption = optionKeys.length > 0;
    if (hasExtraPositional || hasUnexpectedOption) {
      throw new Error("Config command supports only: 'spoon config'.");
    }

    if (!existsSync(CONFIG_PATH)) {
      throw new Error(`Config file does not exist: ${CONFIG_PATH}`);
    }
    await openPathWithDefaultApp(CONFIG_PATH);
    logInfo(`Opened ${styles.muted(CONFIG_PATH)}`);
    return;
  }

  const config = readConfig();
  const recovered = await recoverLeadingDoubleDash(command, positional, launchCommand, config.launch);
  command = recovered.command;
  positional = recovered.positional;
  launchCommand = recovered.launchCommand;
  ensureDir(config.baseDir);
  syncHistory(config.baseDir);
  await purgeOnInvoke(config.baseDir, config.ttlMs);

  if (command === "remove") {
    await removeRepos(config.baseDir, config.ttlMs);
    return;
  }

  if (command === "ls") {
    const entries = collectRepos(config.baseDir);
    const localRepoNames = new Set(entries.map((e) => e.meta.repoFullName));

    // Read history to find previously accessed repos that are no longer local
    const history = readHistory();
    const repoLastSeen = new Map<string, string>();
    for (const entry of history) {
      if (!localRepoNames.has(entry.repoFullName)) {
        repoLastSeen.set(entry.repoFullName, entry.timestamp);
      }
    }
    const historyRepos = Array.from(repoLastSeen.entries())
      .map(([repoFullName, lastSeen]) => ({ repoFullName, lastSeen }))
      .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

    if (entries.length === 0 && historyRepos.length === 0) {
      logInfo("No repos found.");
      return;
    }

    // Show available (local) repos first
    if (entries.length > 0) {
      logLine(styles.label("Available"));
      const sorted = entries
        .slice()
        .sort((a, b) => new Date(b.meta.lastAccess).getTime() - new Date(a.meta.lastAccess).getTime());
      for (const entry of sorted) {
        const { meta } = entry;
        logLine(`  ${meta.repoFullName} ${styles.muted(`(${meta.branch})`)}`);
      }
    }

    // Show history (non-local) repos
    if (historyRepos.length > 0) {
      if (entries.length > 0) {
        logLine("");
      }
      logLine(styles.label("History"));
      for (const repo of historyRepos) {
        logLine(`  ${styles.muted(repo.repoFullName)}`);
      }
    }

    return;
  }

  const target = resolveLaunchTarget(config, options.launch, launchCommand);

  if (command === "pick") {
    const entries = collectRepos(config.baseDir);
    if (entries.length === 0) {
      logInfo(`No local repos found in ${styles.muted(config.baseDir)}.`);
      logInfo(`Run ${styles.label("spoon")} ${styles.muted("<org/repo|url|search>")} to clone one first.`);
      return;
    }

    const selected = await pickLocalRepo(entries);
    if (!selected) {
      throw new Error("Selection canceled.");
    }

    const parsed = parseRepoSlug(selected.meta.repoFullName);
    if (!parsed) {
      throw new Error(`Invalid repo metadata: ${selected.meta.repoFullName}`);
    }
    const repo = {
      owner: parsed.owner,
      repo: parsed.repo,
      url: selected.meta.repoUrl || parsed.url,
    };

    await handleRepo({ repo, target, branchOverride: options.branch, config });
    return;
  }

  if (command === "run") {
    const repoInput = positional.join(" ").trim();
    if (!repoInput) {
      throw new Error("Repository reference required.");
    }
    const repo = await resolveRepo(repoInput, config.baseDir);
    await handleRepo({ repo, target, branchOverride: options.branch, config });
  }
}

async function handleRepo({
  repo,
  target,
  branchOverride,
  config,
}: {
  repo: { owner: string; repo: string; url: string };
  target: LaunchTarget;
  branchOverride?: string;
  config: SpoonConfig;
}) {
  const targetDir = repoDir(config.baseDir, repo.owner, repo.repo);
  ensureDir(join(config.baseDir, repo.owner));

  let branch = branchOverride;
  let clonedAt: string | null = null;

  if (existsSync(targetDir)) {
    const meta = readMeta(targetDir);
    if (meta) {
      clonedAt = meta.clonedAt;
    }

    if (!branch) {
      branch = meta?.branch ?? undefined;
    }
    const statusBranch = branch ?? (await getCurrentBranch(targetDir)) ?? "main";
    branch = statusBranch;
    const status = await describeRepoStatus(targetDir, statusBranch, meta);
    logInfo(`${styles.label("found")} ${repo.owner}/${repo.repo} ${styles.muted("•")} ${status.display}`);

    if (status.behind === 0) {
      await checkoutBranch(targetDir, branch ?? "main");
    } else {
      const actionKey = await readSingleKey(`${kleur.green(`${kleur.bold("Enter")} Launch ${kleur.bold(target.name)}`)}  ${styles.muted("·")}  ${kleur.yellow(`${kleur.bold("Tab")} Update`)} `);
      logLine("");
      const key = actionKey[0];
      const wantsUpdate = key === "\t" || key?.toLowerCase() === "u";

      if (wantsUpdate) {
        if (status.behind !== 0) {
          await pullRepo(targetDir, branch ?? "main");
        }
      } else {
        await checkoutBranch(targetDir, branch ?? "main");
      }
    }
  } else {
    branch = await selectBranch(repo.url, branchOverride);
    await cloneRepo(repo.url, branch, targetDir);
    clonedAt = new Date().toISOString();
    appendHistory(`${repo.owner}/${repo.repo}`);
  }

  const now = new Date().toISOString();
  const meta: RepoMeta = {
    repoUrl: repo.url,
    repoFullName: `${repo.owner}/${repo.repo}`,
    branch: branch ?? "main",
    clonedAt: clonedAt ?? now,
    lastAccess: now,
  };
  writeMeta(targetDir, meta);

  await launchTarget(target, targetDir);

  const updatedMeta = updateMetaAccess(meta, branch ?? "main");
  writeMeta(targetDir, updatedMeta);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (isHelpFlag(command)) {
    printMainHelp();
    process.exit(0);
  }

  if (command === "help") {
    const target = argv[1];

    if (!target || isHelpFlag(target)) {
      printMainHelp();
      process.exit(0);
    }

    if (argv.length > 2) {
      logLine("Usage: spoon help [command]");
      process.exit(1);
    }

    const resolvedTarget = resolveHelpTarget(target);
    if (!resolvedTarget) {
      logLine(`Unknown command: ${target}`);
      process.exit(1);
    }

    printCommandHelp(resolvedTarget, { detailed: false });
    process.exit(0);
  }

  const { positional, options, help, launchCommand } = parseArgs(argv);
  if (help) {
    const primary = positional[0];
    if (!primary) {
      printMainHelp();
      process.exit(0);
    }

    if (isNamedCommand(primary)) {
      printCommandHelp(primary);
      process.exit(0);
    }

    printCommandHelp("run");
    process.exit(0);
  }

  const normalizedCommand = positional.length === 0
    ? "pick"
    : (COMMANDS.has(positional[0]) ? positional[0] : "run");

  try {
    await runSpoon(normalizedCommand, positional, options, launchCommand);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(message);
    process.exit(1);
  }
}

await main();
