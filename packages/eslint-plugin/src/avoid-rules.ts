import { readFileSync } from "node:fs";
import type { Rule } from "eslint";
import type { JSONRuleDefinition } from "@eslint/json";
import type { Node } from "estree";
import { avoidTermIn, avoidTermInCopy, parseAvoidTerms, readsAsCopy, type AvoidList, type AvoidTerm } from "./avoid-terms.ts";
import { isClassString, isConsoleCall, isErrorConstructor, isLogCall, onDeclaredNames, stringValue, type ParentedNode, type StringNode } from "./js-rules.ts";

// The banned list is GLOSSARY.md's _Avoid_ lines, read when ESLint loads the plugin (RP-327).
const glossaryUrl = new URL("../../../GLOSSARY.md", import.meta.url);

/**
 * Two levels (RP-327 review). The generator already skips a term the glossary defines (Comment, Version),
 * any Avoid word inside a defined term (the "list" of Option List, the "activity" of Activity Feed), and
 * flags a term qualified "(on its own)", such as Template or List, only when it is the whole label.
 *
 * `allowedInText` is for what people read: string copy, JSX text and the values of messages/*.json. It
 * holds phrases only, never a bare word, so "Edit the title" or "Follow" is flagged however the code
 * spells its own names.
 *
 * `allowedInNames` is for code names: identifiers, JSX attribute names, message keys and code strings
 * (one token such as "status", a key, SQL, a class list, and the text of an error, a log line or an API
 * schema's `.describe()`, which developers read). A word stays allowed there only where an established
 * code name exists, named in its reason. Keep both lists short: each entry says why.
 *
 * A one-word label in a message that can't be narrowed to a phrase is allowed by its key path in
 * `allowedMessages`; in code, by an `eslint-disable-next-line` comment that gives the reason.
 */
const allowedInText: string[] = [
  "user agent", // the HTTP header, quoted in a log line.
  "current user", // PostgreSQL's current_user, in an error about the database role.
  "third party", // an outside library or action, not a Project party.
  "in app", // the in-app notification channel ("In-app", `notification.in_app`, docs/data-model.md).
  "attachments", // the Attachments System Field, as GLOSSARY.md's System Field entry names it. "Attachment" alone is a Document.
  "weekly report", // the Weekly report notification group and the Weekly report Site Report, as GLOSSARY.md names them.
  "step age report", // the Weekly Step Age report (docs/data-model.md, docs/visibility.md).
  "follows the project", // a numbering pattern that inherits the Project's, not a Watch.
  "phase 2", // "Riyadh Gate Tower – Phase 2", a demo Project's own name.
  "legal name", // a Company's legal name (`company.legal_name`).
  "full name", // a Member's full name (`member.full_name`).
  "project name", // a Project's name, which no Subject replaces.
  "name english", // "Name (English)": the English half of a bilingual name field.
  "name arabic", // "Name (Arabic)": the Arabic half.
  "name company com", // the example address name@company.com.
  "database name", // a PostgreSQL database's name, in a CLI error.
  "file name", // a migration's file name, in a CLI error.
  "participant id", // Rabaed Admin asks for the database id of a Participant, Trade or Location.
  "trade id",
  "location id",
  "engineer action", // "a Rabaed Engineer action": an `admin_action` row, which needs a reason.
  "deleted or renamed", // git's status D, in the migrations-immutable check.
  "with filter", // the List's "With" filter (`withFilterValue`).
  "search results", // Link search's results list, not a Review Code.
  "project id", // Rabaed Admin asks for a Project's database id, as for a Participant's below.
  "semantic roles", // the design tokens' layer 2 (packages/ui README), written into the generated CSS.
  "lose access", // a Member removed from a Project loses it altogether, not a Visibility change.
  "check the", // the verb, asking the reader to look again ("Check the email"), not an Inspection.
  "check your",
  "check both",
  "demo environment", // the demo deploy (`DEMO_FLAG`), not a Project's Instance.
  "file store", // the S3 file store (`FILE_STORE_*`) that holds Documents' bytes.
  "both names", // a Member's or Company's name in English and Arabic.
  "filters", // the List's own filters ("Clear filters"; docs/data-model.md, List and Dashboard). "Filter" alone names a Visibility Dimension.
];

