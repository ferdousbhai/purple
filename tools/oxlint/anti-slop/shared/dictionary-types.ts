import type { ESTree } from "@oxlint/plugins";

const BUILT_INS = new Set([
	"Record",
	"Readonly",
	"Partial",
	"Required",
	"Pick",
	"Omit",
	"PropertyKey",
	"NonNullable",
]);
const TRANSPARENT_WRAPPERS = new Set(["Readonly", "Partial", "Required", "NonNullable"]);

type TypeAliasEnvironment = ReadonlyMap<string, ESTree.TSType>;

type ResolvedType = {
	readonly type: ESTree.TSType;
	readonly substitutions: TypeAliasEnvironment;
};

type ResolvedAlias = ResolvedType & {
	readonly resolvingAliases: ReadonlySet<string>;
};

export type UnsafeDictionary = {
	readonly kind: "unsafe-dictionary";
	readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
};

type WideningTargetKind =
	| "anonymous object"
	| "generic container"
	| "object"
	| "open dictionary"
	| "unknown";

export type WideningTarget = {
	readonly kind: WideningTargetKind;
};

export type TypeEnvironment = {
	readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
	readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
	readonly shadowedBuiltIns: ReadonlySet<string>;
};

function declaredStatement(statement: ESTree.Statement): ESTree.Node | null {
	return statement.type === "ExportNamedDeclaration" ||
		statement.type === "ExportDefaultDeclaration"
		? (statement.declaration ?? null)
		: statement;
}

function markShadowedBuiltIn(name: string, shadowedBuiltIns: Set<string>): void {
	if (BUILT_INS.has(name)) shadowedBuiltIns.add(name);
}

export function createTypeEnvironment(program: ESTree.Program): TypeEnvironment {
	const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
	const interfaces = new Map<string, ESTree.TSInterfaceDeclaration[]>();
	const shadowedBuiltIns = new Set<string>();

	for (const statement of program.body) {
		const declaration = declaredStatement(statement);
		if (declaration?.type === "ImportDeclaration") {
			for (const specifier of declaration.specifiers) {
				markShadowedBuiltIn(specifier.local.name, shadowedBuiltIns);
			}
			continue;
		}

		if (declaration?.type === "TSTypeAliasDeclaration") {
			const existing = aliases.get(declaration.id.name);
			if (existing === undefined) aliases.set(declaration.id.name, declaration);
			else shadowedBuiltIns.add(declaration.id.name);
			markShadowedBuiltIn(declaration.id.name, shadowedBuiltIns);
			continue;
		}

		if (declaration?.type === "TSInterfaceDeclaration") {
			const declarations = interfaces.get(declaration.id.name) ?? [];
			declarations.push(declaration);
			interfaces.set(declaration.id.name, declarations);
			markShadowedBuiltIn(declaration.id.name, shadowedBuiltIns);
			continue;
		}

		if (declaration?.type === "TSEnumDeclaration") {
			markShadowedBuiltIn(declaration.id.name, shadowedBuiltIns);
			continue;
		}

		if (
			(declaration?.type === "ClassDeclaration" ||
				declaration?.type === "FunctionDeclaration") &&
			declaration.id !== null
		) {
			markShadowedBuiltIn(declaration.id.name, shadowedBuiltIns);
		}
	}

	return { aliases, interfaces, shadowedBuiltIns };
}

export function typeReferenceName(type: ESTree.TSTypeReference): string | null {
	return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function isBuiltIn(name: string, environment: TypeEnvironment): boolean {
	return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}

function isUnappliedReferenceTo(type: ESTree.TSType, name: string): boolean {
	const unwrapped = unwrapTransparentType(type);
	return (
		unwrapped.type === "TSTypeReference" &&
		typeReferenceName(unwrapped) === name &&
		(unwrapped.typeArguments === null ||
			unwrapped.typeArguments === undefined ||
			unwrapped.typeArguments.params.length === 0)
	);
}

function transparentWrapperArgument(
	type: ESTree.TSTypeReference,
	environment: TypeEnvironment,
): ESTree.TSType | null | undefined {
	const name = typeReferenceName(type);
	return name !== null && TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)
		? (type.typeArguments?.params[0] ?? null)
		: undefined;
}

