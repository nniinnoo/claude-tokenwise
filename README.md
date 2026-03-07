# claude-tokenwise (cw)

It's easy to burn through a Claude Code context window without realizing it. `cw` is an interactive wrapper around `claude` with a mode picker, session manager, and token tracker to keep usage visible as you work.

## Installation

```bash
npm install -g claude-cw
```

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` CLI) installed and authenticated.

Or run without installing:

```bash
npx claude-cw
```

## Usage

```bash
cw          # Start or resume a session
cw -h       # Open session manager
```

### Built-in keywords (in the prompt loop)

| Keyword | Action |
|---|---|
| `cwhistory` | Open session manager mid-session |
| `cwquit` or `quitcw` | Exit without saving the prompt |

Tab autocomplete is available — start typing `cw` and press `Tab`.

## Session Modes

Pick a mode each prompt to influence how Claude approaches the task:

| Mode | Behavior | Token cost |
|---|---|---|
| **Quick** | Direct, minimal — avoids tangents and unnecessary reads | Lowest |
| **Normal** | Standard workflow — reads relevant files, gives brief updates | Moderate |
| **Deep** | Thorough — full file reads, explains reasoning, runs tests if available | Highest |

## Token Tracking

**1. Response estimate** (`est. ~X tokens`)  
Calculated from response character count using Anthropic's rough rule of thumb: `characters ÷ 3.5`. This is an intentional approximation. It only covers output text and does not include input tokens, system prompt, CLAUDE.md, or tool call overhead. The actual formula in `lib/tracker.js`:

```js
Math.round(text.length / 3.5 / 10) * 10
```

**Why it fluctuates:** tokenization isn't linear. Common English words are often 1 token each; rare or technical terms get split into sub-tokens; code, whitespace, and punctuation follow entirely different patterns. Treat the estimate as a directional signal, not an exact count.

**2. Context window usage** (`context: X / 200k`)  
After each response, `cw` silently runs `/context` inside the same Claude session and parses the actual reported usage (e.g. `6.2k / 200k (3%)`). This is exact, because Claude itself reports it. It reflects the full window: system prompt, tools, memory files, messages, and free space.

The running **total** (`total: ~Y tokens`) accumulates the response estimates across all prompts in the session, useful for a rough sense of session cost over time, even though the context window figure is more accurate per-request.

## License

MIT

