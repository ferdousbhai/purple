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
const MINI_PARSER = Symbol("Purple mini-notation parser");

const EVENT_MULTIPLIER_CALLS = new Set([
  "chop",
  "density",
  "echo",
  "echoWith",
  "fast",
  "hurry",
  "ply",
  "run",
  "scramble",
  "segment",
  "shuffle",
  "striate",
  "stut",
]);

/**
 * Purple intentionally supports a focused Strudel expression language, not
 * arbitrary JavaScript. Every identifier below is supplied by @strudel/web;
 * browser globals never enter the interpreter's scope.
 */
const SAFE_GLOBALS = new Set([
  "add",
  "arrange",
  "brand",
  "brandBy",
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
  "wchoose",
  "xfade",
]);

/** Pattern methods documented in Purple's model prompt. Loading, debugging,
 * drawing, custom worklets and context-manipulation APIs are deliberately not
 * exposed. In particular, constructor/prototype access can never pass this
 * list. */
const SAFE_MEMBERS = new Set([
  "add",
  "adsr",
  "almostAlways",
  "almostNever",
  "always",
  "arp",
  "attack",
  "bank",
  "beat",
  "begin",
  "bpf",
  "bpq",
  "ceil",
  "chop",
  "chunk",
  "chunkBack",
  "clip",
  "coarse",
  "compressor",
  "cpm",
  "crush",
  "cut",
  "decay",
  "degrade",
  "degradeBy",
  "delay",
  "delaytime",
  "density",
  "detune",
  "distort",
  "djf",
  "drive",
  "dry",
  "duckattack",
  "duckdepth",
  "duckonset",
  "duckorbit",
  "early",
  "echo",
  "echoWith",
  "end",
  "every",
  "fast",
  "firstOf",
  "fit",
  "floor",
  "fm",
  "fmenv",
  "fmh",
  "fmwave",
  "ftype",
  "gain",
  "hpf",
  "hpq",
  "hurry",
  "invert",
  "iter",
  "iterBack",
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
  "never",
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
  "phasercenter",
  "phaserdepth",
  "phasersweep",
  "ply",
  "postgain",
  "pw",
  "pwrate",
  "pwsweep",
  "range",
  "rangex",
  "rarely",
  "release",
  "repeatCycles",
  "rev",
  "room",
  "roomdim",
  "roomfade",
  "roomlp",
  "roomsize",
  "rootNotes",
  "round",
  "s",
  "scale",
  "scaleTranspose",
  "scramble",
  "segment",
  "shape",
  "shuffle",
  "silence",
  "slice",
  "slow",
  "someCycles",
  "someCyclesBy",
  "sometimes",
  "sometimesBy",
  "sound",
  "speed",
  "splice",
  "spread",
  "striate",
  "struct",
  "stut",
  "superimpose",
  "sustain",
  "swingBy",
  "transpose",
  "tremolodepth",
  "tremolophase",
  "tremoloshape",
  "tremoloskew",
  "tremolosync",
  "undegradeBy",
  "unison",
  "velocity",
  "vib",
  "voicing",
  "vowel",
  "when",
  "within",
]);

type SafeStrudelValue =
  | object
  | string
  | number
  | boolean
  | null
  | undefined;
export type SafeStrudelScope = Readonly<Record<string, SafeStrudelValue>>;

interface QueryablePattern<Hap> {
  queryArc(begin: number, end: number): Hap[];
}

export function isQueryablePattern<Pattern extends QueryablePattern<unknown>>(
  value: SafeStrudelValue,
): value is Pattern {
  return (
    typeof value === "object" &&
    value !== null &&
    "queryArc" in value &&
    typeof value.queryArc === "function"
  );
}

type Scope = SafeStrudelScope;
type Locals = ReadonlyMap<string, unknown>;
type InternalScope = Scope & { readonly [MINI_PARSER]?: unknown };

interface EvaluationBudget {
  eventMultiplier: number;
  nodes: number;
}

interface InterpretedCallArguments {
  budgets: EvaluationBudget[];
  values: unknown[];
}

interface MiniNode {
  arguments_?: Record<string, unknown>;
  options_?: {
    ops?: MiniOperation[];
    weight?: number;
  };
  source_?: unknown;
  type_?: string;
}

interface MiniOperation {
  arguments_?: Record<string, unknown>;
  type_?: string;
}

class UnsafePatternError extends Error {
  constructor(message: string, node?: Node) {
    super(
      node
        ? `Pattern uses unsupported JavaScript near character ${node.start}: ${message}`
        : message,
    );
    this.name = "UnsafePatternError";
  }
}

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

