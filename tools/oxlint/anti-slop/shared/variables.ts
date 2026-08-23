import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

/** The declarator behind a variable defined exactly once, if it is one. */
export function variableDeclarator(
  variable: Variable,
): ESTree.VariableDeclarator | null {
  if (variable.defs.length !== 1) return null;
  const [definition] = variable.defs;
  return definition?.type === "Variable" && definition.node.type === "VariableDeclarator"
    ? definition.node
    : null;
}

/** The declarator of a `const` binding that is never reassigned, else null. */
export function stableConstDeclarator(
  variable: Variable,
): ESTree.VariableDeclarator | null {
  const declarator = variableDeclarator(variable);
  return declarator !== null &&
    declarator.parent.type === "VariableDeclaration" &&
    declarator.parent.kind === "const" &&
    variable.references.every((reference) => reference.init || !reference.isWrite())
    ? declarator
    : null;
}

/** Resolve an identifier through Oxlint's lexical scope chain. */
export function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}
