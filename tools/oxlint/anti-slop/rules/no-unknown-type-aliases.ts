import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";
import {
		collectTypeAliases,
		resolveAliasReference,
	} from "../shared/type-aliases.ts";

/** Ban named aliases that merely conceal TypeScript's unknown top type. */
export const noUnknownTypeAliasesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow type aliases whose resolved type is unknown; unknown must remain visible at an allowed boundary.",
		},
		messages: {
			unknownAlias:
				"Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.",
		},
	},
	createOnce(context) {
		const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();

		const resolvesToUnknown = (type: ESTree.TSType, visited = new Set<string>()): boolean => {
			if (type.type === "TSUnknownKeyword") return true;
			if (type.type === "TSParenthesizedType")
				return resolvesToUnknown(type.typeAnnotation, visited);
			const alias = resolveAliasReference(type, aliases, visited);
			return alias !== null && resolvesToUnknown(alias.annotation, alias.visited);
		};

		return {
			Program(node) {
				aliases.clear();
				for (const [name, alias] of collectTypeAliases(node)) aliases.set(name, alias);
				for (const alias of aliases.values()) {
					if (!resolvesToUnknown(alias.typeAnnotation, new Set([alias.id.name]))) continue;
					context.report({
						node: alias.id,
						messageId: "unknownAlias",
						data: { alias: alias.id.name },
					});
				}
			},
		};
	},
});
