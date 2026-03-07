# Benchmark Report — Compare All Results

Show a comparison of all benchmarked tasks.

## Steps:

1. Read `.claude/benchmarks.json`. If it doesn't exist or is empty, say: "No benchmarks recorded yet. Use `/benchmark-start` before a task."

2. Display ALL completed benchmarks in a table:

   ```
   # | Task                  | Mode   | Tokens    | Cost     | Date
   --|----------------------|--------|-----------|----------|------------
   1 | fix login bug         | none   | 45,000    | $0.12    | 2025-03-07
   2 | fix login bug         | light  | 12,000    | $0.03    | 2025-03-07
   3 | refactor auth         | deep   | 120,000   | $0.35    | 2025-03-08
   ```

3. If there are benchmarks with the **same task description but different modes**, highlight the comparison:

   ```
   COMPARISON — "fix login bug":
   - none:  45,000 tokens / $0.12
   - light: 12,000 tokens / $0.03
   - Savings: 73% fewer tokens, $0.09 saved
   ```

4. Show overall stats:
   - Total benchmarks recorded
   - Average tokens per mode (light vs normal vs deep)
   - Most efficient mode overall

5. If there are any `"in_progress"` benchmarks, list them: "In progress: #[id] — [task]. Run `/benchmark-end` to complete."
