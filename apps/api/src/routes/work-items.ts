import {
  createdWorkItem,
  createWorkItemRequest,
  takeTransitionRequest,
  workItemDetail,
  workItemHistory,
  workItemList,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { refusal } from "../refusals.ts";
import {
  claimStep,
  createWorkItem,
  getWorkItem,
  getWorkItemHistory,
  listWorkItems,
  releaseStep,
  takeTransition,
} from "../work-items/work-items.ts";

const projectParams = z.object({ projectId: z.string() });
const workItemParams = z.object({ workItemId: z.string() });

// Work Items. A Member sees only the items that pass every visibility layer;
// anything else answers exactly like an item that doesn't exist (404), and is
// never counted.
export const workItemRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      "/v1/projects/:projectId/work-items",
      { schema: { params: projectParams, body: createWorkItemRequest, response: { 201: createdWorkItem } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        const result = await createWorkItem(ctx.db, memberId, projectId, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ id: result.id });
      },
    );

    app.get(
      "/v1/projects/:projectId/work-items",
      { schema: { params: projectParams, response: { 200: workItemList } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(listWorkItems(ctx.db, memberId, idOrNotFound(request.params.projectId), ctx.now()));
      },
    );

    app.get(
      "/v1/work-items/:workItemId",
      { schema: { params: workItemParams, response: { 200: workItemDetail } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getWorkItem(ctx.db, memberId, idOrNotFound(request.params.workItemId), ctx.now()));
      },
    );

    app.get(
      "/v1/work-items/:workItemId/history",
      { schema: { params: workItemParams, response: { 200: workItemHistory } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getWorkItemHistory(ctx.db, memberId, idOrNotFound(request.params.workItemId)));
      },
    );

    // Moving an item. A refusal changes nothing.
    app.post(
      "/v1/work-items/:workItemId/transitions",
      { schema: { params: workItemParams, body: takeTransitionRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const result = await takeTransition(ctx.db, memberId, id, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );

    app.post("/v1/work-items/:workItemId/claim", { schema: { params: workItemParams } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const result = await claimStep(ctx.db, memberId, idOrNotFound(request.params.workItemId), ctx.now());
      if (!result.ok) throw refusal(result);
      return reply.code(204).send();
    });

    app.post("/v1/work-items/:workItemId/release", { schema: { params: workItemParams } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const result = await releaseStep(ctx.db, memberId, idOrNotFound(request.params.workItemId), ctx.now());
      if (!result.ok) throw refusal(result);
      return reply.code(204).send();
    });
  };
