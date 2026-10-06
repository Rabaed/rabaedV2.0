import css from "@eslint/css";
import json from "@eslint/json";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import rabaed from "./index.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tsx = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});
const cssTester = new RuleTester({ plugins: { css }, language: "css/css" });
const jsonTester = new RuleTester({ plugins: { json }, language: "json/json" });

const { rules } = rabaed;

tsx.run("no-hardcoded-colour", rules["no-hardcoded-colour"], {
  valid: [
    `<div className="bg-surface text-muted border-border" />`,
    `<div style={{ background: "var(--primary)" }} />`,
    `const pattern = /#[0-9a-f]{6}/;`,
    `const anchor = "#main";`,
    `<div className="text-[13px] grid-cols-[max-content_1fr]" />`,
    `<a href="#add">Skip</a>`,
    `const ref = "RFI #1234";`,
    `<p style={{ fontFamily: "Montserrat", color: "var(--text)" }} />`,
  ],
  invalid: [
    { code: `<div style={{ color: "#f95738" }} />`, errors: [{ messageId: "colour" }] },
    { code: "const shadow = `0 1px 2px rgba(0, 0, 0, .1)`;", errors: [{ messageId: "colour" }] },
    { code: `<div className="p-2 bg-[#f95738]" />`, errors: [{ messageId: "arbitraryColour" }] },
    { code: `cn("fill-[red]")`, errors: [{ messageId: "arbitraryColour" }] },
    { code: `<i className="[color:var(--palette-red-500)]" />`, errors: [{ messageId: "colour" }] },
    { code: `<i style={{ background: "var(--palette-orange-500)" }} />`, errors: [{ messageId: "colour" }] },
    { code: `<i className="bg-(--palette-red-500)" />`, errors: [{ messageId: "colour" }] },
    { code: `<i style={{ color: "red" }} />`, errors: [{ messageId: "namedColour" }] },
  ],
});

tsx.run("no-physical-direction", rules["no-physical-direction"], {
  valid: [
    `<div className="ms-2 pe-4 start-0 text-start border-s rounded-e-sm" />`,
    `cn("ps-3", cond && "me-1")`,
    `cva(["px-4"], { variants: { size: { sm: "ps-2" } } })`,
    `<div style={{ marginInlineStart: 8, insetInlineEnd: 0, textAlign: "start" }} />`,
    `const label = "left-hand side";`,
    `const position = { left: 1, right: 2 };`,
    `const hint = "Tap right-to-left";`,
  ],
  invalid: [
    {
      code: `<div className="flex ml-2" />`,
      errors: [{ messageId: "class", data: { found: "ml-2", logical: "ms-2" } }],
    },
    {
      code: `cn("md:pr-4", "text-right")`,
      errors: [
        { messageId: "class", data: { found: "md:pr-4", logical: "md:pe-4" } },
        { messageId: "class", data: { found: "text-right", logical: "text-end" } },
      ],
    },
    {
      code: `cva(["px-4"], { variants: { side: { a: "left-0" } } })`,
      errors: [{ messageId: "class", data: { found: "left-0", logical: "start-0" } }],
    },
    {
      code: `cardVariants({ tone: "pl-2" })`,
      errors: [{ messageId: "class", data: { found: "pl-2", logical: "ps-2" } }],
    },
    {
      code: `<div className="[margin-left:4px]" />`,
      errors: [{ messageId: "class", data: { found: "[margin-left:4px]", logical: "[margin-inline-start:4px]" } }],
    },
    {
      code: "<div className={`gap-2 ${x} -mr-1`} />",
      errors: [{ messageId: "class", data: { found: "-mr-1", logical: "-me-1" } }],
    },
    {
      code: `<div style={{ marginLeft: 8, textAlign: "right" }} />`,
      errors: [
        { messageId: "style", data: { found: "marginLeft", logical: "marginInlineStart" } },
        { messageId: "styleValue", data: { found: "right", logical: "end" } },
      ],
    },
  ],
});

