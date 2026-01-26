#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import os from "os";
import readline from "readline";
import kleur from "kleur";
import { cancel, isCancel, intro, multiselect, outro, selectKey } from "@clack/prompts";

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
const CONFIG_PATH = join(os.homedir(), ".config", "gain", "config.json");
const LOG_PATH = join(os.homedir(), ".config", "gain", "history.jsonl");
const META_FILENAME = ".gain.json";
const SUPPORTED_PROVIDERS = new Set(["claude", "opencode", "amp"]);
const COMMANDS = new Set(["config", "remove", "ls"]);

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

type GainConfig = {
  provider: string;
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
  logLine(`${styles.title("gain")} ${message}`);
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

function ensureDir(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function readConfig(): GainConfig {
  const base: GainConfig = {
    provider: "claude",
    ttlMs: DEFAULT_TTL,
    baseDir: expandHome(DEFAULT_DIR),
  };

  if (!existsSync(CONFIG_PATH)) {
    return base;
  }

  try {
    const data = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return {
      provider: data.provider ?? base.provider,
      ttlMs: typeof data.ttlMs === "number" ? data.ttlMs : base.ttlMs,
      baseDir: data.baseDir ? expandHome(data.baseDir) : base.baseDir,
    };
  } catch (error) {
    logWarn("Config file unreadable, using defaults.");
    return base;
  }
}

function writeConfig(config: GainConfig) {
  ensureDir(join(os.homedir(), ".config", "gain"));
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const options: Record<string, string> = {};
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "-p" || arg === "--provider") {
      options.provider = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "-b" || arg === "--branch") {
      options.branch = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--ttl") {
      options.ttl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--dir") {
      options.dir = argv[i + 1];
      i += 1;
      continue;
    }
    positional.push(arg);
  }

  return { positional, options, help };
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

async function runInteractive(command: string, args: string[], options?: { cwd?: string }) {
  const proc = Bun.spawn([command, ...args], {
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

async function resolveRepo(input: string) {
  const parsed = parseRepoSlug(input);
  if (parsed) {
    return parsed;
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
  ensureDir(join(os.homedir(), ".config", "gain"));
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

async function ensureProvider(provider: string) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`Provider must be one of: ${Array.from(SUPPORTED_PROVIDERS).join(", ")}.`);
  }
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

async function confirm(prompt: string) {
  const line = await promptLine(`${prompt} ${styles.muted("[y/N]")}: `);
  return line.trim().toLowerCase().startsWith("y");
}

async function chooseUpdateMode() {
  const selection = await fzfSelect([
    "Pull latest",
    "Reclone fresh",
  ], ["--prompt", "Update > "]);

  if (!selection) {
    throw new Error("Update canceled.");
  }

  return selection.startsWith("Pull") ? "pull" : "reclone";
}

async function cloneRepo(repoUrl: string, branch: string, targetDir: string) {
  ensureDir(resolve(targetDir, ".."));
  logInfo(`${styles.label("clone")} ${styles.muted(repoUrl)}`);
  const start = Date.now();
  await runCommand("git", ["clone", "--branch", branch, "--single-branch", repoUrl, targetDir]);
  const elapsed = Date.now() - start;
  logInfo(`${styles.label("cloned")} ${styles.muted(`in ${formatMs(elapsed)}`)}`);
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

async function launchProvider(provider: string, cwd: string) {
  logInfo(`${styles.label("open")} ${styles.muted(`with ${provider}`)}`);
  const exitCode = await runInteractive(provider, [], { cwd });
  if (exitCode !== 0) {
    throw new Error(`${provider} exited with code ${exitCode}.`);
  }
}

function updateMetaAccess(meta: RepoMeta, branch: string) {
  return {
    ...meta,
    branch,
    lastAccess: new Date().toISOString(),
  };
}

async function runGain(command: string, positional: string[], options: Record<string, string>) {
  const config = readConfig();
  ensureDir(config.baseDir);
  syncHistory(config.baseDir);
  await purgeOnInvoke(config.baseDir, config.ttlMs);

  if (command === "config") {
    const nextConfig = { ...config };
    if (options.provider) {
      await ensureProvider(options.provider);
      nextConfig.provider = options.provider;
    }
    if (options.ttl) {
      const parsed = parseMs(options.ttl);
      if (typeof parsed !== "number") {
        throw new Error("Invalid TTL value.");
      }
      nextConfig.ttlMs = parsed;
    }
    if (options.dir) {
      nextConfig.baseDir = expandHome(options.dir);
    }

    writeConfig(nextConfig);
    logInfo("Config updated.");
    return;
  }

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

  const provider = options.provider ?? config.provider;
  await ensureProvider(provider);

  if (command === "run") {
    const repoInput = positional.join(" ").trim();
    if (!repoInput) {
      throw new Error("Repository reference required.");
    }
    const repo = await resolveRepo(repoInput);
    await handleRepo({ repo, provider, branchOverride: options.branch, config });
  }
}

async function handleRepo({
  repo,
  provider,
  branchOverride,
  config,
}: {
  repo: { owner: string; repo: string; url: string };
  provider: string;
  branchOverride?: string;
  config: GainConfig;
}) {
  const targetDir = repoDir(config.baseDir, repo.owner, repo.repo);
  ensureDir(join(config.baseDir, repo.owner));

  let branch = branchOverride;
  let clonedAt: string | null = null;

  if (existsSync(targetDir)) {
    const meta = readMeta(targetDir);
    if (meta) {
      clonedAt = meta.clonedAt;
      logInfo(`${styles.label("found")} ${repo.owner}/${repo.repo} ${styles.muted(`(cloned ${formatDate(meta.clonedAt)})`)}`);
    } else {
      logInfo(`${styles.label("found")} ${repo.owner}/${repo.repo}`);
    }

    if (!branch) {
      branch = meta?.branch ?? undefined;
    }

    const actionKey = await readSingleKey(`${kleur.green(`${kleur.bold("Enter")} Open`)}  ${styles.muted("·")}  ${kleur.yellow(`${kleur.bold("Tab")} Edit`)} `);
    logLine("");
    const key = actionKey[0];
    const wantsEdit = key === "\t" || key?.toLowerCase() === "e";

    if (wantsEdit) {
      const actions = await multiselect({
        message: "Edit options",
        options: [
          { value: "update", label: "Update repo" },
          { value: "branch", label: "Change branch" },
        ],
        required: false,
      });

      if (isCancel(actions)) {
        cancel("Canceled.");
        return;
      }

      const selected = actions as string[];
      const wantsUpdate = selected.includes("update");
      const wantsBranch = selected.includes("branch") || Boolean(branchOverride);

      if (wantsBranch || !branch) {
        branch = await selectBranch(repo.url, branchOverride ?? branch ?? undefined);
      }

      if (wantsUpdate) {
        const mode = await chooseUpdateMode();
        if (mode === "reclone") {
          removeDir(targetDir);
          await cloneRepo(repo.url, branch ?? "main", targetDir);
          clonedAt = new Date().toISOString();
          appendHistory(`${repo.owner}/${repo.repo}`);
        } else {
          await pullRepo(targetDir, branch ?? "main");
        }
      } else {
        await checkoutBranch(targetDir, branch ?? "main");
      }
    } else {
      if (!branch) {
        branch = await selectBranch(repo.url, branchOverride);
      }
      await checkoutBranch(targetDir, branch ?? "main");
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

  await launchProvider(provider, targetDir);

  const updatedMeta = updateMetaAccess(meta, branch ?? "main");
  writeMeta(targetDir, updatedMeta);
}

function printUsage() {
  logLine(`${styles.title("gain")} ${styles.muted("<repo|query>")}`);
  logLine(`  ${styles.label("gain")} <url|org/name|query> [-p provider] [-b branch]`);
  logLine(`  ${styles.label("gain")} config --ttl 7d --dir ~/ai-scratch/gh -p claude`);
  logLine(`  ${styles.label("gain")} ls`);
  logLine(`  ${styles.label("gain")} remove`);
  logLine("");
  logLine(`Providers: ${Array.from(SUPPORTED_PROVIDERS).join(", ")}`);
}

async function main() {
  const { positional, options, help } = parseArgs(process.argv.slice(2));
  if (help || positional[0] === "help") {
    printUsage();
    process.exit(0);
  }
  if (positional.length === 0) {
    printUsage();
    process.exit(1);
  }

  let command = positional[0];
  if (!COMMANDS.has(command)) {
    command = "run";
  }

  try {
    await runGain(command, positional, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(message);
    process.exit(1);
  }
}

await main();
