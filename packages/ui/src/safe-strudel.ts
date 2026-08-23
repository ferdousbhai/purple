/* eslint-disable anti-slop/no-known-value-widening, anti-slop/no-object-parameters, anti-slop/no-reflect-apply, anti-slop/no-reflect-get, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion */
// Acorn and Strudel are intentionally untyped runtime boundaries. This module
// validates every AST node, identifier, property and call before dispatch.
import {
  parse,
  type ArrayExpression,
  type ArrowFunctionExpression,
  type BinaryExpression,
  type CallExpression,
  type ConditionalExpression,
  type Expression,
  type ExpressionStatement,
  type Identifier,
  type Literal,
  type LogicalExpression,
  type MemberExpression,
  type Node,
  type Program,
  type TemplateLiteral,
  type UnaryExpression,
} from "acorn";

const MAX_SOURCE_LENGTH = 30_000;
const MAX_AST_NODES = 2_000;
const MAX_AST_DEPTH = 100;
const MAX_NUMBER_MAGNITUDE = 1_000_000;
const MAX_MINI_NUMBER_MAGNITUDE = 4_096;
const MAX_EVENT_MULTIPLIER = 512;

const EVENT_MULTIPLIER_CALLS = new Set([
  "chop",
  "density",
  "fast",
  "ply",
  "run",
  "segment",
]);

/**
 * Purple intentionally supports a focused Strudel expression language, not
 * arbitrary JavaScript. Every identifier below is supplied by @strudel/web;
 * browser and Tauri globals never enter the interpreter's scope.
 */
const SAFE_GLOBALS = new Set([
  "add",
  "arrange",
  "cat",
  "chord",
  "choose",
  "chooseCycles",
  "fast",
  "gain",
  "irand",
  "Math",
  "n",
  "note",
  "perlin",
  "ply",
  "rand",
  "rev",
  "run",
  "s",
  "saw",
  "saw2",
  "silence",
  "signal",
  "sine",
  "sine2",
  "slow",
  "sound",
  "square",
  "square2",
  "stack",
  "tri",
  "tri2",
  "xfade",
]);

/** Pattern methods documented in Purple's model prompt. Loading, debugging,
 * drawing, custom worklets and context-manipulation APIs are deliberately not
 * exposed. In particular, constructor/prototype access can never pass this
 * list. */
const SAFE_MEMBERS = new Set([
  "add",
  "adsr",
  "attack",
  "bank",
  "begin",
  "bpf",
  "chop",
  "clip",
  "coarse",
  "compressor",
  "cpm",
  "crush",
  "cut",
  "decay",
  "degradeBy",
  "delay",
  "delaytime",
  "density",
  "distort",
  "duckattack",
  "duckdepth",
  "duckorbit",
  "early",
  "echo",
  "end",
  "every",
  "fast",
  "firstOf",
  "fit",
  "fm",
  "fmh",
  "gain",
  "hpf",
  "iter",
  "jux",
  "juxBy",
  "lastOf",
  "late",
  "layer",
  "linger",
  "loop",
  "loopAt",
  "loopBegin",
  "loopEnd",
  "lpa",
  "lpd",
  "lpenv",
  "lpf",
  "lpq",
  "lps",
  "mask",
  "max",
  "min",
  "n",
  "noise",
  "note",
  "off",
  "often",
  "orbit",
  "palindrome",
  "pan",
  "pattack",
  "pdecay",
  "penv",
  "phaser",
  "ply",
  "rarely",
  "range",
  "release",
  "rev",
  "room",
  "roomsize",
  "rootNotes",
  "s",
  "scale",
  "scaleTranspose",
  "segment",
  "shape",
  "silence",
  "slice",
  "slow",
  "someCycles",
  "sometimes",
  "sometimesBy",
  "sound",
  "speed",
  "splice",
  "struct",
  "superimpose",
  "sustain",
  "swingBy",
  "transpose",
  "velocity",
  "vib",
  "voicing",
  "vowel",
  "when",
]);

