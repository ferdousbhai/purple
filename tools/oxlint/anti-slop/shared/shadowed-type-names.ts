import type { ESTree } from "@oxlint/plugins";

import {
	lexicalTypeParameterNames,
	type VisitorKeys,
} from "./lexical-type-parameters.ts";
import { declaredTypeName } from "./type-aliases.ts";

// Type names bound nearer than Program: lexical type parameters, plus aliases and interfaces
// declared in an enclosing block or module body. The rules' alias tables hold Program-level
// declarations only, so resolving one of these names against them would apply an unrelated
// top-level type and report a use site that is in fact well typed.
export function shadowedTypeNames(
	node: ESTree.Node,
	visitorKeys: VisitorKeys,
): ReadonlySet<string> {
	const names = new Set(lexicalTypeParameterNames(node, visitorKeys));
	let current: ESTree.Node | null = node;
	while (current !== null && current.type !== "Program") {
		if (current.type === "BlockStatement" || current.type === "TSModuleBlock") {
			for (const statement of current.body) {
				const name = declaredTypeName(statement);
				if (name !== null) names.add(name);
			}
		}
		current = current.parent;
	}
	return names;
}