tsx.run("no-deadline-words", rules["no-deadline-words"], {
  valid: [
    `function Card({ weeksAtStep }: { weeksAtStep: number }) { return <AgeDots weeks={weeksAtStep} />; }`,
    `const residue = 1;`,
    `t("stepAge")`,
  ],
  invalid: [
    { code: `type Props = { dueDate: Date };`, errors: [{ messageId: "word", data: { word: "dueDate" } }] },
    { code: `<Badge overdue />`, errors: [{ messageId: "word", data: { word: "overdue" } }] },
    { code: `function Row({ deadline }) { return null; }`, errors: [{ messageId: "word", data: { word: "deadline" } }] },
    { code: `const isOverdue = false;`, errors: [{ messageId: "word", data: { word: "Overdue" } }] },
    { code: `t("list.dueDate")`, errors: [{ messageId: "word", data: { word: "dueDate" } }] },
    { code: `t.rich("home.overdueItems")`, errors: [{ messageId: "word", data: { word: "overdue" } }] },
    { code: `const slaDays = 3;`, errors: [{ messageId: "word", data: { word: "sla" } }] },
  ],
});

cssTester.run("css-no-hardcoded-colour", rules["css-no-hardcoded-colour"], {
  valid: [`a { color: var(--primary); }`, `#main { border-color: var(--border); }`, `a { @apply bg-primary text-muted; }`, `a { content: "red"; }`],
  invalid: [
    { code: `a { color: red; }`, errors: [{ messageId: "colour" }] },
    { code: `a { border: 1px solid var(--palette-slate-200); }`, errors: [{ messageId: "colour" }] },
    { code: `a { @apply p-2 bg-[#fff]; }`, errors: [{ messageId: "arbitraryColour" }] },
    { code: `a { color: #f95738; }`, errors: [{ messageId: "colour" }] },
    { code: `a { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }`, errors: [{ messageId: "colour" }] },
  ],
});

cssTester.run("css-no-physical-direction", rules["css-no-physical-direction"], {
  valid: [
    `a { margin-inline-start: 1rem; padding-inline-end: 0; inset-inline-start: 0; text-align: start; margin-top: 1rem; }`,
  ],
  invalid: [
    {
      code: `a { margin-left: 1rem; }`,
      errors: [{ messageId: "property", data: { found: "margin-left", logical: "margin-inline-start" } }],
    },
    { code: `a { right: 0; }`, errors: [{ messageId: "property", data: { found: "right", logical: "inset-inline-end" } }] },
    {
      code: `a { border-top-left-radius: 4px; }`,
      errors: [{ messageId: "property", data: { found: "border-top-left-radius", logical: "border-start-start-radius" } }],
    },
    { code: `a { float: left; }`, errors: [{ messageId: "value", data: { found: "left", logical: "inline-start" } }] },
    { code: `a { @apply ml-2; }`, errors: [{ messageId: "class", data: { found: "ml-2", logical: "ms-2" } }] },
  ],
});

jsonTester.run("json-no-deadline-words", rules["json-no-deadline-words"], {
  valid: [
    `{ "list": { "stepAge": "Step Age", "weeks": "{n} weeks at this step" } }`,
    `{ "list": { "due": "Returned due to missing drawings" } }`,
  ],
  invalid: [
    { code: `{ "card": { "when": "Due {date}" } }`, errors: [{ messageId: "value" }] },
    { code: `{ "card": { "status": "Submitted late" } }`, errors: [{ messageId: "value" }] },
    { code: `{ "list": { "dueDate": "Due date" } }`, errors: [{ messageId: "key" }, { messageId: "value" }] },
    { code: `{ "home": { "kpi": "Overdue 8+ days" } }`, errors: [{ messageId: "value" }] },
    { code: `{ "home": { "kpi": "متأخر" } }`, errors: [{ messageId: "value" }] },
  ],
});

