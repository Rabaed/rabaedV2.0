import type { Db } from "@rabaed/db";
import type { FastifyInstance } from "fastify";
import { buildSampleProject, inParallel, signInAll, withSampleLock, type SampleLog, type SampleProjectResult } from "./sample-project.ts";
import { UAT_ROLES, uatPeople, uatRecords, type UatRole } from "./uat-projects-plan.ts";

// The UAT Projects (RP-1246, RP-1248): one Project per role, each built as the sample Project is
// (RP-1217), through the api's own routes as the demo's people, with the same Companies, people and
// make, and its role's staged items instead of the sample's records. Idempotent as addSampleProject is:
// a second run adds nothing. Within a Project its items are raised one at a time, in the plan's order,
// so each gets the Document Number the hand-run sheet names. It needs the file store, as the sample Project does.
//
// Over the network to UAT's database each api call costs round trips, so (RP-1254) the demo people sign
// in once for every Project, and `concurrency` Projects are built at once: each Project numbers its own
// Documents (numbering_counter is per Project), so building them side by side changes no number.

/** Seconds, to a tenth: what the timing lines print. */
const seconds = (since: number) => `${((performance.now() - since) / 1000).toFixed(1)} s`;

/**
 * Adds every UAT Project in `roles` (all of them when left out) that is not there yet, and what is missing
 * from one that is, `concurrency` Projects at a time. Prints each Project's time and the total. Counts and
 * times only in the log: UAT's job log is public.
 */
export async function addUatProjects(
  app: FastifyInstance,
  migrator: Db,
  password: string,
  { log = () => {}, roles = UAT_ROLES, concurrency = 4 }: { log?: SampleLog; roles?: UatRole[]; concurrency?: number } = {},
): Promise<Record<string, SampleProjectResult>> {
  const start = performance.now();
  const results: Record<string, SampleProjectResult> = {};
  await withSampleLock(migrator, async (connection) => {
    const as = await signInAll(app, password);
    // The biggest first, so the last to start are short and the run does not trail on one long Project.
    const size = (role: UatRole) => {
      const r = uatRecords(role);
      return r.submittals.length + r.snags.length + r.inspections.length + (r.dars?.length ?? 0) + r.packages.length;
    };
    await inParallel(
      [...roles].sort((a, b) => size(b) - size(a)).map((role) => async () => {
        const began = performance.now();
        results[role.code] = await buildSampleProject(as, connection, {
          project: { code: role.code, name: role.name },
          records: uatRecords(role),
          people: uatPeople(role),
          concurrency: 1,
          log: (line) => log(line.replace(/^sample project:/, `${role.code}:`)),
        });
        log(`seeded UAT ${role.n} in ${seconds(began)}`);
      }),
      concurrency,
    );
  });
  log(`seeded ${roles.length} UAT Project(s) in ${seconds(start)}`);
  // In the plan's order, as before, whichever finished first.
  return Object.fromEntries(roles.map((r) => [r.code, results[r.code]!]));
}
