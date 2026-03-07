# claude-tokenwise

Interactive cost-aware workflow for Claude Code. Like [commitizen](https://github.com/commitizen/cz-cli), but for AI token spend.

Arrow-key mode selection, automatic token estimation, and session tracking — no commands to memorize.

## Demo

```
$ cw

  cw — cost-aware Claude Code

? Prompt: fix the login bug

? Choose a mode
  > Quick   — Fast & minimal. Least tokens.
    Normal  — Balanced. Standard workflow.
    Deep    — Thorough & careful. Most tokens.

  Task: fix the login bug
  Mode: Quick

  [Claude's response here...]

──────────────────────────────────────────────────
  est. ~120 tokens | session total: ~450 tokens
```

## Install

```bash
npm install -g claude-cw
```

Or run directly:

```bash
npx claude-cw "fix the login bug"
```

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` CLI) to be installed.

## Usage

```bash
cw
```

The CLI will:
1. Ask you to pick a mode with arrow keys (Quick / Normal / Deep)
2. Send the task to Claude Code with mode-appropriate instructions
3. Show estimated token usage and running session total

## Modes

| Mode | Behavior | Token usage |
|---|---|---|
| **Quick** | Terse answers, no exploration, minimal tool calls | Lowest |
| **Normal** | Standard workflow, reads files, brief updates | Moderate |
| **Deep** | Reads everything, explains reasoning, runs tests | Highest |

## Session Tracking

Token estimates accumulate in `.claude/session.json`:

```json
{
  "startedAt": "2026-03-07T10:00:00.000Z",
  "totalEstimatedTokens": 1250,
  "tasks": [
    {
      "task": "fix the login bug",
      "mode": "quick",
      "timestamp": "2026-03-07T10:00:00.000Z",
      "estimatedTokens": 120
    }
  ]
}
```

## Advanced: CLAUDE.md integration

For users who prefer working inside Claude Code directly (without the wrapper CLI), copy `CLAUDE.md` into your project. It adds an interactive prompt flow that triggers automatically for every task.

Slash commands are also available in `.claude/commands/` for power users.

## License

MIT
