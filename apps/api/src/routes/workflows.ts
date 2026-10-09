import { bindWorkflowRequest, duplicateWorkflowRequest, saveWorkflowDraftRequest, unbindWorkflowQuery, validateWorkflowRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { bindWorkflow, duplicateWorkflow, publishWorkflow, readWorkflow, saveWorkflowDraft, unbindWorkflow, validateWorkflow } from "../projects/workflows.ts";
import { refusal } from "../refusals.ts";

const workflowParams = z.object({ workflowId: z.string() });
const projectParams = z.object({ projectId: z.string() });

// Workflow authoring (RP-427, WF-4; workflow-engine.md §1 "Authoring"). Every Member of a
// Project reads its Workflows, and a Company its Library (V18, V20); only their authors
// (the Project Admins, the Authorized Person) read a draft or change them. Anyone else,
// and a made-up id, gets the same 404.
export const workflowRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/workflows/:workflowId", { schema: { params: workflowParams } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(readWorkflow(ctx.db, memberId, idOrNotFound(request.params.workflowId)));
    });

    app.post(
      "/v1/workflows/:workflowId/duplicate",
      { schema: { params: workflowParams, body: duplicateWorkflowRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await duplicateWorkflow(ctx.db, memberId, idOrNotFound(request.params.workflowId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ id: result.id });
      },
    );

    app.put("/v1/workflows/:workflowId/draft", { schema: { params: workflowParams, body: saveWorkflowDraftRequest } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const result = await saveWorkflowDraft(ctx.db, memberId, idOrNotFound(request.params.workflowId), request.body, ctx.now());
      if (!result.ok) throw refusal(result);
      return { versionNo: result.versionNo };
    });

    app.post("/v1/workflows/:workflowId/validate", { schema: { params: workflowParams, body: validateWorkflowRequest } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(validateWorkflow(ctx.db, memberId, idOrNotFound(request.params.workflowId), request.body.definition));
    });

    app.post("/v1/workflows/:workflowId/publish", { schema: { params: workflowParams } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const result = await publishWorkflow(ctx.db, memberId, idOrNotFound(request.params.workflowId), ctx.now());
      if (!result.ok) throw refusal(result);
      return { versionNo: result.versionNo, warnings: result.warnings };
    });

    app.put(
      "/v1/projects/:projectId/workflow-bindings",
      { schema: { params: projectParams, body: bindWorkflowRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await bindWorkflow(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );

    app.delete(
      "/v1/projects/:projectId/workflow-bindings",
      { schema: { params: projectParams, querystring: unbindWorkflowQuery } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await unbindWorkflow(ctx.db, memberId, idOrNotFound(request.params.projectId), request.query, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
