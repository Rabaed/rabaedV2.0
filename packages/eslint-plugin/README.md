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
