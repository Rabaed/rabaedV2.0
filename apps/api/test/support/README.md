# API test helpers

Look here before writing a helper. Renaming or moving one is a shared-file change
(`docs/agents/issue-tracker.md`, shared files). The database helpers (`addTestWorkflow`,
`addRulesWorkflow`, `addActionsWorkflow`, `approveBActionForm`, `drainOutbox`, `joinProject`)
are listed at the top of `packages/db/test-support/index.ts`.

| File | Exports |
|---|---|
| `harness.ts` | `createTestApi({ files })`: a `TestApi` that onboards Companies (`onboardCompany`, `authorizedPerson`, `projectCreator`, `member`, `inviteMember`, `acceptInvitation`, `signIn`), creates Projects (`createProject`, `addParticipant`, `addProjectMember`). Every Member of the test database has a Signature by default (RP-85: no Signature, no Transition; `packages/db/test-support/test-defaults.ts`); `withoutSignature(memberId)` ends it, for a test of the gate. Every Company has a Stamp the same way (RP-617); `withoutStamp(companyId)` takes it away. It moves the clock (`later`, which signs everyone in again; `advanceClock` only to expire sessions). `Caller` is one browser's session. Also `expectHidden` (a 404 that says nothing), `uploadDocument`, `attachDatasheet` (a MAR needs one before it is sent), `testConfig`, `DEFAULT_PASSWORD`, `HOUR`, `uniqueCr`, `uniqueVat`, `uniqueEmail`. |
| `tower.ts` | `buildTower` (a Project of C1's with K1 as Consultant, an engineer, a PM and a manager), `memberOnProject`, `projectMember`, `draft`, `inInternalReview`, `submitted`, `take` and `tryTake` (a Transition), `detail`, `ok`, `bilingual`, `all` and `only` (visibility grants). |
| `foreign-project.ts` | `buildForeignProject` (RP-1016): another Company's Project with its own Trade "EL" Electrical and Location "BA" Building A (buildTower's codes and names), its own Workflow, Form and Project-level Type, a Rabaed Type on its Workflow and, with `host`, one on the host Project's Workflow with its Form. Build it in the beforeAll, before the call under test, in any test of a path that reads past row-level security (Rabaed Admin's `rabaed_admin`) or calls a security-invoker `app.*` function, so a read that crosses into another Project meets one on every run, not only when another test file makes one at the same moment. `ids` lists what a host Member's response never holds. Its Rabaed Types are global rows every test file sees while it runs, so a test that compares all Rabaed Types (`typeCodes`) with an answer leaves out Types on another Project's Workflow or Form. Also `projectWorkflow` and `projectForm`: the MAR's, copied as a Project's own. |
| `default-types.ts` | `defaultModules`, `typeCodes`: what the Rabaed Default Types are, read from the database. Use them rather than writing "the MAR and the Comment". |
| `rules.ts` | `addRulesType`, `addActionsType`: a Rabaed Type on the rules or actions Workflow. |
| `send-back.ts` | `addSendBackType`: a Rabaed Type on the test Send Back Workflow (`addTestWorkflow` options pass through). |
| `internal-steps-type.ts` | `addInternalConsultantStepsType`, `INTERNAL_STEPS_TYPE`, `MANAGER_STEP`: a Type with two Consultant Steps. |
| `checklist-template.ts` | `checklistTemplate`: a Project's Checklist Template for a WIR to pick (RP-651); `passChecklists`: the Consultant Engineer answers the WIR's checklist all Pass before Send to Manager (RP-86). |
| `copy-work-items.ts` | `copyWorkItems`, `WorkItemCopy`: many items cheaply (RP-978). Copies one Draft the api just created, as the migrator, with every row the create path wrote, under new ids, Subjects and (optionally) `created_at`, so a test that pages over dozens of items makes one through the api, not all of them. |
| `seed-demo.ts` | The global setup that seeds the demo into the test database, once. |
