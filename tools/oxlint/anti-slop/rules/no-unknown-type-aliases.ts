import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";
import { shadowedTypeNames } from "../shared/shadowed-type-names.ts";
import { collectTypeAliases } from "../shared/type-aliases.ts";
import { createUnknownResolver } from "../shared/unknown-types.ts";

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

		const resolvesToUnknown = createUnknownResolver(aliases);

		return {
			Program(node) {
				aliases.clear();
				for (const [name, alias] of collectTypeAliases(node)) aliases.set(name, alias);
				for (const alias of aliases.values()) {
					// A generic alias binds its own parameters over its right-hand side, so `type
					// Box<T> = T` means the parameter and not a same-named top-level alias. Without
					// this the table resolved it to that alias and reported a use that is well typed.
					const shadowedNames = shadowedTypeNames(
						alias.typeAnnotation,
						context.sourceCode.visitorKeys,
					);
					if (
						!resolvesToUnknown(
							alias.typeAnnotation,
							shadowedNames,
							new Set([alias.id.name]),
						)
					) {
						continue;
					}
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
