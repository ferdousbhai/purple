import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";
import { resolveVariable } from "./variables.ts";

function isGlobalReflect(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier" || expression.name !== "Reflect") return false;
  if (sourceCode.isGlobalReference(expression)) return true;
  const variable = resolveVariable(sourceCode, expression);
  return variable === null || variable.defs.length === 0;
}

/** Reports whether a call target names one method on the global Reflect object. */
function isGlobalReflectMethodCall(
  sourceCode: SourceCode,
  callee: ESTree.Expression,
  methodName: string,
): boolean {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return false;
  if (!isGlobalReflect(sourceCode, callee.object)) return false;
  const property = callee.property;
  return callee.computed
    ? property.type === "Literal" && property.value === methodName
    : property.type === "Identifier" && property.name === methodName;
}

/** Build one rule for a forbidden method on the unshadowed global Reflect. */
export function createNoReflectMethodRule(
  methodName: string,
  description: string,
  message: string,
) {
  return defineRule({
    meta: {
      type: "problem",
      docs: { description },
      messages: { forbiddenReflectMethod: message },
    },
    createOnce(context) {
      return {
        CallExpression(node) {
          if (
            node.callee.type !== "Super" &&
            node.callee.type !== "V8IntrinsicExpression" &&
            isGlobalReflectMethodCall(context.sourceCode, node.callee, methodName)
          ) {
            context.report({ node, messageId: "forbiddenReflectMethod" });
          }
        },
      };
    },
  });
}
