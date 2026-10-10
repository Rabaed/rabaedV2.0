import {
  activityFeed,
  activityFeedQuery,
  addedLink,
  addLinkRequest,
  boardCardLayout,
  boardCardLayoutChange,
  createdWorkItem,
  createReplacementRequest,
  createRevisionRequest,
  createWorkItemRequest,
  dashboard,
  duplicateRequest,
  sharedWorkItem,
  formChoices,
  formToFill,
  linkedFrom,
  linkSearchQuery,
  linkSearchResults,
  listColumnLayout,
  moduleKeys,
  revisionChain,
  saveAnswersRequest,
  savedAnswers,
  takeTransitionRequest,
  workItemTypeCode,
  workItemBoard,
  workItemDetail,
  workItemExport,
  workItemHistory,
  workItemLinks,
  workItemList,
  workItemQuery,
  type WorkItemQuery,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notFound, visibleOrNotFound } from "../http-error.ts";
import { refusal } from "../refusals.ts";
import { getActivityFeed } from "../work-items/activity-feed.ts";
import { getDashboard } from "../work-items/dashboard.ts";
import { getLinkedFrom } from "../work-items/linked-from.ts";
import { addWorkItemLink, getWorkItemLinks, removeWorkItemLink } from "../work-items/links.ts";
import { boardWorkItems, changeBoardLayout, exportWorkItems, listWorkItems, saveListColumns, type QueryScope } from "../work-items/query.ts";
import { createReplacement, createRevision, discardRevision, getRevisionChain } from "../work-items/revisions.ts";
import {
  claimStep,
  discardDraft,
  duplicateWorkItem,
  getSharedWorkItem,
  createWorkItem,
  getNewWorkItemForm,
  getNewWorkItemFormChoices,
  getWorkItem,
  getWorkItemForm,
  getWorkItemFormChoices,
  getWorkItemHistory,
  releaseStep,
  saveAnswers,
  searchLinkTargets,
  takeTransition,
} from "../work-items/work-items.ts";

