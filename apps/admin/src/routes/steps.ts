import { engineerReason } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, type AdminContext } from "../app.ts";
import { findWorkItemStep, listStepProjects, reassignStep } from "../steps.ts";

const bilingual = z.object({ en: z.string(), ar: z.string() });
const projects = z.object({ projects: z.array(z.object({ id: z.uuid(), name: bilingual, code: z.string() })) });
const workItemStep = z.object({
  workItemId: z.uuid(),
  documentNumber: z.string(),
  title: z.string(),
  typeName: bilingual,
  closed: z.boolean(),
  step: z
    .object({
      name: bilingual,
      stageName: bilingual.nullable(),
      draft: z.boolean(),
      status: z.enum(["pooled", "picked_up"]),
      participant: z.object({ id: z.uuid(), companyName: bilingual, roleName: bilingual }),
      holderMemberId: z.uuid().nullable(),
      pool: z.array(z.object({ memberId: z.uuid(), name: bilingual, email: z.string() })),
    })
    .nullable(),
});

// A stuck Step from Rabaed Admin (RP-1162, UAT ADM-10): find an item by Project and Document
// Number, read its Step and holder, and reassign it within the holding Participant's pool, each
// with the Engineer's reason in admin_action (V9).
export const stepRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/steps/projects", { schema: { querystring: z.object({ reason: engineerReason }), response: { 200: projects } } }, async (request) => ({
      projects: await listStepProjects(ctx.db, ctx.requireEngineer(request), request.query.reason),
    }));

    app.get(
      "/v1/steps",
      {
        schema: {
          querystring: z.object({ projectId: z.uuid(), documentNumber: z.string().trim().min(1).max(200), reason: engineerReason }),
          response: { 200: workItemStep },
        },
      },
      async (request) => {
        const { projectId, documentNumber, reason } = request.query;
        const found = await findWorkItemStep(ctx.db, ctx.requireEngineer(request), projectId, documentNumber, reason);
        if (!found) throw new HttpError(404, "not_found");
        return found;
      },
    );

    app.post(
      "/v1/work-items/:workItemId/step/reassign",
      { schema: { params: z.object({ workItemId: z.uuid() }), body: z.object({ toMemberId: z.uuid().nullable(), reason: engineerReason }) } },
      async (request) => {
        const result = await reassignStep(ctx.db, ctx.requireEngineer(request), request.params.workItemId, request.body.toMemberId, request.body.reason);
        if (result === "not_found") throw new HttpError(404, "not_found");
        if (result !== "reassigned" && result !== "returned_to_pool") throw new HttpError(409, result);
        return { result };
      },
    );
  };
