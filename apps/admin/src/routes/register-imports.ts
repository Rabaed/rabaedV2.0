import {
  adminPreviewRegisterImportRequest,
  adminReadRegisterRequest,
  adminRegisterImportFieldsRequest,
  adminRegisterImportParticipants,
  adminRegisterImportProjects,
  adminRegisterImportReason,
  confirmedRegisterImport,
  engineerReason,
  registerImport,
  registerImportFields,
  registerSheet,
  registerValues,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, type AdminContext } from "../app.ts";
import {
  confirmRegisterImportFor,
  getRegisterImportFor,
  listImportParticipants,
  listImportProjects,
  previewRegisterImportFor,
  readRegisterFor,
  registerImportFieldsFor,
  registerImportValuesFor,
} from "../register-import.ts";

// A 10 MB register as base64 in JSON, with room for the rest of the body (as the api's).
const registerBodyLimit = 15 * 1024 * 1024;

/** The import's refusals as HTTP answers, as the customer api answers them, with the Engineer's own. */
const statusOf: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  project_closed: 409,
  nothing_to_import: 409,
  preview_outdated: 409,
};
const refused = (result: { reason: string }) => new HttpError(statusOf[result.reason] ?? 422, result.reason);

// The Submittal Register Import by a Rabaed Engineer (RP-645, spec RP-631): the Admin
// wizard's calls. Each needs a reason and is an admin_action (V9). The Engineer imports for
// a Participant with a default Member of it, through the customer api's own import code.
export const registerImportRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/register-imports/projects",
      { schema: { querystring: z.object({ reason: engineerReason }), response: { 200: adminRegisterImportProjects } } },
      async (request) => listImportProjects(ctx.db, ctx.requireEngineer(request), request.query.reason),
    );

    app.get(
      "/v1/register-imports/projects/:projectId/participants",
      {
        schema: {
          params: z.object({ projectId: z.uuid() }),
          querystring: z.object({ reason: engineerReason }),
          response: { 200: adminRegisterImportParticipants },
        },
      },
      async (request) => {
        const found = await listImportParticipants(ctx.db, ctx.requireEngineer(request), request.params.projectId, request.query.reason);
        if (!found) throw new HttpError(404, "not_found");
        return found;
      },
    );

    app.post(
      "/v1/register-imports/read",
      { bodyLimit: registerBodyLimit, schema: { body: adminReadRegisterRequest, response: { 200: registerSheet } } },
      async (request) => {
        const result = await readRegisterFor(ctx.db, ctx.requireEngineer(request), request.body);
        if (!result.ok) throw refused(result);
        return result.sheet;
      },
    );

    app.post("/v1/register-imports/fields", { schema: { body: adminRegisterImportFieldsRequest, response: { 200: registerImportFields } } }, async (request) => {
      const result = await registerImportFieldsFor(ctx.db, ctx.requireEngineer(request), request.body.for);
      if ("ok" in result) throw refused(result);
      return result;
    });

    app.post(
      "/v1/register-imports/values",
      { bodyLimit: registerBodyLimit, schema: { body: adminPreviewRegisterImportRequest, response: { 200: registerValues } } },
      async (request) => {
        const result = await registerImportValuesFor(ctx.db, ctx.requireEngineer(request), request.body);
        if (!result.ok) throw refused(result);
        return result.values;
      },
    );

    app.post(
      "/v1/register-imports",
      { bodyLimit: registerBodyLimit, schema: { body: adminPreviewRegisterImportRequest, response: { 201: registerImport } } },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await previewRegisterImportFor(ctx.db, engineerId, request.body, ctx.now());
        if (!result.ok) throw refused(result);
        const previewed = await getRegisterImportFor(ctx.db, engineerId, result.id, request.body.for.reason);
        if (!previewed) throw new HttpError(404, "not_found");
        return reply.code(201).send(previewed);
      },
    );

    app.get(
      "/v1/register-imports/:importId",
      { schema: { params: z.object({ importId: z.uuid() }), querystring: adminRegisterImportReason, response: { 200: registerImport } } },
      async (request) => {
        const found = await getRegisterImportFor(ctx.db, ctx.requireEngineer(request), request.params.importId, request.query.reason);
        if (!found) throw new HttpError(404, "not_found");
        return found;
      },
    );

    app.post(
      "/v1/register-imports/:importId/confirm",
      { schema: { params: z.object({ importId: z.uuid() }), body: adminRegisterImportReason, response: { 200: confirmedRegisterImport } } },
      async (request) => {
        const result = await confirmRegisterImportFor(ctx.db, ctx.requireEngineer(request), request.params.importId, request.body.reason, ctx.now());
        if (!result.ok) throw refused(result);
        return { rowsCreated: result.rowsCreated };
      },
    );
  };
