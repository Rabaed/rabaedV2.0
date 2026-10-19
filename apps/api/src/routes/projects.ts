import {
  createdProject,
  createProjectRequest,
  myProjects,
  projectSummary,
  recordSettingsRequest,
  showInspectionsInSubmittalsRequest,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { forbidden, idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { createProject, getProject, listMyProjects, setRecordSettings, setShowInspectionsInSubmittals } from "../projects/projects.ts";
import { throwIfRefused } from "../refusals.ts";

// Projects. Only Project Creators create one; only a Project's Members see it,
// and to anyone else it is a 404 exactly like an id that doesn't exist.
export const projectRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/projects", { schema: { response: { 200: myProjects } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return listMyProjects(ctx.db, memberId, ctx.now());
    });

    app.post(
      "/v1/projects",
      { schema: { body: createProjectRequest, response: { 201: createdProject } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await createProject(ctx.db, memberId, request.body);
        if (!result.ok) throw forbidden();
        return reply.code(201).send({ projectId: result.projectId, projectNumber: result.projectNumber });
      },
    );

    app.get(
      "/v1/projects/:projectId",
      { schema: { params: z.object({ projectId: z.string() }), response: { 200: projectSummary } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return visibleOrNotFound(getProject(ctx.db, memberId, idOrNotFound(request.params.projectId)));
      },
    );

    // A Project Admin sets the language Documental Records are printed in and whether they show Hijri dates
    // (RP-151). They apply to records made afterwards. Anyone else gets a 404 exactly like a made-up id.
    app.put(
      "/v1/projects/:projectId/settings/record",
      { schema: { params: z.object({ projectId: z.string() }), body: recordSettingsRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        throwIfRefused(await setRecordSettings(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body));
        return reply.code(204).send();
      },
    );

    // A Project Admin shows Inspections in the Submittals tab, or back in their own (RP-652). Anyone else, or
    // anyone outside the Project, gets a 404 exactly like a made-up id.
    app.put(
      "/v1/projects/:projectId/settings/show-inspections-in-submittals",
      { schema: { params: z.object({ projectId: z.string() }), body: showInspectionsInSubmittalsRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        throwIfRefused(await setShowInspectionsInSubmittals(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body.show));
        return reply.code(204).send();
      },
    );
  };
