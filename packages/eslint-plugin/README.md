# @rabaed/eslint-plugin

Rabaed's own lint rules. Rules and the lists they read are in `src/`; `pnpm lint` runs them.

## Glossary Avoid terms (`rabaed/no-avoid-terms`, `rabaed/json-no-avoid-terms`)

The banned words are the `_Avoid_` lines of `GLOSSARY.md`, read when ESLint loads the plugin. The rule checks identifiers, strings and JSX text in `apps/**`, `packages/**` and `scripts/**` (tests, stories and a few named files are ignored in `eslint.config.js`), and the keys and text of `apps/web/messages/*.json`.

Run `pnpm lint` before your first commit. Scripts and message files are linted too, and CI fails on a hit you did not see locally. A new _Avoid_ line in `GLOSSARY.md` is checked the same way before the glossary change merges, since it can break files nobody touched (one planning-session _Avoid_ word broke 42 files).

### Common false hits

The word is a real code or English word, not the Rabaed term. Seen so far:

- A code name from a library or the platform: `note` as a `MarkerType` or `currentNote`, `state`, `name`, `action`, `status`, an icon named `user`, React Flow's `arrowhead`.
- A one-word label such as "List", "Follow" or "Status" in `messages/en.json`.
- Plain English that happens to contain the word: "Check the email", "full name", "files" in a CLI message, "names" in a script's output.
- A real word of another domain: a "panel" in an electrical datasheet, a Docker Compose service called `files`.

Try the fixes in this order. Do not rename the code or the copy just to dodge the rule when the glossary term fits, and never add a bare word to `allowedInText`.

1. **Use the glossary term.** Most hits are real. Look up the Avoid line and write the term it names.
2. **Narrow it to a phrase in `allowedInText`** (`src/avoid-rules.ts`), when the same words will recur in copy, a log line or an error. The phrase, never the bare word, with a comment saying what it is.

   ```ts
   "check the", // the verb, asking the reader to look again ("Check the email"), not an Inspection.
   "full name", // a Member's full name (`member.full_name`).
   ```

   A code name that has an established meaning goes in `allowedInNames` instead, with the reason in the comment (`"state", // React's useState, Radix's data-[state=…] and the OAuth state parameter.`). Code names only: it never applies to copy.
3. **A one-word label in a message file** cannot be narrowed to a phrase, and JSON takes no comments. Add its key path to `allowedMessages` with the reason as the value:

   ```ts
   "workItemViews.viewSwitch.list": "the List view beside the Kanban (spec RP-344), not an Option List",
   ```

4. **A single spot in code:** `eslint-disable-next-line` with a reason after ` -- `. The reason says what the word is, in this place.

   ```ts
   // eslint-disable-next-line rabaed/no-avoid-terms -- `files` is the Docker Compose service's name, not a Document
   // eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy
   {/* eslint-disable-next-line rabaed/no-avoid-terms -- the Tabler icon's name: a person holds the Step. */}
   ```

   In JSX text use the `{/* … */}` form. For a block of lines use `/* eslint-disable rabaed/no-avoid-terms -- reason */` and re-enable after it (`apps/api/src/demo/seed.ts`). Always give the reason; every disable of this rule in the repo has one.

A whole file the rule should skip (it quotes the terms by design, or speaks another system's vocabulary) is added to `ignores` in `eslint.config.js`, with a comment. That is rare; prefer the narrower fixes.

## Rabaed Admin runs the api's code as the app role (`rabaed/admin-api-as-app-role`)

Rabaed Admin connects as `rabaed_admin`, which bypasses row-level security. In `apps/admin` (tests aside), a function imported from `@rabaed/api`, or by path from `apps/api/`, may only be called with an importer as its first argument: a call to one of the rule's `importers`, declared at the top of its `module` or imported from there (both options are in `eslint.config.js`), directly or through a `const` that is only ever passed on. Their steps run `set local role rabaed_app` (RP-960), so the api's reads stay held to row-level security as the Member acted as (RP-987). Type imports are free. A namespace import, a re-export or a dynamic import of the api is refused, since its calls could not be checked.

A new kind of Admin step on the api's code gets its own importer in that module, which switches to the app role, and a seam test that its statements ran as `rabaed_app` (`packages/db/test-support/statement-roles.ts`, as in `apps/admin/test/register-import.test.ts`). Only then is it added to `importers`. The rule checks Admin's own files only: a workspace package that wrapped the api for Admin would not be checked.

## No plural `#` in message files (`rabaed/json-no-plural-pound`)

In an ICU `plural` or `selectordinal`, `#` prints the count through the locale's own number format, which can render Arabic-Indic digits in Arabic, against the Latin-digits rule. In `apps/web/messages/*.json` the rule fails a `#` inside either, read as intl-messageformat (next-intl's) reads it: a `#` in a `select`'s branch, even inside a plural, and a quoted `'#'` are plain text and pass. Write `{n}` instead, and pass the count twice: `count` for the plural to choose its branch, `n: formatNumber(count, locale)` for the text (RP-1022).

## No `.slice()` on a Buffer (`rabaed/no-buffer-slice`)

On a `Buffer`, `.slice()` does not copy, unlike `Array#slice` and `Uint8Array#slice`: it returns a view on the same memory, and a small Buffer's memory is Node's shared pool. RP-635's spreadsheet reader passed such a view to fflate, and every `.xlsx` test failed on Linux CI while passing on Windows (RP-1025). Write `.subarray()` when you mean a view, or `Buffer.from(buf.subarray(…))` for a copy; the rule offers both as suggestions.

The rule reads types: it fails a `.slice()` whose object is typed `Buffer` (or a union with one), so it runs only where `eslint.config.js` lints with `parserOptions.projectService`, the Node code in `apps/{api,worker,admin}` and `packages/{auth,db,domain,infra,mailer}`, and it throws on a file linted without type information. `scripts/` has no tsconfig, so it is not checked, and a Buffer typed as `Uint8Array` passes.
