import type { ESTree } from "@oxlint/plugins";

function referencedAliasName(type: ESTree.TSType): string | null {
  if (type.type === "TSParenthesizedType") {
    return referencedAliasName(type.typeAnnotation);
  }
  if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") {
    return null;
  }
  return type.typeArguments === null ||
    type.typeArguments === undefined ||
    type.typeArguments.params.length === 0
    ? type.typeName.name
    : null;
}

export function collectTypeAliases(
  program: ESTree.Program,
): Map<string, ESTree.TSTypeAliasDeclaration> {
  const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type === "TSTypeAliasDeclaration") {
      aliases.set(declaration.id.name, declaration);
    }
  }
  return aliases;
}

interface ResolvedAliasReference {
  annotation: ESTree.TSType;
  visited: ReadonlySet<string>;
}

export function resolveAliasReference(
  type: ESTree.TSType,
  aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>,
  visited: ReadonlySet<string>,
  shadowedAliases: ReadonlySet<string> = new Set(),
): ResolvedAliasReference | null {
  const name = referencedAliasName(type);
  if (name === null || visited.has(name) || shadowedAliases.has(name)) return null;
  const alias = aliases.get(name);
  if (
    alias === undefined ||
    (alias.typeParameters !== null && alias.typeParameters !== undefined)
  ) {
    return null;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(name);
  return { annotation: alias.typeAnnotation, visited: nextVisited };
}
