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
- An AI CLI tool: `claude`, `opencode`, or `amp`

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

Once cloned, gain launches your configured AI CLI in the repo directory so you can immediately start asking questions about the codebase.

### Options

```
-p, --provider <name>   AI provider to use (claude, opencode, amp)
-b, --branch <name>     Clone/checkout a specific branch
```

### Commands

```bash
gain                    # Pick a local repo and launch into it
gain config             # Configure defaults
  --ttl <duration>      # Auto-cleanup after duration (e.g., 7d, 24h)
  --dir <path>          # Base directory for cloned repos
  -p, --provider <name> # Default AI provider

gain ls                 # List cloned repos
gain remove             # Interactively select repos to remove
```

Repos past their TTL are automatically purged once you have 10+ repos.

## How it works

1. Accepts a GitHub URL, `org/name` shorthand, or search query
2. If searching, uses `gh` and `fzf` to let you pick from results
3. Prompts for branch selection via `fzf`
4. Clones to `~/ai-scratch/gh/<org>/<repo>` (configurable)
5. Launches your AI CLI in that directory
6. Tracks access times and auto-purges old repos

## Configuration

Config is stored at `~/.config/gain/config.json`:

```json
{
  "provider": "claude",
  "ttlMs": 604800000,
  "baseDir": "~/ai-scratch/gh"
}
```

## License

MIT
