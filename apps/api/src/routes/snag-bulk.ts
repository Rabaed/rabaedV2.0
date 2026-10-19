import {
  snagBulkCandidates,
  snagBulkCandidatesRequest,
  snagBulkMoveRequest,
  snagBulkReassignRequest,
  snagBulkResult,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notFound } from "../http-error.ts";
import { bulkMove, bulkReassign, onProject, reassignCandidates } from "../work-items/snag-bulk.ts";

const projectParams = z.object({ projectId: z.string() });

// The Snag List's bulk actions (RP-629): move Stage and reassign within the viewer's own
// Company, on the chosen rows. Each item is acted on as the single-item command acts, and the
// answer lists the items done and the ones skipped, with why. A Project the viewer is not on is
// the plain 404; an item they don't see is skipped as `not_found`, never named.
export const snagBulkRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    const project = async (memberId: string, raw: string) => {
      const projectId = idOrNotFound(raw);
      if (!(await onProject(ctx.db, memberId, projectId))) throw notFound();
      return projectId;
    };

    app.post(
      "/v1/projects/:projectId/snag-list/move",
      { schema: { params: projectParams, body: snagBulkMoveRequest, response: { 200: snagBulkResult } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return bulkMove(ctx.db, ctx.files, memberId, await project(memberId, request.params.projectId), request.body, ctx.now());
      },
    );

    app.post(
      "/v1/projects/:projectId/snag-list/reassign-candidates",
      { schema: { params: projectParams, body: snagBulkCandidatesRequest, response: { 200: snagBulkCandidates } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return reassignCandidates(ctx.db, memberId, await project(memberId, request.params.projectId), request.body.ids);
      },
    );

    app.post(
      "/v1/projects/:projectId/snag-list/reassign",
      { schema: { params: projectParams, body: snagBulkReassignRequest, response: { 200: snagBulkResult } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return bulkReassign(ctx.db, memberId, await project(memberId, request.params.projectId), request.body, ctx.now());
      },
    );
  };
