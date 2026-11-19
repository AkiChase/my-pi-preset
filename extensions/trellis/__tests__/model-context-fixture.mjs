const histories = new WeakMap();

/** Fake host boundary: persist a returned ordinary message, not copied product logic. */
export function captureModelContext(name, handler, messages) {
  if (name !== 'before_agent_start') return handler;
  return async (event, ctx) => {
    let branch = histories.get(ctx.sessionManager);
    if (!branch) { branch = []; histories.set(ctx.sessionManager, branch); }
    ctx.sessionManager.getBranch ??= () => branch;
    const result = await handler(event, ctx);
    if (result?.message) {
      messages.push(result.message);
      branch.push({ type: 'custom_message', id: String(branch.length + 1), parentId: branch.at(-1)?.id ?? null,
        timestamp: new Date().toISOString(), ...result.message });
    }
    return result;
  };
}
