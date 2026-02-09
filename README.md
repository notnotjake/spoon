# spoon

`spoon` helps you explore open source repos and dependencies with agents.

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
| `spoon`                                               | Open a local repo interactively.                   |
| `spoon <org/repo>`                                    | Open by exact match.                               |
| `spoon <url>`                                         | Open by full GitHub URL.                           |
| `spoon <search>`                                      | Search GitHub and select interactively.            |
| `spoon <org/repo> [-l <alias>] [-b <branch>]`        | Open with launch alias and/or branch override.     |
| `spoon <org/repo> [-- <command...>]`                 | Override launch command for one run.               |
| `spoon ls`                                            | List local repos and history entries.              |
| `spoon remove`                                        | Interactively select local repos to remove.        |
| `spoon config`                                        | Open config file in your system default app.       |
| `spoon help [command]`                                | Show help.                                         |
| `spoon <command> --help`                              | Show command-specific help.                        |

### Open repos

**Open local repo interactively**

Description: Open a local repo from an interactive picker.

Syntax:

```bash
spoon
```

Example:

```bash
spoon
```

**Open by exact repo or URL**

Description: Open or clone directly using exact `org/repo` or full URL.

Syntax:

```bash
spoon <org/repo>
spoon <url>
```

Examples:

```bash
spoon sveltejs/kit
spoon https://github.com/sveltejs/svelte
```

**Search and select from GitHub**

Description: Search GitHub repos, then pick one interactively.

Syntax:

```bash
spoon <search>
```

Example:

```bash
spoon svelte
```

**Use launch, branch, and command overrides**

Description: Control how the selected repo is launched.

Syntax:

```bash
spoon <org/repo> -l <alias>
spoon <org/repo> -b <branch>
spoon <org/repo> -- <command...>
```

Examples:

```bash
spoon sveltejs/kit -l x
spoon sveltejs/kit -b next
spoon sveltejs/kit -- claude --continue
```

### Manage local repos

**List repos**

Description: Print locally available repos and historical repos no longer present.

Syntax:

```bash
spoon ls
```

Example:

```bash
spoon ls
```

**Remove repos**

Description: Interactively select one or more local repos to remove.

Syntax:

```bash
spoon remove
```

Example:

```bash
spoon remove
```

**Open config**

Description: Open `spoon` config file in your default system app.

Syntax:

```bash
spoon config
```

Example:

```bash
spoon config
```

### Help

**Show help**

Description: Show global help or command-specific help.

Syntax:

```bash
spoon help [command]
spoon <command> --help
```

Example:

```bash
spoon ls --help
```

## Configuration

Config path:

```bash
~/.config/spoon/config.json
```

Example config:

```json
{
  "launch": {
    "c": "claude",
    "x": {
      "name": "Codex",
      "command": "codex"
    },
    "t": {
      "name": "AI Tmux",
      "command": "tmux new -A -s ai && claude"
    }
  },
  "ttlMs": 1209600000,
  "baseDir": "~/ai-scratch/gh"
}
```

Notes:

- Default launch alias is the first key in `launch`.
- Launch entries support both `alias: command` and `alias: { "name": "...", "command": "..." }`.
- For `alias: command`, the launch name is inferred from the command (for example, `"x": "codex"` shows `Codex`).
- Repos are purged by TTL on invocation after local repo count grows (10+ repos).

## License

MIT
