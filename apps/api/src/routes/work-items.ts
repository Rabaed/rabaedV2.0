import { createdWorkItem, createWorkItemRequest, workItemDetail, workItemList } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notFound } from "../http-error.ts";
import { refusal } from "../refusals.ts";
import { createWorkItem, getWorkItem, listWorkItems } from "../work-items/work-items.ts";

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
        const list = await listWorkItems(ctx.db, memberId, idOrNotFound(request.params.projectId), ctx.now());
        if (!list) throw notFound();
        return list;
      },
    );

    app.get(
      "/v1/work-items/:workItemId",
      { schema: { params: workItemParams, response: { 200: workItemDetail } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const item = await getWorkItem(ctx.db, memberId, idOrNotFound(request.params.workItemId), ctx.now());
        if (!item) throw notFound();
        return item;
      },
    );
  };
