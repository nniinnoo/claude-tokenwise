# Task Complexity Assessment

Before starting work, assess the task the user just described.

## Steps:

1. **Categorize complexity** as one of:
   - **Light** — Simple lookup, small edit, quick answer, single-file change. Estimated tokens: low.
   - **Medium** — Multi-file edits, moderate logic, some research needed. Estimated tokens: moderate.
   - **Heavy** — Architecture changes, deep debugging, multi-system work, large refactors. Estimated tokens: high.

2. **Recommend a model** based on complexity:
   - **Light** → Suggest: "This is a light task. Consider switching to Haiku with `/model` to save tokens."
   - **Medium** → Suggest: "Medium complexity. Sonnet is a good fit. Use `/model` to switch if needed."
   - **Heavy** → Suggest: "This is complex. Opus is recommended for accuracy. Stay on current model if already Opus."

3. **Show the assessment** in this format:
   ```
   Complexity: [Light / Medium / Heavy]
   Recommended model: [Haiku / Sonnet / Opus]
   Reason: [1 sentence why]
   Tip: Check /cost before and after to track spend.
   ```

4. **Wait for user confirmation** before starting the task. Ask: "Want me to proceed, or switch model first?"
