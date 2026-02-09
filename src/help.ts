import kleur from "kleur";

const styles = {
  title: kleur.bold().magenta,
  muted: kleur.dim,
  label: kleur.bold().magenta,
  heading: kleur.bold,
};

type HelpRow = {
  value: string;
  description: string;
};

type UsageRow = {
  value: string;
  description: string;
  options?: HelpRow[];
};

type CommandHelp = {
  summary: string;
  usage: UsageRow[];
  notes?: string[];
};

type CommandHelpPrintOptions = {
  detailed?: boolean;
};

const commandHelp: Record<"pick" | "run" | "ls" | "remove" | "config", CommandHelp> = {
  pick: {
    summary: "Open local repos interactively",
    usage: [
      {
        value: "",
        description: "Pick a local repo and launch.",
      },
    ],
  },
  run: {
    summary: "Resolve a repo and launch",
    usage: [
      {
        value: "<org/repo>",
        description: "Open or clone a repo by exact org/repo.",
      },
      {
        value: "<url>",
        description: "Open or clone a repo from a full GitHub URL.",
      },
      {
        value: "<search>",
        description: "Search for a repo and launch default alias (for example: svelte).",
      },
      {
        value: "<org/repo> [-l <alias>] [-b <branch>] [-- <command>]",
        description: "Resolve or clone a repo with launch/branch overrides.",
        options: [
          {
            value: "[-l, --launch] <alias>",
            description: "Launch alias from config.launch.",
          },
          {
            value: "[-b, --branch] <branch>",
            description: "Clone or checkout a specific branch.",
          },
          {
            value: "[-- <command>]",
            description: "Override launch command for this run.",
          },
        ],
      },
    ],
    notes: [
      "Use exact org/repo, full GitHub URL, or a search string.",
    ],
  },
  ls: {
    summary: "List local and historical repos",
    usage: [
      {
        value: "ls",
        description: "Print available local repos and history entries.",
      },
    ],
  },
  remove: {
    summary: "Remove local repos",
    usage: [
      {
        value: "remove",
        description: "Select one or more local repos to remove.",
      },
    ],
  },
  config: {
    summary: "Open spoon config",
    usage: [
      {
        value: "config",
        description: "Open config file in your default app.",
      },
    ],
  },
};

export type HelpTarget = keyof typeof commandHelp;
export type NamedCommand = Exclude<HelpTarget, "pick" | "run">;

const namedCommands: readonly NamedCommand[] = ["ls", "remove", "config"];

function formatCommandValue(value: string): string {
  return value
    .split(" ")
    .map((token) => {
      if (token === "--help") {
        return styles.label(token);
      }
      if (token.startsWith("<") || token.startsWith("[") || token.startsWith("-")) {
        return styles.muted(token);
      }
      return styles.label(token);
    })
    .join(" ");
}

function printCommandRows(rows: HelpRow[], pad = 32): void {
  for (const row of rows) {
    const padding = " ".repeat(Math.max(2, pad - row.value.length));
    console.log(`  ${formatCommandValue(row.value)}${padding}${row.description}`);
  }
}

function printOptionRows(rows: HelpRow[], descriptionColumn: number): void {
  for (const row of rows) {
    const prefixIndent = 4;
    const prefixLen = prefixIndent + row.value.length;

    if (prefixLen >= descriptionColumn - 2) {
      console.log(`    ${formatCommandValue(row.value)}`);
      console.log(`${" ".repeat(descriptionColumn)}${styles.muted(row.description)}`);
      continue;
    }

    const padding = " ".repeat(Math.max(2, descriptionColumn - prefixLen));
    console.log(`    ${formatCommandValue(row.value)}${padding}${styles.muted(row.description)}`);
  }
}

function usagePrefix(value: string): string {
  if (!value) {
    return styles.label("spoon");
  }

  return `${styles.label("spoon")} ${formatCommandValue(value)}`;
}

function usageRaw(value: string): string {
  return value ? `spoon ${value}` : "spoon";
}

