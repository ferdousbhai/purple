import { createNoReflectMethodRule } from "../shared/reflect-method.ts";

export const noReflectApplyRule = createNoReflectMethodRule(
  "apply",
  "Disallow Reflect.apply; call typed functions directly or model dynamic dispatch behind an interface.",
  "Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.",
);
