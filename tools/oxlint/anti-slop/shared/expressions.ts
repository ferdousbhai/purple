import type { ESTree } from "@oxlint/plugins";

export type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

export function unwrapParentheses(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

export function isTypeAssertionExpression(node: ESTree.Node): node is TypeAssertion {
  return node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
}

export function isConstAssertion(node: TypeAssertion): boolean {
  const { typeAnnotation } = node;
  return (
    typeAnnotation.type === "TSTypeReference" &&
    typeAnnotation.typeName.type === "Identifier" &&
    typeAnnotation.typeName.name === "const"
  );
}
