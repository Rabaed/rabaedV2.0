import {
  adminAddOutcomeRequest,
  adminAddStageRequest,
  adminChangeOutcomeRequest,
  adminDuplicateWorkflowRequest,
  adminRenameStageRequest,
  adminReorderOutcomesRequest,
  adminReorderStagesRequest,
  moduleKeySchema,
  outcomeCode,
  stageKey,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, type AdminContext } from "../app.ts";
import {
  addDefaultOutcome,
  addDefaultStage,
  changeDefaultOutcome,
  duplicateRabaedWorkflow,
  listRabaedWorkflows,
  readRabaedWorkflow,
  renameDefaultStage,
  reorderDefaultOutcomes,
  reorderDefaultStages,
  type SetRefusal,
} from "../workflow-defaults.ts";

/** The status each refusal of a Rabaed Default set edit answers with; its code is the refusal's own. */
const setRefusalStatus: Record<SetRefusal, number> = { not_found: 404, already_exists: 409, invalid_order: 422 };
const refusedSet = (reason: SetRefusal) => new HttpError(setRefusalStatus[reason], reason);

// Rabaed Admin -> Workflows (RP-443, WF-20): the Rabaed Defaults per Work Item Type with their
// Versions, the builder's read of one, duplicating, and the Rabaed Default outcome and Stage
// sets. Reads ask for no reason (Rabaed's own data); every change needs one, logged in
// admin_action (V9). Saving, checking and publishing a Workflow are in ./workflows.ts.
export const workflowDefaultRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    const typeParams = z.object({ typeCode: z.string().trim().min(1).max(32) });
    const outcomeParams = typeParams.extend({ code: outcomeCode });
    const moduleParams = z.object({ moduleKey: moduleKeySchema });
    const stageParams = moduleParams.extend({ key: stageKey });

    app.get("/v1/workflows", async () => ({ types: await listRabaedWorkflows(ctx.db) }));

    app.get("/v1/workflows/:typeCode", { schema: { params: typeParams } }, async (request) => {
      const read = await readRabaedWorkflow(ctx.db, request.params.typeCode);
      if (!read) throw new HttpError(404, "not_found");
      return read;
    });

    app.post("/v1/workflows/:typeCode/duplicate", { schema: { params: typeParams, body: adminDuplicateWorkflowRequest } }, async (request, reply) => {
      const result = await duplicateRabaedWorkflow(ctx.db, ctx.requireEngineer(request), request.params.typeCode, request.body);
      if (result.ok) return reply.code(200).send(result.value);
      if (result.reason === "not_found") throw new HttpError(404, "not_found");
      return reply.code(422).send({ error: result.reason });
    });

    app.post("/v1/workflows/:typeCode/outcomes", { schema: { params: typeParams, body: adminAddOutcomeRequest } }, async (request, reply) => {
      const result = await addDefaultOutcome(ctx.db, ctx.requireEngineer(request), request.params.typeCode, request.body);
      if (!result.ok) throw refusedSet(result.reason);
      return reply.code(200).send({});
    });

    // Before `:code`, so "order" is never read as an outcome code.
    app.post("/v1/workflows/:typeCode/outcomes/order", { schema: { params: typeParams, body: adminReorderOutcomesRequest } }, async (request, reply) => {
      const result = await reorderDefaultOutcomes(ctx.db, ctx.requireEngineer(request), request.params.typeCode, request.body);
      if (!result.ok) throw refusedSet(result.reason);
      return reply.code(200).send({});
    });

    app.post("/v1/workflows/:typeCode/outcomes/:code", { schema: { params: outcomeParams, body: adminChangeOutcomeRequest } }, async (request, reply) => {
      const result = await changeDefaultOutcome(ctx.db, ctx.requireEngineer(request), request.params.typeCode, request.params.code, request.body);
      if (!result.ok) throw refusedSet(result.reason);
      return reply.code(200).send({});
    });

    app.post("/v1/stages/:moduleKey", { schema: { params: moduleParams, body: adminAddStageRequest } }, async (request, reply) => {
      const result = await addDefaultStage(ctx.db, ctx.requireEngineer(request), request.params.moduleKey, request.body);
      if (!result.ok) throw refusedSet(result.reason);
      return reply.code(200).send({});
    });

    app.post("/v1/stages/:moduleKey/order", { schema: { params: moduleParams, body: adminReorderStagesRequest } }, async (request, reply) => {
      const result = await reorderDefaultStages(ctx.db, ctx.requireEngineer(request), request.params.moduleKey, request.body);
      if (!result.ok) throw refusedSet(result.reason);
      return reply.code(200).send({});
    });

    app.post("/v1/stages/:moduleKey/:key", { schema: { params: stageParams, body: adminRenameStageRequest } }, async (request, reply) => {
      const result = await renameDefaultStage(ctx.db, ctx.requireEngineer(request), request.params.moduleKey, request.params.key, request.body);
      if (!result.ok) throw refusedSet(result.reason);
      return reply.code(200).send({});
    });
  };
