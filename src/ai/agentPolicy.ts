// Stop stalled work; there is no per-task budget or application output cap.
export const AGENT_LIMITS = { noProgressTurns: 4, consecutiveErrorTurns: 3, idleTimeoutMs: 180_000 } as const;
