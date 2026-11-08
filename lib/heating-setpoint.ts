/** Shared setpoint bounds — safe for client and server. */

export const SETPOINT_MIN_C = 5;
export const SETPOINT_MAX_C = 30;
export const SETPOINT_STEP_C = 0.5;

export function clampSetpointC(celsius: number): number {
  const stepped = Math.round(celsius / SETPOINT_STEP_C) * SETPOINT_STEP_C;
  const clamped = Math.min(SETPOINT_MAX_C, Math.max(SETPOINT_MIN_C, stepped));
  return Math.round(clamped * 10) / 10;
}