export type SafeStrudelValue =
  | object
  | string
  | number
  | boolean
  | null
  | undefined;
export type SafeStrudelScope = Readonly<Record<string, SafeStrudelValue>>;

type Scope = SafeStrudelScope;
type Locals = ReadonlyMap<string, unknown>;

interface EvaluationBudget {
  eventMultiplier: number;
  nodes: number;
}

export class UnsafePatternError extends Error {
  constructor(message: string, node?: Node) {
    super(
      node
        ? `Pattern uses unsupported JavaScript near character ${node.start}: ${message}`
        : message,
    );
    this.name = "UnsafePatternError";
  }
}

/** Parse and interpret one safe Strudel expression without eval or Function. */
export function evaluateSafeStrudelExpression(
  source: string,
  scope: Scope,
): SafeStrudelValue {
  if (!source.trim()) throw new UnsafePatternError("Pattern is empty.");
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new UnsafePatternError(
      `Pattern is too large (${source.length} characters; maximum ${MAX_SOURCE_LENGTH}).`,
    );
  }

  let program: Program;
  try {
    program = parse(source, {
      ecmaVersion: 2022,
      sourceType: "script",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UnsafePatternError(`Pattern syntax is invalid: ${message}`);
  }

  if (
    program.body.length !== 1 ||
    program.body[0]?.type !== "ExpressionStatement"
  ) {
    throw new UnsafePatternError(
      "Use one Strudel expression only; statements and declarations are not allowed.",
    );
  }

  const expression = (program.body[0] as ExpressionStatement).expression;
  const budget: EvaluationBudget = { eventMultiplier: 1, nodes: 0 };
  return interpret(
    expression,
    scope,
    new Map(),
    budget,
    0,
    source,
  ) as SafeStrudelValue;
}

/** Copy only the allowlisted Strudel bindings into an immutable scope. */
export function createSafeStrudelScope(source: object): SafeStrudelScope {
  const sourceValues = source as Record<string, SafeStrudelValue>;
  const result: Record<string, SafeStrudelValue> = Object.create(null) as Record<
    string,
    SafeStrudelValue
  >;
  for (const name of [...SAFE_GLOBALS, "m"]) result[name] = sourceValues[name];
  result.Math = Object.freeze({ max: Math.max, min: Math.min });
  return Object.freeze(result);
}

function interpret(
  node: Expression | Literal,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_AST_NODES || depth > MAX_AST_DEPTH) {
    throw new UnsafePatternError("Pattern is too complex.", node);
  }

  const nextDepth = depth + 1;
  switch (node.type) {
    case "Literal":
      return interpretLiteral(node, scope, budget, source);
    case "TemplateLiteral":
      return interpretTemplate(node, scope, budget);
    case "Identifier":
      return resolveIdentifier(node, scope, locals);
    case "ArrayExpression":
      return interpretArray(node, scope, locals, budget, nextDepth, source);
    case "ArrowFunctionExpression":
      return interpretArrow(node, scope, locals, budget, nextDepth, source);
    case "MemberExpression":
      return resolveMember(node, scope, locals, budget, nextDepth, source).value;
    case "CallExpression":
      return interpretCall(node, scope, locals, budget, nextDepth, source);
    case "UnaryExpression":
      return interpretUnary(node, scope, locals, budget, nextDepth, source);
    case "BinaryExpression":
      return interpretBinary(node, scope, locals, budget, nextDepth, source);
    case "LogicalExpression":
      return interpretLogical(node, scope, locals, budget, nextDepth, source);
    case "ConditionalExpression":
      return interpretConditional(
        node,
        scope,
        locals,
        budget,
        nextDepth,
        source,
      );
    default:
      throw new UnsafePatternError(
        `${node.type} is not part of Purple's Strudel expression language.`,
        node,
      );
  }
}

