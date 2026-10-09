import { validateRabaedDefaultWorkflow } from "@rabaed/db";
import { rabaedWorkflowRequest, validateWorkflowRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, type AdminContext } from "../app.ts";
import { writeRabaedWorkflow } from "../workflows.ts";

// Rabaed Default Workflows (RP-427): a Rabaed Engineer checks, saves and publishes a
// Work Item Type's Rabaed Default. Saving and publishing need a reason. A refused
// definition answers 422 with where it doesn't fit the format (`issues`) or every
// publish problem (`problems`); an unknown Type 404.
export const workflowRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    // Signed in before the body is validated, so a stranger learns nothing of the
    // routes' schemas; the handlers then read the id the check found.
    const signedIn = {
      onRequest: async (request: Parameters<AdminContext["requireEngineer"]>[0]) => {
        ctx.requireEngineer(request);
      },
    };
    const engineerOf = (request: { engineerId: string | null }): string => request.engineerId!;
    const typeParams = z.object({ typeCode: z.string().trim().min(1).max(32) });

    app.post("/v1/workflows/:typeCode/validate", { ...signedIn, schema: { params: typeParams, body: validateWorkflowRequest } }, async (request) => {
      const result = await validateRabaedDefaultWorkflow(ctx.db, request.params.typeCode, request.body.definition);
      if (!result) throw new HttpError(404, "not_found");
      return result;
    });

    for (const [path, publish] of [
      ["draft", false],
      ["publish", true],
    ] as const) {
      app.post(`/v1/workflows/:typeCode/${path}`, { ...signedIn, schema: { params: typeParams, body: rabaedWorkflowRequest } }, async (request, reply) => {
        const result = await writeRabaedWorkflow(ctx.db, engineerOf(request), request.params.typeCode, request.body, { publish });
        if (result.ok) return reply.code(200).send({ versionNo: result.versionNo });
        if (result.reason === "type_not_found") throw new HttpError(404, "not_found");
        if (result.reason === "invalid_definition") return reply.code(422).send({ error: result.reason, issues: result.issues });
        return reply.code(422).send({ error: result.reason, problems: result.problems });
      });
    }
  };
