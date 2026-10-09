import { addStageRequest, moduleKeySchema, projectStages, renameStageRequest, reorderStagesRequest, type ModuleKey } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notFound, visibleOrNotFound } from "../http-error.ts";
import { addStage, deleteStage, getProjectStages, renameStage, reorderStages, type StageCommandResult } from "../projects/stages.ts";
import { refusal } from "../refusals.ts";

const moduleParams = z.object({ projectId: z.string(), module: z.string() });
const stageParams = moduleParams.extend({ key: z.string() });

/** The Project and Module of the path, or a 404 exactly like a made-up Project. */
function scopeOf(params: { projectId: string; module: string }): { projectId: string; moduleKey: ModuleKey } {
  const moduleKey = moduleKeySchema.safeParse(params.module);
  if (!moduleKey.success) throw notFound();
  return { projectId: idOrNotFound(params.projectId), moduleKey: moduleKey.data };
}

const done = (result: StageCommandResult) => {
  if (!result.ok) throw refusal(result);
};

// A Project's Stages per Module (RP-428, WF-5). Every Project Member reads them;
// only a Project Admin renames, adds, reorders or deletes one. Anyone else, or
// anyone outside the Project, gets a 404 exactly like a made-up id.
export const stageRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/projects/:projectId/modules/:module/stages",
      { schema: { params: moduleParams, response: { 200: projectStages } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const { projectId, moduleKey } = scopeOf(request.params);
        return visibleOrNotFound(getProjectStages(ctx.db, memberId, projectId, moduleKey));
      },
    );

    app.post(
      "/v1/projects/:projectId/modules/:module/stages",
      { schema: { params: moduleParams, body: addStageRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const { projectId, moduleKey } = scopeOf(request.params);
        done(await addStage(ctx.db, memberId, projectId, moduleKey, request.body));
        return reply.code(201).send({ key: request.body.key });
      },
    );

    app.put(
      "/v1/projects/:projectId/modules/:module/stages/order",
      { schema: { params: moduleParams, body: reorderStagesRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const { projectId, moduleKey } = scopeOf(request.params);
        done(await reorderStages(ctx.db, memberId, projectId, moduleKey, request.body.keys));
        return reply.code(204).send();
      },
    );

    app.patch(
      "/v1/projects/:projectId/modules/:module/stages/:key",
      { schema: { params: stageParams, body: renameStageRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const { projectId, moduleKey } = scopeOf(request.params);
        done(await renameStage(ctx.db, memberId, projectId, moduleKey, request.params.key, request.body.name));
        return reply.code(204).send();
      },
    );

    app.delete(
      "/v1/projects/:projectId/modules/:module/stages/:key",
      { schema: { params: stageParams } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const { projectId, moduleKey } = scopeOf(request.params);
        done(await deleteStage(ctx.db, memberId, projectId, moduleKey, request.params.key));
        return reply.code(204).send();
      },
    );
  };