function interpretLiteral(
  node: Literal,
  scope: Scope,
  budget: EvaluationBudget,
  source: string,
): unknown {
  if (node.regex || node.bigint || typeof node.value === "bigint") {
    throw new UnsafePatternError("Regular expressions and big integers are not allowed.", node);
  }
  if (typeof node.value === "number") return checkedNumber(node.value, node);
  if (typeof node.value !== "string") return node.value;

  // Match Strudel's transpiler: double-quoted strings are mini-notation with
  // source locations; single-quoted strings remain ordinary scalar values.
  if (source[node.start] !== '"') return node.value;
  return callMini(scope, node.value, node.start, node, budget);
}

function interpretTemplate(
  node: TemplateLiteral,
  scope: Scope,
  budget: EvaluationBudget,
): unknown {
  if (node.expressions.length !== 0 || node.quasis.length !== 1) {
    throw new UnsafePatternError("Template interpolation is not allowed.", node);
  }
  const value = node.quasis[0]?.value.cooked;
  if (value == null) {
    throw new UnsafePatternError("Template string is invalid.", node);
  }
  return callMini(scope, value, node.start, node, budget);
}

function callMini(
  scope: Scope,
  value: string,
  offset: number,
  node: Node,
  budget: EvaluationBudget,
): unknown {
  for (const match of value.matchAll(/\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)) {
    const number = Number(match[0]);
    if (!Number.isFinite(number) || number > MAX_MINI_NUMBER_MAGNITUDE) {
      throw new UnsafePatternError(
        `Mini-notation numbers may not exceed ${MAX_MINI_NUMBER_MAGNITUDE}.`,
        node,
      );
    }
  }
  for (const match of value.matchAll(/[*!]\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi)) {
    consumeEventMultiplier(
      budget,
      Number(match[1]),
      node,
      "Mini-notation repetition",
    );
  }
  const mini = scope.m;
  if (typeof mini !== "function") {
    throw new UnsafePatternError("Strudel mini-notation is unavailable.", node);
  }
  return Reflect.apply(mini, undefined, [value, offset]);
}

function resolveIdentifier(
  node: Identifier,
  scope: Scope,
  locals: Locals,
): unknown {
  if (locals.has(node.name)) return locals.get(node.name);
  if (!SAFE_GLOBALS.has(node.name)) {
    throw new UnsafePatternError(`Identifier "${node.name}" is not allowed.`, node);
  }
  const value = scope[node.name];
  if (value === undefined) {
    throw new UnsafePatternError(`Strudel function "${node.name}" is unavailable.`, node);
  }
  return value;
}

function interpretArray(
  node: ArrayExpression,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
): unknown[] {
  return node.elements.map((element) => {
    if (!element || element.type === "SpreadElement") {
      throw new UnsafePatternError("Array holes and spread syntax are not allowed.", node);
    }
    return interpret(element, scope, locals, budget, depth, source);
  });
}

function interpretArrow(
  node: ArrowFunctionExpression,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
): (...args: unknown[]) => unknown {
  if (node.async || node.generator || node.body.type === "BlockStatement") {
    throw new UnsafePatternError(
      "Only concise synchronous arrow functions are allowed.",
      node,
    );
  }
  const names = node.params.map((parameter) => {
    if (parameter.type !== "Identifier") {
      throw new UnsafePatternError("Arrow parameters must be simple names.", parameter);
    }
    return parameter.name;
  });
  if (new Set(names).size !== names.length) {
    throw new UnsafePatternError("Arrow parameter names must be unique.", node);
  }
  const body = node.body as Expression;
  const inheritedEventMultiplier = budget.eventMultiplier;

  return (...args: unknown[]) => {
    const nested = new Map(locals);
    names.forEach((name, index) => nested.set(name, args[index]));
    // Transform callbacks may run for every queried event. Their complexity
    // budget is per invocation rather than being depleted by normal playback.
    return interpret(
      body,
      scope,
      nested,
      { eventMultiplier: inheritedEventMultiplier, nodes: 0 },
      depth,
      source,
    );
  };
}

