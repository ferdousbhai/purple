import { describe, expect, it, vi } from "vitest";
import { attemptWithRepair, MAX_RETRIES, type RepairDeps } from "./patternRepair";
import type { EvalResult } from "../../shared/types";

const OK: EvalResult = { ok: true };

function evaluationError(error: string): EvalResult {
  return { ok: false, kind: "evaluation", error };
}

function createDeps(overrides: Partial<RepairDeps> = {}): RepairDeps {
  return {
    attempt: vi.fn().mockResolvedValue(OK),
    isGeneratedPattern: () => true,
    requestFix: vi.fn().mockResolvedValue("fixed()"),
    applyFix: vi.fn(),
    isStale: () => false,
    isStopped: () => false,
    ...overrides,
  };
}

describe("attemptWithRepair", () => {
  it("returns the first result when the pattern evaluates", async () => {
    const deps = createDeps();

    const outcome = await attemptWithRepair("s(\"bd\")", deps);

    expect(outcome).toEqual({ result: OK, code: 's("bd")' });
    expect(deps.requestFix).not.toHaveBeenCalled();
  });

  it("replays the fixed pattern after an evaluation failure", async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce(evaluationError("bad note"))
      .mockResolvedValueOnce(OK);
    const deps = createDeps({ attempt });

    const outcome = await attemptWithRepair("broken()", deps);

    expect(outcome).toEqual({ result: OK, code: "fixed()" });
    expect(deps.requestFix).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.requestFix).mock.calls[0][0]).toContain("bad note");
    expect(vi.mocked(deps.requestFix).mock.calls[0][0]).toContain("broken()");
    expect(deps.applyFix).toHaveBeenCalledExactlyOnceWith("fixed()");
    expect(attempt).toHaveBeenNthCalledWith(2, "fixed()");
  });

  it("stops after MAX_RETRIES fixes", async () => {
    const attempt = vi.fn().mockResolvedValue(evaluationError("still broken"));
    const deps = createDeps({ attempt });

    const outcome = await attemptWithRepair("broken()", deps);

    expect(outcome.result).toEqual(evaluationError("still broken"));
    expect(deps.requestFix).toHaveBeenCalledTimes(MAX_RETRIES);
    expect(attempt).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it("does not repair hand-edited code", async () => {
    const attempt = vi.fn().mockResolvedValue(evaluationError("typo"));
    const deps = createDeps({ attempt, isGeneratedPattern: () => false });

    const outcome = await attemptWithRepair("edited()", deps);

    expect(outcome.result).toEqual(evaluationError("typo"));
    expect(deps.requestFix).not.toHaveBeenCalled();
  });

  it("does not repair audio activation failures", async () => {
    const result: EvalResult = { ok: false, kind: "audio", error: "blocked" };
    const deps = createDeps({ attempt: vi.fn().mockResolvedValue(result) });

    const outcome = await attemptWithRepair("s(\"bd\")", deps);

    expect(outcome.result).toEqual(result);
    expect(deps.requestFix).not.toHaveBeenCalled();
  });

  it("does not repair cancelled attempts", async () => {
    const result: EvalResult = { ok: false, kind: "cancelled" };
    const deps = createDeps({ attempt: vi.fn().mockResolvedValue(result) });

    const outcome = await attemptWithRepair("s(\"bd\")", deps);

    expect(outcome.result).toEqual(result);
    expect(deps.requestFix).not.toHaveBeenCalled();
  });

  it("gives up when the model returns no pattern", async () => {
    const attempt = vi.fn().mockResolvedValue(evaluationError("broken"));
    const deps = createDeps({
      attempt,
      requestFix: vi.fn().mockResolvedValue(null),
    });

    await attemptWithRepair("broken()", deps);

    expect(deps.applyFix).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledOnce();
  });

  it("discards the fix when a newer prompt replaced the pattern", async () => {
    const attempt = vi.fn().mockResolvedValue(evaluationError("broken"));
    const deps = createDeps({ attempt, isStale: () => true });

    const outcome = await attemptWithRepair("broken()", deps);

    expect(deps.applyFix).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledOnce();
    expect(outcome.code).toBe("broken()");
  });

  it("keeps the fix in the editor but does not replay after a stop", async () => {
    const attempt = vi.fn().mockResolvedValue(evaluationError("broken"));
    const deps = createDeps({ attempt, isStopped: () => true });

    const outcome = await attemptWithRepair("broken()", deps);

    expect(deps.applyFix).toHaveBeenCalledExactlyOnceWith("fixed()");
    expect(attempt).toHaveBeenCalledOnce();
    expect(outcome.code).toBe("fixed()");
    expect(outcome.result.ok).toBe(false);
  });
});
