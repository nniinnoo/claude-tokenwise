# claude-tokenwise (ctw)

It's easy to burn through a Claude Code context window without realizing it. `ctw` is an interactive wrapper around `claude` with a mode picker, session manager, and token tracker to keep usage visible as you work.

## Demo

![ctw demo](https://raw.githubusercontent.com/nniinnoo/claude-tokenwise/main/ctw-demo.gif)

![ctw demo 2](https://raw.githubusercontent.com/nniinnoo/claude-tokenwise/main/ctw-demo-2.gif)

## Installation

```bash
npm install -g claude-tokenwise-cli
```

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` CLI) installed and authenticated.

Or run without installing:

```bash
npx claude-tokenwise-cli
```

## Usage

```bash
ctw          # Start or resume a session
ctw -h       # Open session manager
```

### Built-in keywords (in the prompt loop)

| Keyword | Action |
|---|---|
| `ctwhelp` | Show available keywords |
| `ctwcost` | Show session token stats |
| `ctwmodel` | Show/change model |
| `ctwmode` | Set a default mode (skip picker) |
| `ctwclear` | Fresh Claude context, keep session |
| `ctwhistory` | Open session manager mid-session |
| `ctwquit` or `quitctw` | Exit without saving the prompt |

Tab autocomplete is available — start typing `ctw` and press `Tab`.

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
After each response, `ctw` silently runs `/context` inside the same Claude session and parses the actual reported usage (e.g. `6.2k / 200k (3%)`). This is exact, because Claude itself reports it. It reflects the full window: system prompt, tools, memory files, messages, and free space.

The running **total** (`total: ~Y tokens`) accumulates the response estimates across all prompts in the session, useful for a rough sense of session cost over time, even though the context window figure is more accurate per-request.

## Model + Mode Comparison

**Quick** = max brevity, skip explanations | **Normal** = standard workflow | **Deep** = thorough, explain reasoning

Prompt used:

```
Refactor this JavaScript function to use async/await instead of callbacks,
add error handling, and explain your changes:

function fetchData(url, callback) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.onload = function() { callback(null, JSON.parse(xhr.responseText)); };
  xhr.onerror = function() { callback(new Error('Failed')); };
  xhr.send();
}
```

| Model | Quick | Normal | Deep |
|---|---|---|---|
| **Haiku 4.5** | 6.2s · ~190 tokens | 7.1s · ~400 tokens | 9.7s · ~620 tokens |
| **Sonnet 4.6** | 6.0s · ~100 tokens | 9.1s · ~280 tokens | 15.7s · ~610 tokens |
| **Opus 4.6** | 4.8s · ~100 tokens | 7.1s · ~270 tokens | 20.7s · ~920 tokens |

Switch models with `ctwmodel`. Effort level (low/medium/high) available for Sonnet and Opus.

## License

MIT