function resolveMember(
  node: MemberExpression,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
): { owner: object; value: unknown } {
  if (
    node.computed ||
    node.optional ||
    node.property.type !== "Identifier" ||
    !SAFE_MEMBERS.has(node.property.name)
  ) {
    throw new UnsafePatternError("This property is not an allowed Strudel method.", node);
  }
  if (node.object.type === "Super") {
    throw new UnsafePatternError("super is not allowed.", node);
  }
  const owner = interpret(node.object, scope, locals, budget, depth, source);
  if ((typeof owner !== "object" || owner === null) && typeof owner !== "function") {
    throw new UnsafePatternError(
      `Cannot call .${node.property.name} on this value.`,
      node,
    );
  }
  const objectOwner = owner as object;
  return {
    owner: objectOwner,
    value: Reflect.get(objectOwner, node.property.name),
  };
}

function interpretCall(
  node: CallExpression,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
): unknown {
  if (node.optional || node.callee.type === "Super") {
    throw new UnsafePatternError("Optional calls and super are not allowed.", node);
  }

  let callable: unknown;
  let owner: object | undefined;
  if (node.callee.type === "MemberExpression") {
    const member = resolveMember(
      node.callee,
      scope,
      locals,
      budget,
      depth,
      source,
    );
    callable = member.value;
    owner = member.owner;
  } else if (node.callee.type === "Identifier") {
    callable = resolveIdentifier(node.callee, scope, locals);
  } else {
    throw new UnsafePatternError(
      "Only named Strudel functions and documented pattern methods may be called.",
      node.callee,
    );
  }

  const callName =
    node.callee.type === "Identifier"
      ? node.callee.name
      : node.callee.property.type === "Identifier"
        ? node.callee.property.name
        : undefined;
  const args = interpretCallArguments(
    node,
    scope,
    locals,
    budget,
    depth,
    source,
    callName === "xfade",
  );

  if (typeof callable !== "function") {
    throw new UnsafePatternError("The selected Strudel value is not callable.", node);
  }
  if (callName && EVENT_MULTIPLIER_CALLS.has(callName)) {
    consumeEventMultiplier(
      budget,
      eventMultiplierArgument(args[0], node.arguments[0], node),
      node,
      `${callName}()`,
    );
  }
  return Reflect.apply(callable, owner, args);
}

function interpretCallArguments(
  node: CallExpression,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
  independentBranches: boolean,
): unknown[] {
  const inheritedEventMultiplier = budget.eventMultiplier;
  let largestBranchMultiplier = inheritedEventMultiplier;

  const args = node.arguments.map((argument) => {
    if (argument.type === "SpreadElement") {
      throw new UnsafePatternError("Spread arguments are not allowed.", argument);
    }

    if (!independentBranches) {
      return interpret(argument, scope, locals, budget, depth, source);
    }

    // xfade queries its two patterns in parallel. Multiplying one branch's
    // repetition budget into the other rejects two patterns that each passed
    // the same safety check on their own. Keep each branch independent, then
    // carry the largest branch forward so a transform chained after xfade is
    // still checked against the full per-branch multiplier.
    const branchBudget: EvaluationBudget = {
      eventMultiplier: inheritedEventMultiplier,
      nodes: budget.nodes,
    };
    const value = interpret(
      argument,
      scope,
      locals,
      branchBudget,
      depth,
      source,
    );
    budget.nodes = branchBudget.nodes;
    largestBranchMultiplier = Math.max(
      largestBranchMultiplier,
      branchBudget.eventMultiplier,
    );
    return value;
  });

  if (independentBranches) {
    budget.eventMultiplier = largestBranchMultiplier;
  }
  return args;
}

