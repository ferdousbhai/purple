export const DEFAULT_TRANSITION_CYCLES = 8;
export const TRANSITION_CYCLE_OPTIONS = [4, 8, 16] as const;

const MIN_TRANSITION_LEAD_CYCLES = 0.25;

export function getTransitionStartCycle(currentCycle: number): number {
  assertFiniteNumber(currentCycle, "current cycle");
  return Math.ceil(currentCycle + MIN_TRANSITION_LEAD_CYCLES);
}

export function buildTransitionCode(
  fromCode: string,
  toCode: string,
  startCycle: number,
  durationCycles: number,
): string {
  const from = fromCode.trim();
  const to = toCode.trim();
  if (!from || !to) throw new Error("Both transition patterns are required.");

  assertFiniteNumber(startCycle, "transition start");
  assertFiniteNumber(durationCycles, "transition duration");
  if (durationCycles <= 0) {
    throw new Error("Transition duration must be greater than zero.");
  }

  return `xfade(
  (
${indent(from, 4)}
  ),
  signal((cycle) => Math.max(0, Math.min(1, (cycle - ${startCycle}) / ${durationCycles}))),
  (
${indent(to, 4)}
  )
)`;
}

function indent(code: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`Invalid ${label}.`);
}