function resolvedSubstitution(
	name: string,
	substitutions: TypeAliasEnvironment,
): ESTree.TSType | null | undefined {
	const substitution = substitutions.get(name);
	return substitution === undefined
		? undefined
		: isUnappliedReferenceTo(substitution, name)
			? null
			: substitution;
}

function resolveReference<T>(
	type: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	empty: T,
	recurse: (type: ESTree.TSType) => T,
	resolveName: (name: string) => T,
): T {
	const name = typeReferenceName(type);
	if (name === null) return empty;
	const substitution = resolvedSubstitution(name, substitutions);
	if (substitution !== undefined) {
		return substitution === null ? empty : recurse(substitution);
	}
	const wrapped = transparentWrapperArgument(type, environment);
	if (wrapped === undefined) return resolveName(name);
	return wrapped === null ? empty : recurse(wrapped);
}

function unwrapTransparentType(type: ESTree.TSType): ESTree.TSType {
	let current = type;
	while (
		current.type === "TSParenthesizedType" ||
		(current.type === "TSTypeOperator" && current.operator === "readonly")
	) {
		current = current.typeAnnotation;
	}
	return current;
}

function isNeverType(type: ESTree.TSType): boolean {
	return unwrapTransparentType(type).type === "TSNeverKeyword";
}

function isEffectivelyEmptyMember(member: ESTree.TSSignature): boolean {
	return (
		member.type === "TSPropertySignature" &&
		member.optional === true &&
		member.typeAnnotation !== null &&
		member.typeAnnotation !== undefined &&
		isNeverType(member.typeAnnotation.typeAnnotation)
	);
}

function isEffectivelyEmptyTypeLiteral(type: ESTree.TSTypeLiteral): boolean {
	return type.members.length === 0 || type.members.every(isEffectivelyEmptyMember);
}

function isEffectivelyEmptyInterface(
	declarations: readonly ESTree.TSInterfaceDeclaration[],
): boolean {
	if (declarations.length !== 1) return false;
	const [type] = declarations;
	return (
		type !== undefined &&
		type.extends.length === 0 &&
		(type.body.body.length === 0 || type.body.body.every(isEffectivelyEmptyMember))
	);
}

function resolvedSubstitutionArgument(
	type: ESTree.TSType,
	base: TypeAliasEnvironment,
	resolving: ReadonlySet<string> = new Set(),
): ESTree.TSType {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type !== "TSTypeReference") return type;
	const name = typeReferenceName(unwrapped);
	if (name === null || resolving.has(name)) return type;
	const substitution = base.get(name);
	if (substitution === undefined) return type;
	const nextResolving = new Set(resolving);
	nextResolving.add(name);
	return resolvedSubstitutionArgument(substitution, base, nextResolving);
}

function aliasSubstitution(
	alias: ESTree.TSTypeAliasDeclaration,
	type: ESTree.TSTypeReference,
	base: TypeAliasEnvironment,
): TypeAliasEnvironment | null {
	const parameters = alias.typeParameters?.params ?? [];
	const arguments_ = type.typeArguments?.params ?? [];
	const next = new Map(base);
	for (const [index, parameter] of parameters.entries()) {
		const argument = arguments_[index] ?? parameter.default;
		if (argument === null || argument === undefined) return null;
		next.set(parameter.name.name, resolvedSubstitutionArgument(argument, next));
	}
	return next;
}

function resolveAlias(
	type: ESTree.TSTypeReference,
	name: string,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): ResolvedAlias | null {
	const alias = environment.aliases.get(name);
	if (alias === undefined || resolvingAliases.has(name)) return null;
	const nextSubstitutions = aliasSubstitution(alias, type, substitutions);
	if (nextSubstitutions === null) return null;
	const nextResolving = new Set(resolvingAliases);
	nextResolving.add(name);
	return {
		type: alias.typeAnnotation,
		substitutions: nextSubstitutions,
		resolvingAliases: nextResolving,
	};
}

function resolveAliasValue<T>(
	type: ESTree.TSTypeReference,
	name: string,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
	empty: T,
	recurse: (alias: ResolvedAlias) => T,
): T {
	const alias = resolveAlias(type, name, environment, substitutions, resolvingAliases);
	return alias === null ? empty : recurse(alias);
}