function eventMultiplierArgument(
  value: unknown,
  argument: CallExpression["arguments"][number] | undefined,
  node: Node,
): number {
  if (typeof value === "number") return value;
  if (!argument || argument.type === "SpreadElement") {
    throw new UnsafePatternError(
      "Event-expanding calls require a bounded numeric first argument.",
      node,
    );
  }

  const sourceValue =
    argument.type === "Literal" && typeof argument.value === "string"
      ? argument.value
      : argument.type === "TemplateLiteral" &&
          argument.expressions.length === 0 &&
          argument.quasis.length === 1
        ? argument.quasis[0]?.value.cooked
        : undefined;
  const numbers = sourceValue?.match(
    /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi,
  );
  if (!numbers?.length) {
    throw new UnsafePatternError(
      "Event-expanding calls require a bounded numeric first argument.",
      node,
    );
  }
  return Math.max(...numbers.map((number) => Math.abs(Number(number))));
}

function consumeEventMultiplier(
  budget: EvaluationBudget,
  factor: number,
  node: Node,
  label: string,
): void {
  const positiveFactor = Math.max(1, Math.abs(factor));
  if (budget.eventMultiplier * positiveFactor > MAX_EVENT_MULTIPLIER) {
    throw new UnsafePatternError(
      `${label} exceeds the cumulative event multiplier limit of ${MAX_EVENT_MULTIPLIER}.`,
      node,
    );
  }
  budget.eventMultiplier *= positiveFactor;
}

function interpretUnary(
  node: UnaryExpression,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
): number | boolean {
  const value = interpret(node.argument, scope, locals, budget, depth, source);
  if (node.operator === "!") return !value;
  if ((node.operator === "+" || node.operator === "-") && typeof value === "number") {
    return checkedNumber(node.operator === "+" ? value : -value, node);
  }
  throw new UnsafePatternError(`Unary operator "${node.operator}" is not allowed here.`, node);
}

function interpretBinary(
  node: BinaryExpression,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
): number | boolean {
  if (node.left.type === "PrivateIdentifier") {
    throw new UnsafePatternError("Private identifiers are not allowed.", node.left);
  }
  const left = interpret(node.left, scope, locals, budget, depth, source);
  const right = interpret(node.right, scope, locals, budget, depth, source);

  switch (node.operator) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
    case "**": {
      if (typeof left !== "number" || typeof right !== "number") {
        throw new UnsafePatternError("Pattern arithmetic only accepts numbers.", node);
      }
      const result = {
        "+": left + right,
        "-": left - right,
        "*": left * right,
        "/": left / right,
        "%": left % right,
        "**": left ** right,
      }[node.operator];
      return checkedNumber(result, node);
    }
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "<":
    case "<=":
    case ">":
    case ">=": {
      if (typeof left !== "number" || typeof right !== "number") {
        throw new UnsafePatternError("Pattern comparisons only accept numbers.", node);
      }
      if (node.operator === "<") return left < right;
      if (node.operator === "<=") return left <= right;
      if (node.operator === ">") return left > right;
      return left >= right;
    }
    default:
      throw new UnsafePatternError(`Operator "${node.operator}" is not allowed.`, node);
  }
}

function checkedNumber(value: number, node: Node): number {
  if (!Number.isFinite(value)) {
    throw new UnsafePatternError("Pattern arithmetic must produce a finite number.", node);
  }
  if (Math.abs(value) > MAX_NUMBER_MAGNITUDE) {
    throw new UnsafePatternError(
      `Pattern numbers may not exceed ${MAX_NUMBER_MAGNITUDE}.`,
      node,
    );
  }
  return value;
}

function interpretLogical(
  node: LogicalExpression,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
): unknown {
  const left = interpret(node.left, scope, locals, budget, depth, source);
  if (node.operator === "&&") {
    return left
      ? interpret(node.right, scope, locals, budget, depth, source)
      : left;
  }
  if (node.operator === "||") {
    return left
      ? left
      : interpret(node.right, scope, locals, budget, depth, source);
  }
  return left ?? interpret(node.right, scope, locals, budget, depth, source);
}

function interpretConditional(
  node: ConditionalExpression,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
): unknown {
  const test = interpret(node.test, scope, locals, budget, depth, source);
  return interpret(
    test ? node.consequent : node.alternate,
    scope,
    locals,
    budget,
    depth,
    source,
  );
}
