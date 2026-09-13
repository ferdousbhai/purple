import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { shadowedTypeNames } from "../shared/shadowed-type-names.ts";
import { collectTypeAliases } from "../shared/type-aliases.ts";
import { resolvesToUnknownType } from "../shared/unknown-types.ts";
import {
  functionLikeVisitors,
  type ParameterOwner,
} from "../shared/parameters.ts";

export const noUnknownReturnsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow functions whose explicit return contract is unknown or Promise<unknown>.",
    },
    messages: {
      unknownReturn:
        "This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.",
    },
  },
  createOnce(context) {
    const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();

    const resolvesToUnknown = (
      type: ESTree.TSType,
      shadowedNames: ReadonlySet<string>,
      visited: ReadonlySet<string> = new Set(),
    ): boolean => {
      if (type.type === "TSUnionType") {
        return type.types.some((member) =>
          resolvesToUnknown(member, shadowedNames, visited),
        );
      }
      if (
        type.type === "TSTypeReference" &&
        type.typeName.type === "Identifier" &&
        (type.typeName.name === "Promise" || type.typeName.name === "PromiseLike")
      ) {
        const value = type.typeArguments?.params[0];
        return value !== undefined && resolvesToUnknown(value, shadowedNames, visited);
      }
      return resolvesToUnknownType(
        type,
        aliases,
        shadowedNames,
        visited,
        (inner, seen) => resolvesToUnknown(inner, shadowedNames, seen),
      );
    };

    const checkReturnType = (node: ParameterOwner) => {
      const annotation = node.returnType;
      if (annotation === null || annotation === undefined) return;
      if (
        !resolvesToUnknown(
          annotation.typeAnnotation,
          shadowedTypeNames(node, context.sourceCode.visitorKeys),
        )
      ) {
        return;
      }
      context.report({ node: annotation.typeAnnotation, messageId: "unknownReturn" });
    };

    return {
      Program(node) {
        aliases.clear();
        for (const [name, alias] of collectTypeAliases(node)) aliases.set(name, alias);
      },
      ...functionLikeVisitors(checkReturnType),
    };
  },
});
