const WRITE_ACTIONS = new Set([
  "",
  "initialize",
  "device-binding",
  "managed-device-setup",
  "device-role-update",
  "device-command",
  "device-revoke",
  "design-policy",
  "reset-data",
]);

/**
 * Only mutations that alter shared exam or managed-device state consume the
 * global write slot. Heartbeats and all read/poll endpoints remain immediate.
 */
export function shouldThrottleWrite(
  method: string | undefined,
  action: string,
): boolean {
  return method === "POST" && WRITE_ACTIONS.has(action);
}
