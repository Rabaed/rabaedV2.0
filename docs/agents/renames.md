# Renaming a term, label or key, or removing a group

Read by `planning/parallel-sessions.md` (Implementer brief). A rename touches more places than the one you are editing, and CI finds the leftovers one round (about 15 minutes) at a time. RP-512 (Claim → Pick up) and RP-108 (Vacancy removed) each took two: a sweep wrote the message key into stories in place of the English text, a story still asserted a count after a group was removed, and the README walkthrough still said "Claims".

Before the first commit, grep the old term (every casing and plural, English and Arabic) and the old key across the repo, and go through this list.

1. **Messages.** `apps/web/messages/en.json` and `apps/web/messages/ar.json`: rename or remove the key in both files, and update every `t("…")` call that reads it. Keep the two files in step. `pnpm lint` checks these files against `GLOSSARY.md` _Avoid_ terms.
2. **Component labels.** Components in `packages/ui` take their text through `*Labels` props (see `packages/ui/README.md`), so rename the prop and its callers, not only the text.
3. **Story text.** Stories write their copy with a local `b(en, ar)` helper and `storyText(context, b("English text", "النص العربي"))` (from `packages/ui/src/storybook/locale.ts`). Put the new **text** there, never the message key: a sweep that turns the English into a key (`b("notPickedUp", …)`) renders the key on screen and passes nothing.
4. **Story assertions.** Search the stories (`*.stories.tsx`) for `getByText`, `getByRole`, `getAllByRole`, `toHaveLength(` and `toHaveTextContent`. Update the old text, and recount: removing a group, row, tab or option changes the numbers.
5. **README walkthrough.** `README.md`, "Demo: the MAR journey": the button table, the step table and the sentences around them, in English and Arabic.
6. **Docs.** `docs/*.md` (`data-model.md`, `workflow-engine.md`, `form-engine.md`, `visibility.md`), `docs/adr/`, `packages/ui/README.md` and `planning/`. Do not rewrite an ADR's history: add a note that the term changed, or supersede it.
7. **Glossary.** `GLOSSARY.md`: the new term, and the old one under its _Avoid_ line so `pnpm lint` catches it from then on.
8. **Migrations and SQL.** Comments in `packages/db/migrations/` and the seed. Never edit a migration that is already on `main`: add a new one, and leave the old comment. A column, enum value or function rename is a schema change, not a text change: run `pnpm check:migrations` before the PR (`planning/parallel-sessions.md`, it catches redefinitions and shared timestamps).
9. **Story baselines.** Baselines are Linux renders in `packages/ui/test/__screenshots__/`. Re-render the stories you changed with Docker Desktop running:

   ```
   pnpm test:stories:linux --update -t "<story file or name>"
   ```

   then review the changed PNGs in the diff. A bare `--update` re-renders every baseline; `--update=new` writes only the missing ones. If you cannot run Docker, add the `update-screenshots` label: the **Update screenshots** workflow then commits the changed baselines (a push alone no longer starts it, RP-1199). Either way, run `pnpm test:stories:linux -t "<story>"` (no `--update`) before pushing to see what CI will see.
10. **Check.** `pnpm lint`, `pnpm typecheck`, and the story and unit tests of what you touched.
