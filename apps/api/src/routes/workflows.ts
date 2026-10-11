import {
  bindWorkflowRequest,
  duplicateWorkflowRequest,
  saveWorkflowDraftRequest,
  saveWorkflowToLibraryRequest,
  unbindWorkflowQuery,
  validateWorkflowRequest,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import {
  bindWorkflow,
  duplicateWorkflow,
  listLibraryWorkflows,
  publishWorkflow,
  readWorkflow,
  readWorkflowBuilder,
  readWorkflowMap,
  saveWorkflowDraft,
  saveWorkflowToLibrary,
  unbindWorkflow,
  validateWorkflow,
} from "../projects/workflows.ts";
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

    // What the builder edits with (RP-439, WF-16): its authors only, the same 404 for anyone else.
    app.get("/v1/workflows/:workflowId/builder", { schema: { params: workflowParams } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(readWorkflowBuilder(ctx.db, memberId, idOrNotFound(request.params.workflowId)));
    });

    // A Workflow to look at (RP-442, WF-19): whoever reads it, the draft only for its authors.
    app.get("/v1/workflows/:workflowId/map", { schema: { params: workflowParams } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(readWorkflowMap(ctx.db, memberId, idOrNotFound(request.params.workflowId)));
    });

    // The Company's Library of Workflows (RP-442, WF-19; V18): its own Members only.
    app.get("/v1/library/workflows", async (request) => {
      const memberId = ctx.requireMember(request);
      return listLibraryWorkflows(ctx.db, memberId);
    });

    // "Save to my Company's Library": a copy of a Workflow the Member reads, for the Authorized Person.
    app.post(
      "/v1/workflows/:workflowId/save-to-library",
      { schema: { params: workflowParams, body: saveWorkflowToLibraryRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await saveWorkflowToLibrary(ctx.db, memberId, idOrNotFound(request.params.workflowId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send(result.saved);
      },
    );

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
