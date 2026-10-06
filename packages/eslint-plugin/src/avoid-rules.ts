import { readFileSync } from "node:fs";
import type { Rule } from "eslint";
import type { JSONRuleDefinition } from "@eslint/json";
import type { Node } from "estree";
import { avoidTermIn, parseAvoidTerms } from "./avoid-terms.ts";
import { declaringParents, stringValue, type ParentedNode, type StringNode } from "./js-rules.ts";

// The banned list is GLOSSARY.md's _Avoid_ lines, read when ESLint loads the plugin (RP-327).
const glossaryUrl = new URL("../../../GLOSSARY.md", import.meta.url);


/**
 * Avoid terms that stay allowed, as lower-case words. The generator already skips a term the glossary
 * defines elsewhere (such as Comment or Version) and flags a term qualified "(on its own)", such as
 * Template or List, only when it is the whole name. What is left here are ordinary technical words
 * that no glossary term replaces, where the Avoid entry is about the product's language, not code.
 */
/**
 * Avoid words that stay allowed. The generator already skips a term the glossary defines (Comment,
 * Version), any Avoid word inside a defined term (the "list" of Option List, the "activity" of Activity
 * Feed), and flags a term qualified "(on its own)", such as Template or List, only when it is the whole
 * name. What is left are ordinary technical words that no glossary term replaces, where the Avoid entry
 * is about the product's language, not about code. Keep this short: each entry says why.
 */
const allowed: string[] = [
  "id", // `projectId`, `memberId`: a database or API id. The Avoid entry is about Document Numbers.
  "project id", // the URL and database key. The people-facing name is the Project Number.
  "name", // a person's, file's or Company's `name`. Subject replaces "name" only for a Work Item.
  "title", // an HTML or dialog title. Subject replaces "title" only for a Work Item.
  "status", // HTTP status, `statusCode`, a status column.
  "state", // React state, an OAuth `state`.
  "action", // a Server Action, an HTTP `action`, an audit event's action.
  "button", // the UI component and the HTML element.
  "tab", // the UI component and the ARIA role.
  "dialog", // the HTML element and the ARIA role.
  "modal", // the Modal component under Dialog.
  "task", // a background task.
  "node", // a DOM, tree or graph node.
  "file", // a file on disk or in S3. Attachment and Document are the Work Item terms.
  "attachment", // GLOSSARY.md's System Field entry names Attachments.
  "report", // a failure or test report.
  "output", // a CLI or build output, a calculated field's output.
  "format", // a date or number format.
  "request", // an HTTP request.
  "check", // a lint, health or CI check.
  "filter", // a list filter.
  "header", // an HTTP header.
  "result", // a function result.
  "access", // access control.
  "role", // the PostgreSQL role, the ARIA role, a Member's role key.
  "user agent", // the HTTP header.
  "app", // the app role, Next.js's app.
  "client", // a database or HTTP client.
  "environment", // a deploy or demo environment.
  "region", // an AWS or ARIA region.
  "migration", // a database migration.
  "schedule", // a cron schedule.
  "layout", // Next.js's layout, CSS layout.
  "tag", // an HTML or image tag.
  "category", // a log or query category.
  "queue", // a work queue in an algorithm.
  "ticket", // a request-ordering ticket.
  "reject", // a Promise's reject.
  "stamp", // `fieldStamps`: per-field save times, not a Signature.
  "initials", // the avatar's initials.
  "deleted", // data really deleted (retired options, git status "D"), not a Work Item outcome (Cancelled).
  "messages", // next-intl's message catalogue.
  "section", // a Form Section, written short in code (`editableSections`), and the HTML element.
  "area", // a touch area, a CSS area.
  "activity", // the Activity Feed, written short in its route (/activity) and panel title. The Schedule Module has none yet.
  "follow", // the verb, in "follows the Project" (a numbering pattern that inherits). A Watch button is still caught by review.
  "current user", // PostgreSQL current_user.
  "third party", // an outside library or action, not a Project party.
  "built in", // Built-in Field, written short in code (`builtInProblems`, `built_in_missing`).
  "panel", // a UI panel, such as the Activity Feed panel.
  "phase", // Next.js's `phase`, and "Phase 2" in a demo Project's own name.
  "sheet", // a spreadsheet MIME type, the Sheet overlay component.
  "text notes", // the `text-notes` type-scale class (11px).
];
export const avoidList = parseAvoidTerms(readFileSync(glossaryUrl, "utf8"), allowed);

const message = "Avoid term '{{found}}' ({{words}}). Use the glossary term instead: see the _Avoid_ line in GLOSSARY.md.";

export const noAvoidTerms: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Do not use a term from a GLOSSARY.md _Avoid_ line in identifiers or strings." },
    messages: { term: message },
    schema: [],
  },
  create(context) {
    const reported = new Set<string>();
    const report = (node: Node, text: string, kind: "name" | "text") => {
      const avoid = avoidTermIn(text, avoidList, kind);
      const key = String(node.range);
      if (!avoid || reported.has(key)) return;
      reported.add(key);
      context.report({ node, messageId: "term", data: { found: avoid.term, words: avoid.words.join(" ") } });
    };
    const string = (node: StringNode) => {
      const text = stringValue(node);
      if (!text) return;
      const parent = (node as ParentedNode).parent as { type: string; source?: unknown } | undefined;
      // Module specifiers and directives ("use client") are not names, and role="note" is ARIA.
      if (parent && /^(ImportDeclaration|ExportAllDeclaration|ExportNamedDeclaration|ExpressionStatement|TSImportType)$/.test(parent.type)) return;
      if (parent?.type === "JSXAttribute" && (parent as unknown as { name: { name: unknown } }).name.name === "role") return;
      report(node, text, "text");
    };
    return {
      Identifier(node) {
        const parent = (node as ParentedNode).parent;
        const isParam = parent && "params" in parent && (parent.params as Node[]).includes(node);
        if (parent && (declaringParents.has(parent.type) || isParam)) report(node, node.name, "name");
      },
      JSXAttribute(node: Rule.Node) {
        const attribute = node as unknown as { name: Node & { type: string; name: unknown } };
        if (typeof attribute.name.name === "string") report(attribute.name, attribute.name.name, "name");
      },
      Literal: string,
      TemplateElement: string,
    };
  },
};

export const jsonNoAvoidTerms: JSONRuleDefinition<{ MessageIds: "key" | "value" }> = {
  meta: {
    type: "problem",
    docs: { description: "Do not use a term from a GLOSSARY.md _Avoid_ line in message keys or text." },
    messages: {
      key: "Message key has the avoid term '{{found}}'. Use the glossary term instead: see the _Avoid_ line in GLOSSARY.md.",
      value: "Message text has the avoid term '{{found}}'. Use the glossary term instead: see the _Avoid_ line in GLOSSARY.md.",
    },
    schema: [],
  },
  create(context) {
    return {
      Member(node) {
        const key = avoidTermIn(node.name.type === "String" ? node.name.value : node.name.name, avoidList, "name");
        if (key) context.report({ loc: node.name.loc, messageId: "key", data: { found: key.term } });
        if (node.value.type === "String") {
          const value = avoidTermIn(node.value.value, avoidList);
          if (value) context.report({ loc: node.value.loc, messageId: "value", data: { found: value.term } });
        }
      },
    };
  },
};