const allowedInNames: string[] = [
  ...allowedInText,
  "project id", // the `project_id` column and `projectId` route parameter (docs/data-model.md). People see the Project Number.
  "follows project", // the `followsProject` message key: a numbering pattern that inherits the Project's.
  "id", // every table's `id` and `*_id` column (docs/data-model.md). The Avoid entry is about Document Numbers.
  "name", // the `name` column of company, member and files (docs/data-model.md). Subject replaces it only for a Work Item.
  "title", // the Subject's code name: `work_item.title` (docs/data-model.md), and the HTML `title` attribute.
  "status", // HTTP's `status` and `statusCode`, and the `status` of job and member rows (docs/data-model.md).
  "state", // React's `useState`, Radix's `data-[state=…]` and the OAuth `state` parameter.
  "action", // Next.js Server Actions and the `admin_action` table (docs/data-model.md).
  "button", // the HTML element and the `Button` component.
  "tab", // the ARIA `tab` role and the `Tabs` component it names.
  "dialog", // the HTML element, the ARIA `dialog` role and the `Dialog` component.
  "modal", // `aria-modal`, and the `Modal` component under Dialog.
  "sheet", // the `Sheet` overlay component, and the spreadsheet MIME type.
  "node", // the DOM's `Node`, and Node.js.
  "file", // the `stored_file` and `free_file` tables (docs/data-model.md), and files on disk or in S3.
  "attachment", // the `attachments` Form field type (docs/form-engine.md) and the HTTP `Content-Disposition: attachment`.
  "request", // the Fetch API's `Request`, Fastify's `request`.
  "header", // HTTP headers (`headers()`, `content-type`), the table header.
  "role", // PostgreSQL roles, the ARIA `role` attribute, and the `project_role` table (docs/data-model.md).
  "app", // the `app` schema and app role (docs/data-model.md), and Next.js's `app/` router.
  "client", // `pg`'s `Client` and the AWS SDK clients.
  "filter", // `Array.prototype.filter`, and the List's filter query parameters.
  "category", // `stage.category` (docs/data-model.md): a Stage's draft, in progress, closed or cancelled.
  "report", // the `step_age_report` outbox kind and the `weekly_report` notification group (docs/data-model.md), test reports.
  "activity", // the Activity Feed's API route and cursor, written short (`/v1/projects/:projectId/activity`), and `pg_stat_activity`.
  "check", // a SQL `check` constraint, a CI or health check.
  "result", // a function's or query's result.
  "format", // a date or number format option (`Intl` options, `formatDate`).
  "output", // a CLI, build or stream output.
  "migration", // a database migration (`packages/db/migrations`).
  "layout", // Next.js's `layout.tsx` and CSS layout.
  "messages", // next-intl's message catalogue (`apps/web/messages`).
  "reject", // a Promise's `reject`.
  "environment", // a deploy environment and `process.env`.
  "region", // the AWS region, and the ARIA `region` role.
  "access", // access control (`app.sees_work_item`), AWS access keys.
  "schedule", // the `scheduled_job_run` table (docs/data-model.md) and cron schedules.
  "phase", // Next.js's `phase` argument to next.config.
  "tag", // HTML tags, SES `EmailTags`, argon2's `tagLength`, axe's rule tags.
  "stamp", // `fieldStamps`: per-field save times, not a Signature.
  "initials", // the Avatar's `initials()` of a person's name, not a Signature.
  "section", // the HTML `section` element, and a Form Section written short in the form engine (`sections`, docs/form-engine.md).
  "built in", // Built-in Field, written short in the form engine (`builtInProblems`, `built_in_missing`).
  "touch area", // `touchArea`: a control's 44px hit area, not a Zone.
  "feed panel", // `ActivityFeedPanel`, the Dashboard's Activity Feed card.
  "text notes", // the `text-notes` type-scale class (11px).
];

/**
 * Messages (apps/web/messages/*.json) whose text may keep an Avoid word, by key path: a one-word label can't be
 * narrowed to a phrase. Each says why.
 */
const allowedMessages: Record<string, string> = {
  "members.name": "a Member's name column; Subject replaces name only for a Work Item",
  "members.status": "a Member's active or deactivated column, not a Stage or a Review Code",
  "members.search": "owner's kit (2026-10-10): the Members search box reads \"Search by name or email\"",
  "members.marks": "owner's kit (2026-10-10): the Members list's \"Role\" column, which shows the Authorized Person and Project Creator marks",
  "members.actions": "the column of a Member's row buttons (Deactivate, Reactivate), not Transitions",
  "scopes.invalid": "a Scope's name in both languages, not a Work Item's Subject",
  "workItemViews.viewSwitch.list": "the List view beside the Kanban (spec RP-344), not an Option List",
  "numbering.counters.state": "a counter's state column (In use, Starts at …), not a Stage or a Step",
  "workItemViews.layout.title": "the Kanban card's Card view layout (RP-410, the owner's Kanban Card Anatomy): which parts a card shows, not a View",
  "workItemViews.layout.contractorName": "the raising Company's name on a Kanban card (RP-410), not a Subject",
  // The Kanban's and List's toolbar and filter panel use the owner's anatomy's words (RP-410); code, api and docs keep the glossary's.
  "workItemViews.list.filters": "owner's anatomy (2026-10-10): the toolbar's \"Filter\" button",
  "workItemViews.list.statusField": "owner's anatomy (2026-10-10): the filter panel's \"Status\" field, for the Stage",
  "workItemViews.list.role": "owner's anatomy (2026-10-10): the filter panel's \"Role\" field, for the Step holding the item",
  "workItemViews.layout.location": "owner's anatomy (2026-10-10): the Card view layout's \"Plan location\" switch, for the Location",
  "workItemViews.layout.fixedParts": "owner's anatomy (2026-10-10): the Card view layout's \"Header, subject, tags, owner\" row",
  "workItemViews.list.filtersApplied":"the filter panel's footer, \"1 filter applied\": the List's own filters, not a Visibility Dimension",
};