function unsafeDirectValue(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): UnsafeDictionary["unsafeValue"] | null {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === "TSUnknownKeyword") return "unknown";
	if (unwrapped.type === "TSAnyKeyword") return "any";
	if (unwrapped.type === "TSObjectKeyword") return "object";
	if (unwrapped.type === "TSTypeLiteral" && isEffectivelyEmptyTypeLiteral(unwrapped))
		return "empty-object";
	if (unwrapped.type === "TSUnionType") {
		return unwrapped.types.some(
			(member) => unsafeDirectValue(member, environment, substitutions, resolvingAliases) !== null,
		)
			? "union"
			: null;
	}
	if (unwrapped.type === "TSIntersectionType") {
		const unsafeMembers = unwrapped.types.map((member) =>
			unsafeDirectValue(member, environment, substitutions, resolvingAliases),
		);
		if (unsafeMembers.includes("any")) return "any";
		return unsafeMembers.length > 0 && unsafeMembers.every((member) => member !== null)
			? unsafeMembers[0]
			: null;
	}
	if (unwrapped.type !== "TSTypeReference") return null;
	return resolveReference(
		unwrapped,
		environment,
		substitutions,
		null,
		(next) => unsafeDirectValue(next, environment, substitutions, resolvingAliases),
		(name) => {
			const declarations = environment.interfaces.get(name);
			if (declarations !== undefined) {
				return isEffectivelyEmptyInterface(declarations) ? "empty-object" : null;
			}
			return resolveAliasValue(
				unwrapped,
				name,
				environment,
				substitutions,
				resolvingAliases,
				null,
				(alias) =>
					unsafeDirectValue(
						alias.type,
						environment,
						alias.substitutions,
						alias.resolvingAliases,
					),
			);
		},
	);
}

function dictionaryValueTypes(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): readonly ResolvedType[] {
	const unwrapped = unwrapTransparentType(type);

	if (unwrapped.type === "TSTypeLiteral") {
		return unwrapped.members.flatMap((member): readonly ResolvedType[] =>
			member.type === "TSIndexSignature" && member.typeAnnotation !== null
				? [{ type: member.typeAnnotation.typeAnnotation, substitutions }]
				: [],
		);
	}

	if (unwrapped.type === "TSMappedType") {
		return unwrapped.typeAnnotation === null
			? []
			: [{ type: unwrapped.typeAnnotation, substitutions }];
	}

	if (unwrapped.type !== "TSTypeReference") return [];
	return resolveReference<readonly ResolvedType[]>(
		unwrapped,
		environment,
		substitutions,
		[],
		(next) => dictionaryValueTypes(next, environment, substitutions, resolvingAliases),
		(name) => {
			if (name === "Record" && isBuiltIn(name, environment)) {
				const value = unwrapped.typeArguments?.params[1] ?? null;
				return value === null ? [] : [{ type: value, substitutions }];
			}
			if ((name === "Pick" || name === "Omit") && isBuiltIn(name, environment)) {
				const source = unwrapped.typeArguments?.params[0];
				return source === undefined
					? []
					: dictionaryValueTypes(source, environment, substitutions, resolvingAliases);
			}
			return resolveAliasValue(
				unwrapped,
				name,
				environment,
				substitutions,
				resolvingAliases,
				[],
				(alias) =>
					dictionaryValueTypes(
						alias.type,
						environment,
						alias.substitutions,
						alias.resolvingAliases,
					),
			);
		},
	);
}

export function classifyUnsafeDictionaryValue(
	valueType: ESTree.TSType,
	environment: TypeEnvironment,
): UnsafeDictionary | null {
	const unsafeValue = unsafeDirectValue(valueType, environment, new Map(), new Set());
	return unsafeValue === null ? null : { kind: "unsafe-dictionary", unsafeValue };
}

export function classifyUnsafeDictionary(
	type: ESTree.TSType,
	environment: TypeEnvironment,
): UnsafeDictionary | null {
	for (const valueType of dictionaryValueTypes(type, environment, new Map(), new Set())) {
		const unsafeValue = unsafeDirectValue(
			valueType.type,
			environment,
			valueType.substitutions,
			new Set(),
		);
		if (unsafeValue !== null) return { kind: "unsafe-dictionary", unsafeValue };
	}
	return null;
}

function resolvesToDictionary(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): boolean {
	return dictionaryValueTypes(type, environment, substitutions, resolvingAliases).length > 0;
}

