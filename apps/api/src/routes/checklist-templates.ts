import { checklistTemplateRequest, checklistTemplates } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { createChecklistTemplate, editChecklistTemplate, listChecklistTemplates, retireChecklistTemplate } from "../projects/checklist-templates.ts";
import { refusal } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });
const templateParams = z.object({ templateId: z.string() });
const created = z.object({ id: z.uuid() });

// Project Settings → Checklist Templates (RP-651). Every Project Member of every
// Participant lists them, as they read now (each one's latest Version), never who
// wrote one or when (V20). Only a Project Admin creates, edits (the next Version) or
// retires one: anyone else gets a 404, exactly like a made-up id, so it names nothing.
export const checklistTemplateRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/projects/:projectId/checklist-templates",
      { schema: { params: projectParams, response: { 200: checklistTemplates } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(listChecklistTemplates(ctx.db, memberId, idOrNotFound(request.params.projectId)));
      },
    );

    app.post(
      "/v1/projects/:projectId/checklist-templates",
      { schema: { params: projectParams, body: checklistTemplateRequest, response: { 201: created } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await createChecklistTemplate(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ id: result.id });
      },
    );

    app.put(
      "/v1/checklist-templates/:templateId",
      { schema: { params: templateParams, body: checklistTemplateRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await editChecklistTemplate(ctx.db, memberId, idOrNotFound(request.params.templateId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );

    app.post(
      "/v1/checklist-templates/:templateId/retire",
      { schema: { params: templateParams } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await retireChecklistTemplate(ctx.db, memberId, idOrNotFound(request.params.templateId), ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
