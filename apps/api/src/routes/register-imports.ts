import {
  confirmedRegisterImport,
  previewRegisterImportRequest,
  readRegisterRequest,
  registerImport,
  registerImports,
  registerSheet,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import {
  confirmRegisterImport,
  getRegisterImport,
  listRegisterImports,
  previewRegisterImport,
  readRegister,
} from "../register-import/register-import.ts";
import { refusal } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });
const importParams = z.object({ importId: z.string() });
// A 10 MB register as base64 in JSON, with room for the rest of the body.
const registerBodyLimit = 15 * 1024 * 1024;

// The Submittal Register Import (RP-637, spec RP-631): the Submittals Module's
// "Import register" wizard and its Imports page. Only the importing Participant's
// Members read an import (visibility.md RP-589-1): anyone else, and a made-up id, get
// the plain 404. A Member who may raise no Submittals Type on the Project gets 403.
export const registerImportRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      "/v1/projects/:projectId/register-imports/read",
      { bodyLimit: registerBodyLimit, schema: { params: projectParams, body: readRegisterRequest, response: { 200: registerSheet } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await readRegister(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body);
        if (!result.ok) throw refusal(result);
        return result.sheet;
      },
    );

    app.post(
      "/v1/projects/:projectId/register-imports",
      { bodyLimit: registerBodyLimit, schema: { params: projectParams, body: previewRegisterImportRequest, response: { 201: registerImport } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await previewRegisterImport(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send(await visibleOrNotFound(getRegisterImport(ctx.db, memberId, result.id)));
      },
    );

    app.get(
      "/v1/projects/:projectId/register-imports",
      { schema: { params: projectParams, response: { 200: registerImports } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        return { imports: await visibleOrNotFound(listRegisterImports(ctx.db, memberId, idOrNotFound(request.params.projectId))) };
      },
    );

    app.get("/v1/register-imports/:importId", { schema: { params: importParams, response: { 200: registerImport } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(getRegisterImport(ctx.db, memberId, idOrNotFound(request.params.importId)));
    });

    app.post(
      "/v1/register-imports/:importId/confirm",
      { schema: { params: importParams, response: { 200: confirmedRegisterImport } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await confirmRegisterImport(ctx.db, memberId, idOrNotFound(request.params.importId), ctx.now());
        if (!result.ok) throw refusal(result);
        return { rowsCreated: result.rowsCreated };
      },
    );
  };
