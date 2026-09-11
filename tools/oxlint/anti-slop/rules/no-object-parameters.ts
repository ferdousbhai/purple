import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

import { lexicalTypeParameterNames } from "../shared/lexical-type-parameters.ts";
import {
	collectTypeAliases,
	resolveAliasReference,
} from "../shared/type-aliases.ts";
import {
	parameterAnnotation,
	functionLikeVisitors,
	type Parameter,
	type ParameterOwner,
} from "../shared/parameters.ts";

function parameterName(parameter: Parameter, sourceCode: SourceCode): string {
	return parameter.type === "Identifier"
		? parameter.name
		: sourceCode.getText(parameter).replace(/\s*:\s*object\s*$/u, "");
}

export const noObjectParametersRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow object function parameters; inputs must use an owner-provided type and be parsed at their boundary.",
		},
		messages: {
			objectParameter:
				"Parameter `{{parameter}}` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.",
		},
	},
	createOnce(context) {
		const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();

		const resolvesToObject = (
			type: ESTree.TSType,
			shadowedAliases: ReadonlySet<string>,
			visited: ReadonlySet<string> = new Set(),
		): boolean => {
			if (type.type === "TSObjectKeyword") return true;
			if (type.type === "TSParenthesizedType")
				return resolvesToObject(type.typeAnnotation, shadowedAliases, visited);
			if (type.type === "TSUnionType") {
				return type.types.some((member) =>
					resolvesToObject(member, shadowedAliases, visited),
				);
			}
			const alias = resolveAliasReference(type, aliases, visited, shadowedAliases);
			return (
				alias !== null &&
				resolvesToObject(alias.annotation, shadowedAliases, alias.visited)
			);
		};

		const checkParameters = (node: ParameterOwner) => {
			const shadowedAliases = lexicalTypeParameterNames(
				node,
				context.sourceCode.visitorKeys,
			);
			for (const parameter of node.params) {
				const annotation = parameterAnnotation(parameter);
				if (annotation === null || annotation === undefined) continue;
				if (!resolvesToObject(annotation.typeAnnotation, shadowedAliases)) continue;
				context.report({
					node: annotation.typeAnnotation,
					messageId: "objectParameter",
					data: { parameter: parameterName(parameter, context.sourceCode) },
				});
			}
		};

		return {
			Program(node) {
				aliases.clear();
				for (const [name, alias] of collectTypeAliases(node)) {
					aliases.set(name, alias);
				}
			},
			...functionLikeVisitors(checkParameters),
		};
	},
});