export function createSafeStrudelScope(source: object): SafeStrudelScope {
  const sourceValues = source as Record<string, SafeStrudelValue>;
  const result: Record<string, SafeStrudelValue> = Object.create(null) as Record<
    string,
    SafeStrudelValue
  >;
  for (const name of [...SAFE_GLOBALS, "m"]) result[name] = sourceValues[name];
  Object.defineProperty(result, MINI_PARSER, {
    enumerable: false,
    value: sourceValues.mini2ast,
  });
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
  let miniAst: unknown;
  const parseMiniNotation = (scope as InternalScope)[MINI_PARSER];
  if (typeof parseMiniNotation !== "function") {
    throw new UnsafePatternError("Strudel mini-notation parser is unavailable.", node);
  }
  try {
    // This is exactly how Strudel's m() wraps an ordinary double-quoted mini
    // string. Using its parser keeps the safety accounting aligned with nested
    // groups, stacks and modifiers instead of guessing with a regular expression.
    miniAst = Reflect.apply(parseMiniNotation, undefined, [`"${value}"`]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UnsafePatternError(`Mini-notation syntax is invalid: ${message}`, node);
  }
  consumeEventMultiplier(
    budget,
    miniEventBound(miniAst, budget, node),
    node,
    "Mini-notation event density",
  );
  const mini = scope.m;
  if (typeof mini !== "function") {
    throw new UnsafePatternError("Strudel mini-notation is unavailable.", node);
  }
  return Reflect.apply(mini, undefined, [value, offset]);
}

function miniEventBound(
  value: unknown,
  budget: EvaluationBudget,
  sourceNode: Node,
): number {
  const node = asMiniNode(value, sourceNode);
  budget.nodes += 1;
  if (budget.nodes > MAX_AST_NODES) {
    throw new UnsafePatternError("Pattern is too complex.", sourceNode);
  }

  if (node.type_ === "atom") return 1;

  if (node.type_ === "element") {
    let bound = miniEventBound(node.source_, budget, sourceNode);
    for (const operation of node.options_?.ops ?? []) {
      bound = applyMiniOperationBound(
        bound,
        operation,
        node.source_,
        budget,
        sourceNode,
      );
    }
    return bound;
  }

  if (node.type_ !== "pattern") {
    throw new UnsafePatternError(
      "Mini-notation contains an unsupported structure.",
      sourceNode,
    );
  }

  const children = asMiniNodeArray(node.source_, sourceNode);
  const childBounds = children.map((child) =>
    miniEventBound(child, budget, sourceNode),
  );
  const alignment = node.arguments_?.alignment;

  if (alignment === "rand") {
    return Math.max(1, ...childBounds);
  }
  if (alignment === "polymeter_slowcat") {
    return addMiniBounds(
      childBounds.map(
        (childBound, index) =>
          childBound / Math.max(1, miniStructuralWeight(children[index])),
      ),
    );
  }
  if (alignment === "polymeter") {
    const steps = maxMiniNumber(node.arguments_?.stepsPerCycle) ?? childBounds[0] ?? 1;
    return addMiniBounds(
      childBounds.map((childBound) => Math.max(childBound, steps)),
    );
  }
  return addMiniBounds(childBounds);
}

function applyMiniOperationBound(
  bound: number,
  operation: MiniOperation,
  elementSource: unknown,
  budget: EvaluationBudget,
  sourceNode: Node,
): number {
  const args = operation.arguments_ ?? {};
  if (operation.type_ === "stretch") {
    const values = miniNumbers(args.amount);
    const amountDensity = miniArgumentEventBound(
      args.amount,
      budget,
      sourceNode,
    );
    const factors =
      args.type === "slow"
        ? values
            .filter((value) => value !== 0)
            .map((value) => 1 / Math.abs(value))
        : values.filter((value) => value !== 0).map((value) => Math.abs(value));
    const numericFactor = factors.length > 0 ? Math.max(...factors) : 1;
    return multiplyMiniBounds(
      bound,
      multiplyMiniBounds(numericFactor, amountDensity),
    );
  }
  if (operation.type_ === "replicate") {
    const amount = typeof args.amount === "number" ? Math.abs(args.amount) : 1;
    return multiplyMiniBounds(bound, Math.max(1, amount));
  }
  if (operation.type_ === "bjorklund") {
    // Pulses bound emitted events while steps bound the Euclidean grid that
    // Strudel constructs. Either can exhaust resources even when the other is small.
    const gridSize = Math.max(
      1,
      ...miniNumbers(args.pulse).map(Math.abs),
      ...miniNumbers(args.step).map(Math.abs),
    );
    const parameterDensity = Math.max(
      miniArgumentEventBound(args.pulse, budget, sourceNode),
      miniArgumentEventBound(args.step, budget, sourceNode),
    );
    return multiplyMiniBounds(
      bound,
      multiplyMiniBounds(gridSize, parameterDensity),
    );
  }
  if (operation.type_ === "range") {
    const starts = miniNumbers(elementSource);
    const stops = miniNumbers(args.element);
    const width = Math.max(
      1,
      ...starts.flatMap((start) =>
        stops.map((stop) => Math.floor(Math.abs(stop - start)) + 1),
      ),
    );
    return multiplyMiniBounds(
      bound,
      multiplyMiniBounds(
        width,
        miniArgumentEventBound(args.element, budget, sourceNode),
      ),
    );
  }
  if (operation.type_ === "tail") {
    return multiplyMiniBounds(
      bound,
      miniArgumentEventBound(args.element, budget, sourceNode),
    );
  }

  // Degradation does not increase queried events. Still walk any nested option
  // pattern so its parser complexity participates in the same limit.
  for (const argument of Object.values(args)) {
    if (isMiniNode(argument)) miniEventBound(argument, budget, sourceNode);
  }
  return bound;
}

function miniArgumentEventBound(
  value: unknown,
  budget: EvaluationBudget,
  sourceNode: Node,
): number {
  return isMiniNode(value) ? miniEventBound(value, budget, sourceNode) : 1;
}

function miniNumbers(value: unknown): number[] {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (!isMiniNode(value)) return [];
  if (value.type_ === "atom") {
    const number = Number(value.source_);
    return Number.isFinite(number) ? [number] : [];
  }

  const nested = Array.isArray(value.source_) ? value.source_ : [value.source_];
  const numbers = nested.flatMap(miniNumbers);
  for (const operation of value.options_?.ops ?? []) {
    if (operation.type_ === "range") {
      numbers.push(...miniNumbers(operation.arguments_?.element));
    }
  }
  return numbers;
}

function maxMiniNumber(value: unknown): number | undefined {
  const numbers = miniNumbers(value).map(Math.abs);
  return numbers.length > 0 ? Math.max(...numbers) : undefined;
}

function miniStructuralWeight(value: MiniNode | undefined): number {
  if (!value) return 1;
  if (value.type_ === "element") return Math.max(1, value.options_?.weight ?? 1);
  if (value.type_ !== "pattern" || !Array.isArray(value.source_)) return 1;
  return Math.max(
    1,
    value.source_.reduce(
      (total, child) =>
        total + (isMiniNode(child) ? miniStructuralWeight(child) : 1),
      0,
    ),
  );
}

function addMiniBounds(values: number[]): number {
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.max(1, sum);
}

function multiplyMiniBounds(left: number, right: number): number {
  return left * right;
}

function asMiniNode(value: unknown, sourceNode: Node): MiniNode {
  if (!isMiniNode(value)) {
    throw new UnsafePatternError(
      "Mini-notation contains an unsupported structure.",
      sourceNode,
    );
  }
  return value;
}

function asMiniNodeArray(value: unknown, sourceNode: Node): MiniNode[] {
  if (!Array.isArray(value)) {
    throw new UnsafePatternError(
      "Mini-notation contains an unsupported structure.",
      sourceNode,
    );
  }
  return value.map((item) => asMiniNode(item, sourceNode));
}

function isMiniNode(value: unknown): value is MiniNode {
  return typeof value === "object" && value !== null && "type_" in value;
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
  let largestElementMultiplier = 1;
  const values = node.elements.map((element) => {
    if (!element || element.type === "SpreadElement") {
      throw new UnsafePatternError("Array holes and spread syntax are not allowed.", node);
    }
    const elementBudget: EvaluationBudget = {
      eventMultiplier: 1,
      nodes: budget.nodes,
    };
    const value = interpret(element, scope, locals, elementBudget, depth, source);
    budget.nodes = elementBudget.nodes;
    largestElementMultiplier = Math.max(
      largestElementMultiplier,
      elementBudget.eventMultiplier,
    );
    return value;
  });
  budget.eventMultiplier = Math.max(
    budget.eventMultiplier,
    largestElementMultiplier,
  );
  return values;
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
    // Strudel invokes callbacks with Fraction instances for time values
    // (e.g. signal() passes the query span's begin). The expression language
    // only does arithmetic on plain numbers, so numeric-like objects are
    // unwrapped at this boundary; other values (patterns, haps) pass through.
    names.forEach((name, index) =>
      nested.set(name, unwrapNumericArgument(args[index])),
    );
    // Transform callbacks may run for every queried event. Their complexity
    // budget is per invocation rather than being depleted by normal playback.
    const callbackBudget: EvaluationBudget = {
      eventMultiplier: inheritedEventMultiplier,
      nodes: 0,
    };
    const result = interpret(
      body,
      scope,
      nested,
      callbackBudget,
      depth,
      source,
    );
    budget.eventMultiplier = Math.max(
      budget.eventMultiplier,
      callbackBudget.eventMultiplier,
    );
    return result;
  };
}