export function isHelpFlag(value?: string): boolean {
  return value === "-h" || value === "--help";
}

export function isNamedCommand(value?: string): value is NamedCommand {
  return Boolean(value && namedCommands.includes(value as NamedCommand));
}

export function resolveHelpTarget(value: string): HelpTarget | null {
  if (value in commandHelp) return value as HelpTarget;
  if (value === "interactive" || value === "spoon") return "pick";
  if (value === "options" || value === "repo" || value === "query" || value === "url") return "run";
  return null;
}

export function printMainHelp(): void {
  console.log(`${styles.title("spoon")} ${styles.muted("explore open source repos and dependencies with agents")}`);
  console.log("");
  console.log(styles.heading("Usage:"));
  printCommandRows([
    { value: "spoon", description: "Open a local repo interactively" },
    {
      value: "spoon <org/repo>",
      description: "Open by exact match or url",
    },
    {
      value: "spoon <search>",
      description: "Search github and interactively select",
    },
  ]);
  console.log("");
  printCommandRows([
    { value: "-l, --launch <alias>", description: "Launch alias from config.launch" },
    { value: "-b, --branch <branch>", description: "Clone or checkout a specific branch" },
    { value: "-- <command>", description: "Override launch command for this run" },
  ]);
  console.log("");
  console.log(styles.heading("Commands:"));
  printCommandRows([
    { value: "ls", description: "List available local repos and history" },
    { value: "remove", description: "Select local repos to remove" },
    { value: "config", description: "Open config file" },
  ]);
  console.log("");
  printCommandRows([
    {
      value: "<command> --help",
      description: "Print help text for command",
    },
  ]);
}

export function printCommandHelp(
  target: HelpTarget,
  printOptions: CommandHelpPrintOptions = {},
): void {
  const detailed = printOptions.detailed ?? true;
  const doc = commandHelp[target];
  const showDefaultOnly = !detailed && doc.usage.length > 1;
  const usageRows = showDefaultOnly
    ? [doc.usage[0] ?? { value: target, description: doc.summary }]
    : doc.usage;
  const noteRows = [...(doc.notes ?? [])];

  if (showDefaultOnly) {
    if (target === "run") {
      noteRows.push("Run `spoon <org/repo> --help` to see additional usage forms.");
    } else {
      noteRows.push(`Run \`spoon ${target} --help\` to see additional usage forms.`);
    }
  }

  const headerLabel =
    target === "pick"
      ? styles.label("spoon")
      : usagePrefix(usageRows[0]?.value ?? target);

  console.log(
    `${headerLabel} ${styles.muted("•")} ${styles.muted(doc.summary.toLowerCase())}`,
  );
  console.log("");

  console.log(styles.heading("Usage:"));
  const usageTextRows = usageRows.map((usageRow) => usageRaw(usageRow.value));
  const widestUsage = usageTextRows.reduce((max, usage) => Math.max(max, usage.length), 0);
  const usageColumn = Math.min(Math.max(30, widestUsage + 2), 66);
  const descriptionColumn = usageColumn + 2;

  usageRows.forEach((usageRow, index) => {
    const usageText = usageTextRows[index] ?? usageRaw(usageRow.value);
    const usagePrefixLen = 2 + usageText.length;

    if (usagePrefixLen >= descriptionColumn - 2) {
      console.log(`  ${usagePrefix(usageRow.value)}`);
      console.log(`${" ".repeat(descriptionColumn)}${usageRow.description}`);
    } else {
      const padding = " ".repeat(Math.max(2, descriptionColumn - usagePrefixLen));
      console.log(`  ${usagePrefix(usageRow.value)}${padding}${usageRow.description}`);
    }

    const optionRows: HelpRow[] = [...(usageRow.options ?? [])];
    if (optionRows.length > 0) {
      printOptionRows(optionRows, descriptionColumn);
    }
  });

  if (noteRows.length > 0) {
    console.log("");
    console.log("Notes:");
    for (const note of noteRows) {
      console.log(`  ${note}`);
    }
  }
}
