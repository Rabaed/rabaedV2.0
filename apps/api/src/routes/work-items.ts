import {
  createdWorkItem,
  createWorkItemRequest,
  formChoices,
  formVersion,
  saveAnswersRequest,
  takeTransitionRequest,
  workItemTypeCode,
  workItemDetail,
  workItemHistory,
  workItemList,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notFound, visibleOrNotFound } from "../http-error.ts";
import { refusal } from "../refusals.ts";
import {
  claimStep,
  createWorkItem,
  getNewWorkItemForm,
  getNewWorkItemFormChoices,
  getWorkItem,
  getWorkItemForm,
  getWorkItemFormChoices,
  getWorkItemHistory,
  listWorkItems,
  releaseStep,
  saveAnswers,
  takeTransition,
} from "../work-items/work-items.ts";

const projectParams = z.object({ projectId: z.string() });
const workItemParams = z.object({ workItemId: z.string() });
const typeFormParams = z.object({ projectId: z.string(), typeCode: z.string() });

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

    // The Form to fill for a new item of a Type: its latest published Version.
    app.get(
      "/v1/projects/:projectId/work-item-types/:typeCode/form",
      { schema: { params: typeFormParams, response: { 200: formVersion } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        const { success, data: typeCode } = workItemTypeCode.safeParse(request.params.typeCode);
        if (!success) throw notFound();
        return visibleOrNotFound(getNewWorkItemForm(ctx.db, memberId, projectId, typeCode));
      },
    );

    // The Form Version an item is pinned to; its answers come with the item.
    app.get(
      "/v1/work-items/:workItemId/form",
      { schema: { params: workItemParams, response: { 200: formVersion } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getWorkItemForm(ctx.db, memberId, idOrNotFound(request.params.workItemId)));
      },
    );

    // Who and which Companies a filler may choose in `member` and `participant`
    // fields: only those they can see (V15), for a new item or on one.
    app.get(
      "/v1/projects/:projectId/form-choices",
      { schema: { params: projectParams, response: { 200: formChoices } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getNewWorkItemFormChoices(ctx.db, memberId, idOrNotFound(request.params.projectId)));
      },
    );

    app.get(
      "/v1/work-items/:workItemId/form-choices",
      { schema: { params: workItemParams, response: { 200: formChoices } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getWorkItemFormChoices(ctx.db, memberId, idOrNotFound(request.params.workItemId)));
      },
    );

    // Save draft. A refusal changes nothing.
    app.put(
      "/v1/work-items/:workItemId/answers",
      { schema: { params: workItemParams, body: saveAnswersRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const result = await saveAnswers(ctx.db, memberId, id, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
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
