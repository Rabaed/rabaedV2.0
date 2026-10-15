import { validateRabaedDefaultWorkflow } from "@rabaed/db";
import { rabaedWorkflowRequest, validateWorkflowRequest, type RabaedDefaultLackRefusal } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, type AdminContext } from "../app.ts";
import { writeRabaedWorkflow } from "../workflows.ts";

// Rabaed Default Workflows (RP-427): a Rabaed Engineer checks, saves and publishes a
// Work Item Type's Rabaed Default. Saving and publishing need a reason. A refused
// definition answers 422 with where it doesn't fit the format (`issues`) or every
// publish problem (`problems`); a Version some Active Project running the Rabaed Default couldn't run, how
// many Projects lack which outcomes and Stages (`projects_lack_entries`, RP-566); an unknown Type 404.
export const workflowRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    const typeParams = z.object({ typeCode: z.string().trim().min(1).max(32) });
    // `?workflow=` names one of the Type's other Rabaed Defaults (RP-596); without it, the one the Type runs.
    const workflowQuery = z.object({ workflow: z.uuid().optional() });

    app.post("/v1/workflows/:typeCode/validate", { schema: { params: typeParams, querystring: workflowQuery, body: validateWorkflowRequest } }, async (request) => {
      const result = await validateRabaedDefaultWorkflow(ctx.db, request.params.typeCode, request.body.definition, request.query.workflow);
      if (!result) throw new HttpError(404, "not_found");
      return result;
    });

    for (const [path, publish] of [
      ["draft", false],
      ["publish", true],
    ] as const) {
      app.post(`/v1/workflows/:typeCode/${path}`, { schema: { params: typeParams, querystring: workflowQuery, body: rabaedWorkflowRequest } }, async (request, reply) => {
        const result = await writeRabaedWorkflow(ctx.db, ctx.requireEngineer(request), request.params.typeCode, request.body, {
          publish,
          workflowId: request.query.workflow,
        });
        if (result.ok) return reply.code(200).send({ versionNo: result.versionNo });
        if (result.reason === "type_not_found") throw new HttpError(404, "not_found");
        if (result.reason === "invalid_definition") return reply.code(422).send({ error: result.reason, issues: result.issues });
        // How many Projects and which entries, never which Projects (RP-566, V9).
        if (result.reason === "projects_lack_entries") {
          const body: RabaedDefaultLackRefusal = { error: result.reason, projects: result.projects, outcomes: result.outcomes, stages: result.stages };
          return reply.code(422).send(body);
        }
        return reply.code(422).send({ error: result.reason, problems: result.problems });
      });
    }
  };
