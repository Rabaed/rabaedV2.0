import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import rabaed from "./index.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ts = new RuleTester({ languageOptions: { parser: tseslint.parser } });

ts.run("order-by-tiebreaker", rabaed.rules["order-by-tiebreaker"], {
  valid: [
    `db.selectFrom("admin_action").orderBy("at").orderBy("id").execute();`,
    `db.selectFrom("admin_action").orderBy("a.at", "desc").orderBy("a.id", "desc").execute();`,
    `db.selectFrom("chat_message").orderBy("created_at").orderBy("seq").execute();`,
    // Not a timestamp: a Document Number, a name, a number.
    `db.selectFrom("work_item").orderBy("document_number").execute();`,
    `db.selectFrom("company").orderBy("c.legal_name").execute();`,
    `db.selectFrom("form_version").orderBy("version_no", "desc").execute();`,
    // Names that only end in "at" are no timestamp.
    `db.selectFrom("x").orderBy("format").orderBy("seat").execute();`,
    // The array form, tie broken.
    `db.selectFrom("admin_action").orderBy(["at", "id"]).execute();`,
    // A key the rule can't read is left alone.
    `db.selectFrom("x").orderBy(sql\`coalesce(a, b)\`).execute();`,
    `db.selectFrom("x").orderBy((eb) => eb.ref("at")).execute();`,
    `db.selectFrom("x").orderBy(column).execute();`,
    // The tiebreaker after other calls in between.
    `db.selectFrom("x").orderBy("created_at", "desc").limit(10).orderBy("id", "desc").execute();`,
  ],
  invalid: [
    { code: `db.selectFrom("admin_action").select("reason").orderBy("at").execute();`, errors: [{ messageId: "untied", data: { key: "at" } }] },
    { code: `db.selectFrom("admin_action").orderBy("a.at", "desc").execute();`, errors: [{ messageId: "untied", data: { key: "a.at" } }] },
    { code: `db.selectFrom("option_list").orderBy("created_at").execute();`, errors: [{ messageId: "untied", data: { key: "created_at" } }] },
    // The timestamp breaks the tie of another key, but nothing breaks its own.
    { code: `db.selectFrom("x").orderBy("kind").orderBy("updated_at").execute();`, errors: [{ messageId: "untied", data: { key: "updated_at" } }] },
    // Kysely's older "column direction" string.
    { code: `db.selectFrom("x").orderBy("created_at desc").execute();`, errors: [{ messageId: "untied", data: { key: "created_at" } }] },
    { code: `db.selectFrom("x").orderBy(["kind", "at"]).execute();`, errors: [{ messageId: "untied", data: { key: "at" } }] },
    // A tie is still a coin toss when only one row is kept.
    { code: `db.selectFrom("x").orderBy("created_at", "desc").limit(1).executeTakeFirst();`, errors: [{ messageId: "untied", data: { key: "created_at" } }] },
    // The query built in a helper and returned.
    { code: `const actionsOn = (id) => db.selectFrom("admin_action").where("target_id", "=", id).orderBy("at");`, errors: [{ messageId: "untied", data: { key: "at" } }] },
  ],
});
