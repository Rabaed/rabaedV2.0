import { createdProject, createProjectRequest, myProjects, projectSummary } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { forbidden, idOrNotFound, notFound } from "../http-error.ts";
import { createProject, getProject, listMyProjects } from "../projects/projects.ts";

// Projects. Only Project Creators create one; only a Project's Members see it,
// and to anyone else it is a 404 exactly like an id that doesn't exist.
export const projectRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/projects", { schema: { response: { 200: myProjects } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return { projects: await listMyProjects(ctx.db, memberId) };
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
        const project = await getProject(ctx.db, memberId, idOrNotFound(request.params.projectId));
        if (!project) throw notFound();
        return project;
      },
    );
  };
