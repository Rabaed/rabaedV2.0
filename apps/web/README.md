# @rabaed/web

The Next.js app (App Router, next-intl). Read `AGENTS.md` first: this is not the Next.js you know.

## Route map

Every `page.tsx` under `apps/web/src/app/[locale]/`. There is no `(app)` route group: the signed-in pages sit directly under `[locale]`, and `layout.tsx` picks the app shell for a signed-in Member and a plain centred page otherwise. `scripts/ui-route-maps.test.ts` fails the unit tests when a path below no longer exists or a `page.tsx` is not listed here.

| Page (`page.tsx` under `[locale]/`) | URL (after `/<locale>`) | What it shows |
|---|---|---|
| `page.tsx` | `/` | Home across the Member's Projects; the welcome when signed out |
| `sign-in/page.tsx` | `/sign-in` | Sign-in form |
| `accept-invitation/page.tsx` | `/accept-invitation` | Accept an invitation to a Company or Project |
| `health/page.tsx` | `/health` | API health check |
| `profile/page.tsx` | `/profile` | The Member's profile and notification settings |
| `notifications/page.tsx` | `/notifications` | The Member's notifications, newest first, each linking to its item |
| `members/page.tsx` | `/members` | The Company's Members (the Authorized Person manages them) |
| `participants/page.tsx` | `/participants` | Projects the Company takes part in, and invitations to accept |
| `participants/[participantId]/page.tsx` | `/participants/:participantId` | One Participant and its Project Members |
| `participants/[participantId]/members/[memberId]/visibility/page.tsx` | `/participants/:participantId/members/:memberId/visibility` | Narrow a Project Member's Visibility |
| `projects/page.tsx` | `/projects` | Projects list (cards and browser), create a Project |
| `projects/[projectId]/page.tsx` | `/projects/:projectId` | Project dashboard |
| `projects/[projectId]/activity/page.tsx` | `/projects/:projectId/activity` | Activity Feed at full height |
| `projects/[projectId]/work-items/page.tsx` | `/projects/:projectId/work-items` | Submittals tab: List or Kanban |
| `projects/[projectId]/work-items/new/page.tsx` | `/projects/:projectId/work-items/new` | Create a Submittal in Draft: Type picker, `?type=` (RP-590) |
| `projects/[projectId]/work-items/import/page.tsx` | `/projects/:projectId/work-items/import` | Import register: the Submittal Register Import wizard (RP-637) |
| `projects/[projectId]/work-items/imports/page.tsx` | `/projects/:projectId/work-items/imports` | Imports: the Company's Submittal Register Imports on the Project (RP-637) |
| `projects/[projectId]/work-items/imports/[importId]/page.tsx` | `/projects/:projectId/work-items/imports/:importId` | One import: its mapping and each row's Draft or reasons (RP-637) |
| `projects/[projectId]/[moduleTab]/page.tsx` | `/projects/:projectId/:moduleTab` | Any other Module's tab (Inspections, Snag List...), same List or Kanban |
| `projects/[projectId]/settings/page.tsx` | `/projects/:projectId/settings` | Redirects to Document Numbering |
| `projects/[projectId]/settings/numbering/page.tsx` | `/projects/:projectId/settings/numbering` | Document Numbering settings |
| `projects/[projectId]/settings/trades-locations/page.tsx` | `/projects/:projectId/settings/trades-locations` | Trades, Scopes, Sub-scopes and Locations |
| `projects/[projectId]/settings/approved-suppliers/page.tsx` | `/projects/:projectId/settings/approved-suppliers` | The Approved Supplier List: suppliers per Trade; a Project Admin adds and withdraws (RP-592) |
| `projects/[projectId]/settings/modules/page.tsx` | `/projects/:projectId/settings/modules` | Where Modules show: "Show Inspections in Submittals"; a Project Admin turns it on or off (RP-652) |
| `projects/[projectId]/settings/required-links/page.tsx` | `/projects/:projectId/settings/required-links` | Required links: which link questions an item can't leave Draft without, such as the WIR's Approved submittals; a Project Admin turns each on (RP-82) |
| `projects/[projectId]/settings/checklist-templates/page.tsx` | `/projects/:projectId/settings/checklist-templates` | Checklist Templates: the Project's official checklists per Trade, which a WIR picks; every Member reads them (RP-651) |
| `projects/[projectId]/settings/checklist-templates/[templateId]/page.tsx` | `/projects/:projectId/settings/checklist-templates/:templateId` (`new` for a new one) | One Checklist Template: its names, Trade and items, and the items as a WIR shows them; a Project Admin edits it into its next Version or retires it (RP-651) |
| `projects/[projectId]/settings/visibility/page.tsx` | `/projects/:projectId/settings/visibility` | What each Participant is granted |
| `projects/[projectId]/settings/workflows/page.tsx` | `/projects/:projectId/settings/workflows` | Each Work Item Type's Workflow, Version, exceptions; duplicate, Library, versions (RP-441) |
| `projects/[projectId]/settings/workflows/[workflowId]/page.tsx` | `/projects/:projectId/settings/workflows/:workflowId` | Workflow builder |
| `projects/[projectId]/settings/workflows/[workflowId]/versions/[versionNo]/page.tsx` | `/projects/:projectId/settings/workflows/:workflowId/versions/:versionNo` | One published Version, read-only, with the Screens it pins |
| `projects/[projectId]/settings/screens/page.tsx` | `/projects/:projectId/settings/screens` | The Project's Screens and their Versions |
| `projects/[projectId]/settings/screens/[screenId]/page.tsx` | `/projects/:projectId/settings/screens/:screenId` | Screen editor: fields, save draft, publish, pins |
| `projects/[projectId]/settings/stages/page.tsx` | `/projects/:projectId/settings/stages` | Stages per Module |
| `projects/[projectId]/settings/outcomes/page.tsx` | `/projects/:projectId/settings/outcomes` | Outcomes per Work Item Type |
| `library/page.tsx` | `/library` | My Company's Library: Workflows (RP-442) |
| `library/workflows/[workflowId]/page.tsx` | `/library/workflows/:workflowId` | A Library Workflow: builder for the Authorized Person, map for others |
| `work-items/[workItemId]/page.tsx` | `/work-items/:workItemId` | One item: Form, Steps, Links, Documents |
| `packages/[packageId]/page.tsx` | `/packages/:packageId` | One Package: its submittals, counts, rename, delete, Add items, Submit Package (RP-659); its notifications link here |
| `work-items/[workItemId]/print/page.tsx` | `/work-items/:workItemId/print` | The item's final output laid out to print (Download) |
| `work-items/[workItemId]/links/[linkId]/page.tsx` | `/work-items/:workItemId/links/:linkId` | Where a Link opens (the item, or only its number and subject) |
| `[...rest]/page.tsx` | any other URL | 404 |

### Parallel slots

`layout.tsx` fills the top bar and the Project tabs from two slots, each with its own `page.tsx` per route: `@heading/` (the top bar title) and `@tabs/` (the Project tabs band). They cover only Home, `members` (heading only), `projects`, `projects/[projectId]` and a catch-all `[...rest]`, and show no page content of their own; the test skips them. `default.tsx` is the 404 when the main slot can't be recovered. A new page that needs a title or tabs needs a matching file in both slots.
