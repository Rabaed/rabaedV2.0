import { createScreenRequest, saveScreenDraftRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { createScreen, listScreens, publishScreen, readScreen, saveScreenDraft } from "../projects/screens.ts";
import { refusal } from "../refusals.ts";

const screenParams = z.object({ screenId: z.string() });
const projectParams = z.object({ projectId: z.string() });

// Screens (RP-516; workflow-engine.md §5.7). Every Member of a Project reads its
// published Screens and the Rabaed Default ones (V20); only their authors (the Project
// Admins) read a draft or change them. Anyone else, and a made-up id, gets the same 404.
// The Settings → Screens editor comes with RP-441.
export const screenRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/projects/:projectId/screens", { schema: { params: projectParams } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(listScreens(ctx.db, memberId, idOrNotFound(request.params.projectId)));
    });

    app.post("/v1/projects/:projectId/screens", { schema: { params: projectParams, body: createScreenRequest } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const result = await createScreen(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body, ctx.now());
      if (!result.ok) throw refusal(result);
      return reply.code(201).send({ id: result.id });
    });

    app.get("/v1/screens/:screenId", { schema: { params: screenParams } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(readScreen(ctx.db, memberId, idOrNotFound(request.params.screenId)));
    });

    app.put("/v1/screens/:screenId/draft", { schema: { params: screenParams, body: saveScreenDraftRequest } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const result = await saveScreenDraft(ctx.db, memberId, idOrNotFound(request.params.screenId), request.body, ctx.now());
      if (!result.ok) throw refusal(result);
      return { versionNo: result.versionNo };
    });

    app.post("/v1/screens/:screenId/publish", { schema: { params: screenParams } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const result = await publishScreen(ctx.db, memberId, idOrNotFound(request.params.screenId), ctx.now());
      if (!result.ok) throw refusal(result);
      return { versionNo: result.versionNo };
    });
  };