const projectParams = z.object({ projectId: z.string() });
const workItemParams = z.object({ workItemId: z.string() });
const linkParams = z.object({ workItemId: z.string(), linkId: z.string() });
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

    // A Module's items (RP-346): `/modules/:module/work-items` names the Module in
    // its path (a Module tab's), and `/work-items` in its query's `module`, the
    // Submittals unless a link names another (a Dashboard number, RP-351). Either
    // way a Module the Project has no Work Item Type in, or that doesn't exist, is
    // not found. The query then names the Module it reads, so its own links agree.
    const scoped = (params: { projectId: string; module?: string }, q: WorkItemQuery): [QueryScope, WorkItemQuery] => {
      const moduleKey = params.module === undefined ? q.module : moduleKeys.find((m) => m === params.module);
      if (!moduleKey) throw notFound();
      return [{ projectId: idOrNotFound(params.projectId), moduleKey }, { ...q, module: moduleKey }];
    };
    const moduleParams = projectParams.extend({ module: z.string() });

    for (const [path, params] of [
      ["/v1/projects/:projectId/work-items", projectParams],
      ["/v1/projects/:projectId/modules/:module/work-items", moduleParams],
    ] as const) {
      // The List: one page of the work item query (spec RP-344), its filters in the
      // query string as the web's URL holds them.
      app.get(path, { schema: { params, querystring: workItemQuery, response: { 200: workItemList } } }, async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(listWorkItems(ctx.db, memberId, ...scoped(request.params, request.query), ctx.now()));
      });

      // Export (RP-409): the List's rows the Member reads, with its filters and order; under a search
      // only the pages read so far. The web writes them as CSV or Excel, with the columns shown.
      app.get(`${path}/export`, { schema: { params, querystring: workItemQuery, response: { 200: workItemExport } } }, async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(exportWorkItems(ctx.db, memberId, ...scoped(request.params, request.query), ctx.now()));
      });

      // The Kanban (RP-349): the same query as a board, Stages as columns and V14
      // swimlanes; a closed column holds the last 30 days. The cursor is not used.
      app.get(`${path}/kanban`, { schema: { params, querystring: workItemQuery, response: { 200: workItemBoard } } }, async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(boardWorkItems(ctx.db, memberId, ...scoped(request.params, request.query), ctx.now()));
      });

      // The Member's own Card view layout of the board (RP-410): the switches given, the others kept.
      app.put(
        `${path}/kanban/layout`,
        { schema: { params, body: boardCardLayoutChange, response: { 200: boardCardLayout } } },
        async (request) => {
          const memberId = ctx.requireMember(request);
          const [scope] = scoped(request.params, workItemQuery.parse({}));
          return visibleOrNotFound(changeBoardLayout(ctx.db, memberId, scope, request.body));
        },
      );

      // The Member's own List columns (RP-409, "Save as my default"): their order, each shown or not.
      app.put(
        `${path}/list/columns`,
        { schema: { params, body: listColumnLayout, response: { 200: listColumnLayout } } },
        async (request) => {
          const memberId = ctx.requireMember(request);
          const [scope] = scoped(request.params, workItemQuery.parse({}));
          return visibleOrNotFound(saveListColumns(ctx.db, memberId, scope, request.body));
        },
      );
    }

    // The Dashboard: Type cards per Module, counted per Revision chain over the
    // items the Member sees, every number with the List filter behind it (RP-351).
    app.get("/v1/projects/:projectId/dashboard", { schema: { params: projectParams, response: { 200: dashboard } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(getDashboard(ctx.db, memberId, idOrNotFound(request.params.projectId), ctx.now()));
    });

    // The Activity Feed: the Project's Work Item events as the Member may see them,
    // newest first, a page at a time (RP-353; visibility.md "Activity Feed").
    app.get(
      "/v1/projects/:projectId/activity",
      { schema: { params: projectParams, querystring: activityFeedQuery, response: { 200: activityFeed } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getActivityFeed(ctx.db, memberId, idOrNotFound(request.params.projectId), request.query));
      },
    );

    // Link search: the Project's Submitted items the Member sees whose Document
    // Number or Subject contains `q`, a page at a time (visibility.md scenario 79).
    app.get(
      "/v1/projects/:projectId/work-items/link-search",
      { schema: { params: projectParams, querystring: linkSearchQuery, response: { 200: linkSearchResults } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(searchLinkTargets(ctx.db, memberId, idOrNotFound(request.params.projectId), request.query));
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
      { schema: { params: typeFormParams, response: { 200: formToFill } } },
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
      { schema: { params: workItemParams, response: { 200: formToFill } } },
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
      { schema: { params: workItemParams, body: saveAnswersRequest, response: { 200: savedAnswers, 204: z.null().describe("saved; no `basedOn`, nothing to report") } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const result = await saveAnswers(ctx.db, memberId, id, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        // Without `basedOn` there is nothing to report: as it always was.
        return result.saved ? reply.code(200).send(result.saved) : reply.code(204).send(null);
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

    // The Links System Field (visibility.md E1): every Link of a visible item, the
    // linked item's id only when the Member sees it too.
    app.get(
      "/v1/work-items/:workItemId/links",
      { schema: { params: workItemParams, response: { 200: workItemLinks } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getWorkItemLinks(ctx.db, memberId, idOrNotFound(request.params.workItemId)));
      },
    );

    // Linked from (visibility.md E3): the Submitted items linking to a visible item,
    // a linking item's id only when the Member sees it too. Never a Draft or internal item.
    app.get(
      "/v1/work-items/:workItemId/linked-from",
      { schema: { params: workItemParams, response: { 200: linkedFrom } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getLinkedFrom(ctx.db, memberId, idOrNotFound(request.params.workItemId)));
      },
    );

    // Free Links, added and removed by the raiser's Company until Submit. A refusal changes nothing.
    app.post(
      "/v1/work-items/:workItemId/links",
      { schema: { params: workItemParams, body: addLinkRequest, response: { 201: addedLink } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const result = await addWorkItemLink(ctx.db, memberId, id, request.body.workItemId, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ id: result.id });
      },
    );

    app.delete("/v1/work-items/:workItemId/links/:linkId", { schema: { params: linkParams } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const id = idOrNotFound(request.params.workItemId);
      const result = await removeWorkItemLink(ctx.db, memberId, id, idOrNotFound(request.params.linkId), ctx.now());
      if (!result.ok) throw refusal(result);
      return reply.code(204).send();
    });

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

    // Create a Revision of a closed item (workflow-engine.md §5.4): a new Draft of
    // the raiser's. Refused alike for every reason but a hidden item (404).
    app.post(
      "/v1/work-items/:workItemId/revisions",
      { schema: { params: workItemParams, body: createRevisionRequest, response: { 201: createdWorkItem } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const result = await createRevision(ctx.db, ctx.files, memberId, id, request.body.idempotencyKey, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ id: result.id });
      },
    );

    // Create a replacement of a rejected item (workflow-engine.md §5.5): a new Draft of
    // the raiser's with a new number, linked to it. Refused alike for every reason but a
    // hidden item (404).
    app.post(
      "/v1/work-items/:workItemId/replacements",
      { schema: { params: workItemParams, body: createReplacementRequest, response: { 201: createdWorkItem } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const result = await createReplacement(ctx.db, ctx.files, memberId, id, request.body.idempotencyKey, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ id: result.id });
      },
    );

    // Duplicate (RP-409, the List's row menu): a new Draft of the same Type with only what the
    // Member's own Participant wrote (scenario RP-409-1); the same key again answers with the same Draft.
    // Refused alike for every reason but a hidden item (404).
    app.post(
      "/v1/work-items/:workItemId/duplicate",
      { schema: { params: workItemParams, body: duplicateRequest, response: { 201: createdWorkItem } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const result = await duplicateWorkItem(ctx.db, memberId, id, request.body.idempotencyKey, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ id: result.id });
      },
    );

    // Delete (RP-409, the List's row menu): discard the Member's own Draft, an original or a
    // Revision, while it has no Document Number (scenario RP-409-3). Afterwards nobody sees it.
    app.post("/v1/work-items/:workItemId/discard-draft", { schema: { params: workItemParams } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const result = await discardDraft(ctx.db, memberId, idOrNotFound(request.params.workItemId), ctx.now());
      if (!result.ok) throw refusal(result);
      return reply.code(204).send();
    });

    // Download (RP-409, scenario RP-409-2): the item as it was shared, the same for every viewer.
    // Before its first Submit, nothing is shared: the plain 404.
    app.get("/v1/work-items/:workItemId/shared", { schema: { params: workItemParams, response: { 200: sharedWorkItem } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(getSharedWorkItem(ctx.db, memberId, idOrNotFound(request.params.workItemId)));
    });

    // The Revision drop-down (workflow-engine.md §5.4): the Revisions of the item's
    // chain the Member sees, each by V1 on its own. A hidden item is the plain 404.
    app.get(
      "/v1/work-items/:workItemId/revisions",
      { schema: { params: workItemParams, response: { 200: revisionChain } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getRevisionChain(ctx.db, memberId, idOrNotFound(request.params.workItemId)));
      },
    );

    // Discard a Revision still in Draft: afterwards it is hidden from everyone.
    app.post("/v1/work-items/:workItemId/discard", { schema: { params: workItemParams } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const result = await discardRevision(ctx.db, memberId, idOrNotFound(request.params.workItemId), ctx.now());
      if (!result.ok) throw refusal(result);
      return reply.code(204).send();
    });

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
