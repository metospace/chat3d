// Stop stalled work; there is no per-task budget or application output cap.
export const AGENT_LIMITS = { noProgressTurns: 4, consecutiveErrorTurns: 3, idleTimeoutMs: 180_000 } as const;
// Only the first response-body bytes have this deadline, not the full stream.
export const FIRST_BODY_DATA_TIMEOUT_MS=120_000;