/** Fraction (and other numeric-like) callback arguments become plain numbers;
 * everything else is returned untouched. A plain object's default valueOf
 * returns the object itself, so only genuinely numeric values convert. */
function unwrapNumericArgument(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const primitive = (value as { valueOf?: () => unknown }).valueOf?.();
  return typeof primitive === "number" && Number.isFinite(primitive)
    ? primitive
    : value;
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
  const ownerEventMultiplier = budget.eventMultiplier;
  const interpretedArgs = interpretCallArguments(
    node,
    scope,
    locals,
    budget,
    depth,
    source,
    owner ? ownerEventMultiplier : 1,
  );

  if (typeof callable !== "function") {
    throw new UnsafePatternError("The selected Strudel value is not callable.", node);
  }
  const result = Reflect.apply(callable, owner, interpretedArgs.values);
  budget.eventMultiplier = combineCallEventBounds(
    callName,
    interpretedArgs.budgets,
    node,
    owner === undefined ? undefined : ownerEventMultiplier,
  );
  if (callName && EVENT_MULTIPLIER_CALLS.has(callName)) {
    consumeEventMultiplier(
      budget,
      eventMultiplierArgument(interpretedArgs.values[0], node.arguments[0], node),
      node,
      `${callName}()`,
    );
  }
  return result;
}

