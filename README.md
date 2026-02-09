# gain

`gain` helps you explore open source repos and dependencies with agents.

It removes friction from finding a repo, cloning or opening it, and launching your preferred agent CLI in the project immediately.

## Why use it

- Fast interactive repo selection from local clones.
- Search GitHub and pick a repo with fuzzy selection.
- Open exact repos directly with `org/repo` or full URL.
- Launch with configurable aliases (`claude`, `codex`, custom commands).
- Keep your local cache clean with TTL-based purge.

## Install

Requirements:

- [bun](https://bun.sh)
- [fzf](https://github.com/junegunn/fzf)
- [GitHub CLI](https://cli.github.com) (`gh`)
- Agent CLI commands you want to launch (`claude`, `codex`, wrappers, etc.)

```bash
bun install
bun link
```

## Command Reference

| Command                                              | Description                                        |
| ---------------------------------------------------- | -------------------------------------------------- |
| `gain`                                               | Open a local repo interactively.                   |
| `gain <org/repo>`                                    | Open by exact match.                               |
| `gain <url>`                                         | Open by full GitHub URL.                           |
| `gain <search>`                                      | Search GitHub and select interactively.            |
| `gain <org/repo> [-l <alias>] [-b <branch>]`        | Open with launch alias and/or branch override.     |
| `gain <org/repo> [-- <command...>]`                 | Override launch command for one run.               |
| `gain ls`                                            | List local repos and history entries.              |
| `gain remove`                                        | Interactively select local repos to remove.        |
| `gain config`                                        | Open config file in your system default app.       |
| `gain help [command]`                                | Show help.                                         |
| `gain <command> --help`                              | Show command-specific help.                        |

### Open repos

**Open local repo interactively**

Description: Open a local repo from an interactive picker.

Syntax:

```bash
gain
```

Example:

```bash
gain
```

**Open by exact repo or URL**

Description: Open or clone directly using exact `org/repo` or full URL.

Syntax:

```bash
gain <org/repo>
gain <url>
```

Examples:

```bash
gain sveltejs/kit
gain https://github.com/sveltejs/svelte
```

**Search and select from GitHub**

Description: Search GitHub repos, then pick one interactively.

Syntax:

```bash
gain <search>
```

Example:

```bash
gain svelte
```

**Use launch, branch, and command overrides**

Description: Control how the selected repo is launched.

Syntax:

```bash
gain <org/repo> -l <alias>
gain <org/repo> -b <branch>
gain <org/repo> -- <command...>
```

Examples:

```bash
gain sveltejs/kit -l x
gain sveltejs/kit -b next
gain sveltejs/kit -- claude --continue
```

### Manage local repos

**List repos**

Description: Print locally available repos and historical repos no longer present.

Syntax:

```bash
gain ls
```

Example:

```bash
gain ls
```

**Remove repos**

Description: Interactively select one or more local repos to remove.

Syntax:

```bash
gain remove
```

Example:

```bash
gain remove
```

**Open config**

Description: Open `gain` config file in your default system app.

Syntax:

```bash
gain config
```

Example:

```bash
gain config
```

### Help

**Show help**

Description: Show global help or command-specific help.

Syntax:

```bash
gain help [command]
gain <command> --help
```

Example:

```bash
gain ls --help
```

## Configuration

Config path:

```bash
~/.config/gain/config.json
```

Example config:

```json
{
  "launch": {
    "c": "claude",
    "x": "codex",
    "t": "tmux new -A -s ai && claude"
  },
  "ttlMs": 1209600000,
  "baseDir": "~/ai-scratch/gh"
}
```

Notes:

- Default launch alias is the first key in `launch`.
- Repos are purged by TTL on invocation after local repo count grows (10+ repos).

## License

MIT