const glossary = readFileSync(glossaryUrl, "utf8");
/** Avoid terms in code names. */
export const avoidInNames: AvoidList = parseAvoidTerms(glossary, allowedInNames);
/** Avoid terms in what people read: copy, JSX text, message text. */
export const avoidInText: AvoidList = parseAvoidTerms(glossary, allowedInText);

type AnyNode = { type: string; parent?: AnyNode; tag?: AnyNode; callee?: AnyNode; property?: AnyNode; name?: unknown };

/** True inside sql`…` or a `.query("…")` argument: SQL, whose words are column and function names. */
function isSql(node: ParentedNode): boolean {
  for (let n = (node as unknown as AnyNode).parent; n; n = n.parent) {
    if (n.type === "TaggedTemplateExpression") {
      const tag = n.tag!;
      return (tag.type === "Identifier" && tag.name === "sql") || (tag.type === "MemberExpression" && tag.property?.name === "sql");
    }
    if (n.type === "CallExpression") return n.callee?.type === "MemberExpression" && n.callee.property?.name === "query";
    if (/Function|Program|Statement|Declaration$/.test(n.type)) return false;
  }
  return false;
}

/**
 * True for text developers read, not Members: an error's message (`throw`, `new Error(…)`, `Error(…)`), a log or
 * console line, and an API schema's `.describe(…)`. Errors reach people only as a code their messages translate.
 */
function isForDevelopers(node: ParentedNode): boolean {
  for (let n = (node as unknown as AnyNode).parent; n; n = n.parent) {
    if (n.type === "ThrowStatement") return true;
    if (n.type === "NewExpression" || n.type === "CallExpression") {
      const call = n as unknown as Node & { callee: Node };
      if (isErrorConstructor(call.callee) || isLogCall(call) || isConsoleCall(call)) return true;
      if (call.callee.type === "MemberExpression" && call.callee.property.type === "Identifier" && call.callee.property.name === "describe") return true;
    }
    if (/Function|Program|Statement|Declaration$/.test(n.type)) return false;
  }
  return false;
}

/** True for a string used as a key: a type (`Pool["Client"]`, `"draft" | "closed"`), a computed member or an object key. */
function isKey(node: ParentedNode): boolean {
  const parent = (node as unknown as AnyNode).parent as (AnyNode & { computed?: boolean; key?: unknown }) | undefined;
  if (!parent) return false;
  if (parent.type === "TSLiteralType") return true;
  if (parent.type === "MemberExpression") return parent.property === (node as unknown);
  return parent.type === "Property" && parent.key === node;
}

/** The Avoid term in a string: copy is checked as text (its quoted code names as names), anything else as a name. */
export function avoidTermInString(text: string, isCode = false): AvoidTerm | null {
  if (isCode || !readsAsCopy(text)) return avoidTermIn(text, avoidInNames, "name");
  return avoidTermInCopy(text, avoidInText, avoidInNames);
}

const message = "Avoid term '{{found}}' ({{words}}). Use the glossary term instead: see the _Avoid_ line in GLOSSARY.md.";

export const noAvoidTerms: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Do not use a term from a GLOSSARY.md _Avoid_ line in identifiers, strings or JSX text." },
    messages: { term: message },
    schema: [],
  },
  create(context) {
    const reported = new Set<string>();
    const report = (node: Node, avoid: AvoidTerm | null) => {
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
      report(node, avoidTermInString(text, isKey(node) || isSql(node) || isClassString(node) || isForDevelopers(node)));
    };
    return {
      // The same names no-deadline-words checks: declarations, parameters, JSX attribute names, t("…") keys.
      ...onDeclaredNames((node, name) => report(node, avoidTermIn(name, avoidInNames, "name"))),
      Literal: string,
      TemplateElement: string,
      JSXText(node: Rule.Node) {
        const text = (node as unknown as { value: string }).value;
        if (text.trim()) report(node, avoidTermInCopy(text, avoidInText, avoidInNames));
      },
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
    const path: string[] = [];
    return {
      Member(node) {
        const name = node.name.type === "String" ? node.name.value : node.name.name;
        path.push(name);
        const key = avoidTermIn(name, avoidInNames, "name");
        if (key) context.report({ loc: node.name.loc, messageId: "key", data: { found: key.term } });
        if (node.value.type === "String" && !(path.join(".") in allowedMessages)) {
          const value = avoidTermInCopy(node.value.value, avoidInText, avoidInNames);
          if (value) context.report({ loc: node.value.loc, messageId: "value", data: { found: value.term } });
        }
      },
      "Member:exit"() {
        path.pop();
      },
    };
  },
};
