import { dirname, resolve } from "node:path";
import type { Rule, Scope } from "eslint";
import type { Node } from "estree";
import type { ParentedNode } from "./js-rules.ts";

// RP-987. Rabaed Admin connects as rabaed_admin, which bypasses row-level security (ADR 0010).
// The api's code relies on row-level security for what its explicit scoping misses, so Admin
// runs it only as the app role: through an importer whose steps `set local role rabaed_app`
// (RP-960). The rule's options name the importers and the one module that declares them
// (eslint.config.js); each has a seam test that its steps' statements ran as rabaed_app.

type Options = { module: string; importers: string[] };

/** A path without its `.ts`/`.js` extension, `/`-separated: how an import names a file. */
const bare = (path: string) => path.replaceAll("\\", "/").replace(/\.(m|c)?[tj]sx?$/, "");

/** The api's code: `@rabaed/api`, `@rabaed/api/*`, or a relative path into `apps/api/`. */
function isApiSource(source: unknown, filename: string): boolean {
  if (typeof source !== "string") return false;
  if (/^@rabaed\/api(\/|$)/.test(source)) return true;
  return source.startsWith(".") && bare(resolve(dirname(filename), source)).includes("/apps/api/");
}

/** `importKind` / `exportKind` of a TypeScript import or export: "type" when it brings types only. */
const kindOf = (node: object) => (node as { importKind?: string; exportKind?: string }).importKind ?? (node as { exportKind?: string }).exportKind;

const variableOf = (name: string, scope: Scope.Scope): { variable: Scope.Variable; scope: Scope.Scope } | undefined => {
  for (let s: Scope.Scope | null = scope; s; s = s.upper) {
    const variable = s.set.get(name);
    if (variable) return { variable, scope: s };
  }
  return undefined;
};

/** Only ever handed to a call, as one of its arguments: never reassigned, changed, taken apart or kept elsewhere. */
const onlyPassedOn = (variable: Scope.Variable) =>
  variable.references.every((reference) => {
    if (reference.init) return true;
    const identifier = reference.identifier as ParentedNode;
    const parent = identifier.parent;
    return parent?.type === "CallExpression" && parent.arguments.includes(identifier as never);
  });

export const adminApiAsAppRole: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Rabaed Admin runs the api's code (@rabaed/api) only as the app role, never on rabaed_admin, which bypasses row-level security (RP-960, RP-987)." },
    messages: {
      call: "Rabaed Admin connects as rabaed_admin, which bypasses row-level security: call the api's code ('{{name}}') only with an importer built by {{importers}} from {{module}}, whose steps run `set local role rabaed_app` (RP-960). A new kind of step needs its own importer there and a seam test like RP-960's (statement-roles.ts).",
      namespace: "Import the api's code (@rabaed/api) by name, so each call can be checked to run as the app role (RP-960).",
      reexport: "Don't re-export the api's code (@rabaed/api) from Rabaed Admin: its callers would run it on rabaed_admin, past row-level security (RP-960). Types only (`export type`).",
      dynamic: "Import the api's code (@rabaed/api) statically, by name, so each call can be checked to run as the app role (RP-960).",
    },
    schema: [
      {
        type: "object",
        properties: { module: { type: "string" }, importers: { type: "array", items: { type: "string" }, minItems: 1 } },
        required: ["module", "importers"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] as Options;
    const importers = new Set(options.importers);
    const { sourceCode, filename } = context;
    const importersModule = bare(resolve(context.cwd, options.module));
    const inImportersModule = bare(filename) === importersModule;
    const data = { importers: options.importers.map((n) => `${n}()`).join(" or "), module: options.module };

    /** Whether `callee` is one of the importers: declared at the top of their module, or imported from it. */
    const isImporter = (callee: Node, scope: Scope.Scope): boolean => {
      if (callee.type !== "Identifier") return false;
      const [def, ...more] = variableOf(callee.name, scope)?.variable.defs ?? [];
      if (!def || more.length > 0) return false;
      if (def.type === "ImportBinding") {
        const specifier = def.node;
        if (specifier.type !== "ImportSpecifier" || kindOf(specifier) === "type") return false;
        const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value);
        const source = def.parent.source.value;
        return importers.has(imported) && typeof source === "string" && source.startsWith(".") && bare(resolve(dirname(filename), source)) === importersModule;
      }
      const topLevel = variableOf(callee.name, scope)?.scope.type === "module";
      return inImportersModule && topLevel && importers.has(callee.name) && (def.type === "FunctionName" || def.type === "Variable");
    };

    /** Whether `argument` is an importer's call, directly or through a `const` holding it and only ever passed on. */
    const builtByImporter = (argument: Node | undefined, scope: Scope.Scope): boolean => {
      if (argument?.type === "CallExpression") return isImporter(argument.callee as Node, scope);
      if (argument?.type !== "Identifier") return false;
      const found = variableOf(argument.name, scope);
      const [def, ...more] = found?.variable.defs ?? [];
      if (!found || !def || more.length > 0 || def.type !== "Variable" || def.parent.kind !== "const" || def.node.id.type !== "Identifier") return false;
      return onlyPassedOn(found.variable) && builtByImporter(def.node.init ?? undefined, found.scope);
    };

    return {
      ImportDeclaration(node) {
        if (!isApiSource(node.source.value, filename) || kindOf(node) === "type") return;
        for (const specifier of node.specifiers) {
          if (kindOf(specifier) === "type") continue;
          if (specifier.type === "ImportNamespaceSpecifier") {
            context.report({ node: specifier, messageId: "namespace" });
            continue;
          }
          for (const variable of sourceCode.getDeclaredVariables(specifier)) {
            for (const reference of variable.references) {
              const identifier = reference.identifier as ParentedNode;
              // `typeof readRegister` in a type runs nothing.
              if ((identifier.parent?.type as string) === "TSTypeQuery") continue;
              const call = identifier.parent;
              if (call?.type === "CallExpression" && call.callee === identifier && builtByImporter(call.arguments[0] as Node | undefined, sourceCode.getScope(call))) continue;
              context.report({ node: identifier, messageId: "call", data: { ...data, name: variable.name } });
            }
          }
        }
      },
      "ExportNamedDeclaration, ExportAllDeclaration"(node: Rule.Node) {
        if (node.type !== "ExportNamedDeclaration" && node.type !== "ExportAllDeclaration") return;
        if (!isApiSource(node.source?.value, filename) || kindOf(node) === "type") return;
        const specifiers = node.type === "ExportNamedDeclaration" ? node.specifiers : [];
        if (specifiers.length > 0 && specifiers.every((s) => kindOf(s) === "type")) return;
        context.report({ node, messageId: "reexport" });
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && isApiSource(node.source.value, filename)) context.report({ node, messageId: "dynamic" });
      },
    };
  },
};