tsx.run("no-raw-error-logging", rules["no-raw-error-logging"], {
  valid: [
    `log.error({ err: error }, "outbox run failed");`,
    `request.log.error(error);`,
    `request.log.error({ type: (error as Error).constructor?.name, code: (error as { code?: unknown }).code }, "request failed");`,
    `log.warn({ code: error.code }, "report failed");`,
    `log.info({ run }, "outbox run");`,
    `console.error(error instanceof Error ? error.message : error);`,
    `const reason = error.message;`,
    `reply.send({ message: error.message });`,
  ],
  invalid: [
    { code: `log.error(error.message);`, errors: [{ messageId: "message" }] },
    { code: `request.log.error({ reason: err.message }, "failed");`, errors: [{ messageId: "message" }] },
    { code: "logger.warn(`failed: ${error.message}`);", errors: [{ messageId: "message" }] },
    { code: `app.log.error({ msg: (e as Error).message });`, errors: [{ messageId: "message" }] },
    { code: `log.child({ reqId }).error(err.message);`, errors: [{ messageId: "message" }] },
    { code: "log.error(`failed: ${err}`);", errors: [{ messageId: "message" }] },
    { code: `log.error({ error }, "failed");`, errors: [{ messageId: "wholeError", data: { key: "error" } }] },
    { code: `log.error({ cause: dbError }, "failed");`, errors: [{ messageId: "wholeError", data: { key: "cause" } }] },
  ],
});

tsx.run("no-avoid-terms", rules["no-avoid-terms"], {
  valid: [
    `const companyId = "abc";`,
    `const memberName = member.name;`,
    `const template = "invitation";`, // a name; only the label "Template" is flagged
    `function OptionListInput({ list }) {}`,
    `<Tabs aria-label="Project modules" />`,
    `<div role="note" />`,
    `import { tenant } from "tenant-lib";`,
    `"use client";`,
    "const mine = 1; /* a comment may say tenant */",
    `const label = { en: "Activity Feed" };`,
    "const sql = `select * from member where id = ${id}`;",
    `const s = "Every Project {company} takes part in";`,
  ],
  invalid: [
    { code: `const tenantId = "abc";`, errors: [{ messageId: "term", data: { found: "Tenant", words: "tenant" } }] },
    { code: `function getCustomer() {}`, errors: [{ messageId: "term" }] },
    { code: `type OrganizationRow = { id: string };`, errors: [{ messageId: "term" }] },
    { code: `const x = { subscriber_count: 1 };`, errors: [{ messageId: "term" }] },
    { code: `<Panel employeeName="x" />`, errors: [{ messageId: "term" }] },
    { code: `const label = "Template";`, errors: [{ messageId: "term", data: { found: "Template", words: "template" } }] },
    { code: `const label = "Your tenant";`, errors: [{ messageId: "term" }] },
    { code: "const label = `Add a ${what} to the organization`;", errors: [{ messageId: "term" }] },
    { code: `const coverage = 1;`, errors: [{ messageId: "term" }] },
    { code: `<Foo project_manager="x" />`, errors: [{ messageId: "term" }] },
  ],
});

jsonTester.run("json-no-avoid-terms", rules["json-no-avoid-terms"], {
  valid: [`{ "members": { "title": "Members", "intro": "People of your Company" } }`, `{ "form": { "template": "Pick a Form" } }`],
  invalid: [
    { code: `{ "tenant": { "title": "Companies" } }`, errors: [{ messageId: "key" }] },
    { code: `{ "home": { "intro": "Welcome, tenant" } }`, errors: [{ messageId: "value" }] },
    { code: `{ "members": { "title": "Users" } }`, errors: [{ messageId: "value" }] },
    { code: `{ "form": { "label": "Template" } }`, errors: [{ messageId: "value" }] },
  ],
});
