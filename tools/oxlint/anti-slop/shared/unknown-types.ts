import type { ESTree } from "@oxlint/plugins";

import { resolveAliasReference } from "./type-aliases.ts";

// How a caller re-enters its own predicate for a type it has unwrapped one layer.
type ResolveUnknown = (
	type: ESTree.TSType,
	visited: ReadonlySet<string>,
) => boolean;

/**
 * Whether a type is `unknown` once parentheses and alias references are followed.
 *
 * The two rules that ask this agree on exactly this much and differ after it: a return type is
 * also unknown when it is a union containing unknown, or a promise of one, while an alias named
 * `Promise<unknown>` is an honest name rather than a hidden unknown. So the shared part takes
 * the caller's own predicate to recurse with, and each rule keeps the cases that are its own.
 */
export function resolvesToUnknownType(
	type: ESTree.TSType,
	aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>,
	shadowedNames: ReadonlySet<string>,
	visited: ReadonlySet<string>,
	recurse: ResolveUnknown,
): boolean {
	if (type.type === "TSUnknownKeyword") return true;
	if (type.type === "TSParenthesizedType") {
		return recurse(type.typeAnnotation, visited);
	}
	const alias = resolveAliasReference(type, aliases, visited, shadowedNames);
	return alias !== null && recurse(alias.annotation, alias.visited);
}

/**
 * The resolver for a rule that has no cases of its own: the core above, recursing into itself.
 *
 * A rule that adds cases -- a union member, a promised value -- writes its own predicate and
 * calls the core for the rest. A rule that adds none would otherwise restate this wrapper
 * verbatim, which is a clone of the other rule's opening lines rather than shared meaning.
 */
export function createUnknownResolver(
	aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>,
): (
	type: ESTree.TSType,
	shadowedNames: ReadonlySet<string>,
	visited?: ReadonlySet<string>,
) => boolean {
	const resolve = (
		type: ESTree.TSType,
		shadowedNames: ReadonlySet<string>,
		visited: ReadonlySet<string> = new Set(),
	): boolean =>
		resolvesToUnknownType(type, aliases, shadowedNames, visited, (inner, seen) =>
			resolve(inner, shadowedNames, seen),
		);
	return resolve;
}
