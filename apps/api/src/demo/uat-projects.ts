import type { Db } from "@rabaed/db";
import type { FastifyInstance } from "fastify";
import { addSampleProject, type SampleLog, type SampleProjectResult } from "./sample-project.ts";
import { UAT_ROLES, uatPeople, uatRecords, type UatRole } from "./uat-projects-plan.ts";

// The UAT Projects (RP-1246, RP-1248): one Project per role, each built as the sample Project is
// (RP-1217), through the api's own routes as the demo's people, with the same Companies, people and
// make, and its role's staged items instead of the sample's records. Idempotent as addSampleProject is:
// a second run adds nothing. Its items are raised one at a time, in the plan's order, so each gets the
// Document Number the hand-run sheet names. It needs the file store, as the sample Project does.

/**
 * Adds every UAT Project in `roles` (all of them when left out) that is not there yet, and what is missing
 * from one that is. Counts only in the log: UAT's job log is public.
 */
export async function addUatProjects(
  app: FastifyInstance,
  migrator: Db,
  password: string,
  { log = () => {}, roles = UAT_ROLES }: { log?: SampleLog; roles?: UatRole[] } = {},
): Promise<Record<string, SampleProjectResult>> {
  const results: Record<string, SampleProjectResult> = {};
  for (const role of roles) {
    results[role.code] = await addSampleProject(app, migrator, password, {
      project: { code: role.code, name: role.name },
      records: uatRecords(role),
      people: uatPeople(role),
      concurrency: 1,
      log: (line) => log(line.replace(/^sample project:/, `${role.code}:`)),
    });
  }
  return results;
}
