# gain

Clone any GitHub repo and instantly start an AI chat session to explore and ask questions about the code.

## Install

```bash
bun install -g .
```

### Requirements

- [Bun](https://bun.sh)
- [fzf](https://github.com/junegunn/fzf) - for interactive selection
- [GitHub CLI](https://cli.github.com) (`gh`) - for repo search
- Any AI CLI command you want to launch (`claude`, `codex`, custom wrappers, etc.)

## Usage

```bash
# Open a local repo from an interactive picker
gain

# Clone by URL
gain https://github.com/facebook/react

# Clone by org/name
gain facebook/react

# Search for a repo
gain zustand
```

Once cloned, gain launches a command in the repo directory so you can immediately start asking questions about the codebase.

### Options

```
-l, --launch <alias>    Launch alias from config.launch
-b, --branch <name>     Clone/checkout a specific branch
-- <command...>         Override launch command for this run
```

### Commands

```bash
gain                    # Pick a local repo and launch into it
gain config             # Open config in your system default app
gain config --check     # Validate config readability

gain ls                 # List cloned repos
gain remove             # Interactively select repos to remove
```

Repos past their TTL are automatically purged once you have 10+ repos.

## How it works

1. Accepts a GitHub URL, `org/name` shorthand, or search query
2. If searching, uses `gh` and `fzf` to let you pick from results
3. Prompts for branch selection via `fzf`
4. Clones to `~/ai-scratch/gh/<org>/<repo>` (configurable)
5. Launches the selected command in that directory
6. Tracks access times and auto-purges old repos

## Configuration

Config is stored at `~/.config/gain/config.json`:

```json
{
  "launch": {
    "c": "claude",
    "x": "codex",
    "t": "tmux new -A -s ai && claude"
  },
  "ttlMs": 604800000,
  "baseDir": "~/ai-scratch/gh"
}
```

Default launch alias is the first key in `launch`.

Select an alias at runtime:

```bash
gain -l c
gain react -l x
```

Override with an arbitrary command for one run:

```bash
gain -- codex
gain react -- claude --continue
```

## License

MIT