function interpretCallArguments(
  node: CallExpression,
  scope: Scope,
  locals: Locals,
  budget: EvaluationBudget,
  depth: number,
  source: string,
  initialEventMultiplier: number,
): InterpretedCallArguments {
  const budgets: EvaluationBudget[] = [];
  const values = node.arguments.map((argument) => {
    if (argument.type === "SpreadElement") {
      throw new UnsafePatternError("Spread arguments are not allowed.", argument);
    }

    // Arguments describe separate patterns, controls or callbacks. The call
    // combines their resulting bounds according to its semantics.
    const branchBudget: EvaluationBudget = {
      eventMultiplier: initialEventMultiplier,
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
    budgets.push(branchBudget);
    return value;
  });

  return { budgets, values };
}

function combineCallEventBounds(
  callName: string | undefined,
  argumentBudgets: EvaluationBudget[],
  node: Node,
  ownerBound: number | undefined,
): number {
  const bounds = argumentBudgets.map(({ eventMultiplier }) => eventMultiplier);
  let bound: number;
  if (ownerBound === undefined && callName === "xfade") {
    // Xfade receives two patterns that have already passed the same per-pattern
    // safety limit. Keep them independent so wrapping a valid replacement in a
    // transition cannot make it invalid; the middle argument is only a signal.
    bound = Math.max(bounds[0] ?? 1, bounds[2] ?? 1);
  } else if (ownerBound === undefined && callName === "stack") {
    bound = bounds.reduce((total, argumentBound) => total + argumentBound, 0);
  } else if (ownerBound === undefined) {
    bound = Math.max(1, ...bounds);
  } else if (callName === "layer") {
    bound = bounds.reduce((total, argumentBound) => total + argumentBound, 0);
  } else if (callName === "superimpose") {
    bound =
      ownerBound +
      bounds.reduce((total, argumentBound) => total + argumentBound, 0);
  } else if (callName === "jux") {
    bound = ownerBound + (bounds[0] ?? ownerBound);
  } else if (callName === "juxBy" || callName === "off") {
    bound = ownerBound + (bounds[1] ?? ownerBound);
  } else {
    bound = Math.max(ownerBound, ...bounds);
  }
  return checkedEventBound(callName, bound, node);
}

function checkedEventBound(
  callName: string | undefined,
  bound: number,
  node: Node,
): number {
  if (!Number.isFinite(bound) || bound > MAX_EVENT_MULTIPLIER) {
    throw new UnsafePatternError(
      `${callName ?? "Pattern"}() exceeds the cumulative event multiplier limit of ${MAX_EVENT_MULTIPLIER}.`,
      node,
    );
  }
  return Math.max(1, bound);
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
