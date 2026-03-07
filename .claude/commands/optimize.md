# Optimize — Review Current Approach

Pause and evaluate whether the current model and approach are cost-efficient.

## Steps:

1. **Assess remaining work**:
   - What's left to do?
   - How complex is the remaining work?

2. **Recommend adjustment** if needed:
   - If remaining work is simple → "Remaining tasks are light. Consider switching to Haiku via `/model`."
   - If remaining work is complex → "Stay on current model. The complexity warrants it."
   - If the task is done → "Task complete. Run `/cost` to see total spend."

3. **Suggest workflow improvements**:
   - Could parallel tool calls reduce back-and-forth?
   - Are there unnecessary file reads that could be skipped?
   - Can the remaining work be batched into fewer steps?

Show the recommendation concisely and wait for user input.