type DirectWideningResult =
	| { readonly target: WideningTarget | null }
	| { readonly reference: ESTree.TSTypeReference };

function classifyDirectWidening(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	root: boolean,
): DirectWideningResult {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === "TSUnknownKeyword") return { target: { kind: "unknown" } };
	if (unwrapped.type === "TSObjectKeyword") return { target: { kind: "object" } };
	if (unwrapped.type === "TSTypeLiteral") {
		if (unwrapped.members.some((member) => member.type === "TSIndexSignature")) {
			return { target: { kind: "open dictionary" } };
		}
		return {
			target:
				root && unwrapped.members.length > 0 ? { kind: "anonymous object" } : null,
		};
	}
	if (unwrapped.type === "TSMappedType") {
		return {
			target:
				root || isBroadMappedKey(unwrapped.constraint, environment, substitutions)
					? { kind: "open dictionary" }
					: null,
		};
	}
	return unwrapped.type === "TSTypeReference"
		? { reference: unwrapped }
		: { target: null };
}

export function classifyWideningTarget(
	type: ESTree.TSType,
	environment: TypeEnvironment,
): WideningTarget | null {
	return classifyBroadTarget(type, environment, new Map(), new Set(), true);
}

function isBroadMappedKey(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
): boolean {
	const unwrapped = unwrapTransparentType(type);
	if (
		unwrapped.type === "TSStringKeyword" ||
		unwrapped.type === "TSNumberKeyword" ||
		unwrapped.type === "TSSymbolKeyword"
	) {
		return true;
	}
	if (unwrapped.type === "TSUnionType") {
		return unwrapped.types.every((member) =>
			isBroadMappedKey(member, environment, substitutions),
		);
	}
	if (unwrapped.type !== "TSTypeReference") return false;
	const name = typeReferenceName(unwrapped);
	if (name === null) return false;
	const substitution = substitutions.get(name);
	if (substitution !== undefined && !isUnappliedReferenceTo(substitution, name)) {
		return isBroadMappedKey(substitution, environment, substitutions);
	}
	return name === "PropertyKey" && isBuiltIn(name, environment);
}

function classifyBroadTarget(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
	root: boolean,
): WideningTarget | null {
	const direct = classifyDirectWidening(type, environment, substitutions, root);
	if ("target" in direct) return direct.target;
	const unwrapped = direct.reference;
	return resolveReference(
		unwrapped,
		environment,
		substitutions,
		null,
		(next) =>
			classifyBroadTarget(next, environment, substitutions, resolvingAliases, root),
		(name) => {
			if (name === "Record" && isBuiltIn(name, environment)) {
				return { kind: "open dictionary" };
			}
			const declaration = environment.aliases.get(name);
			if (declaration === undefined) return null;
			const alias = resolveAlias(
				unwrapped,
				name,
				environment,
				substitutions,
				resolvingAliases,
			);
			if (alias === null) return null;
			if (root && (declaration.typeParameters?.params.length ?? 0) > 0) {
				return resolvesToDictionary(
					alias.type,
					environment,
					alias.substitutions,
					alias.resolvingAliases,
				)
					? { kind: "generic container" }
					: null;
			}
			return classifyBroadTarget(
				alias.type,
				environment,
				alias.substitutions,
				alias.resolvingAliases,
				false,
			);
		},
	);
}

export function isKnownEvidenceExpression(expression: ESTree.Expression): boolean {
	const current = unwrapKnownEvidenceExpression(expression);
	if (current.type === "ObjectExpression") return true;
	return (
		current.type === "ArrayExpression" ||
		current.type === "ArrowFunctionExpression" ||
		current.type === "ClassExpression" ||
		current.type === "FunctionExpression" ||
		current.type === "NewExpression" ||
		current.type === "Literal" ||
		current.type === "TemplateLiteral" ||
		current.type === "UnaryExpression"
	);
}

export function unwrapKnownEvidenceExpression(
	expression: ESTree.Expression,
	unwrapSatisfies = true,
): ESTree.Expression {
	let current = expression;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSTypeAssertion" ||
		current.type === "TSNonNullExpression" ||
		(unwrapSatisfies && current.type === "TSSatisfiesExpression")
	) {
		current = current.expression;
	}
	return current;
}
