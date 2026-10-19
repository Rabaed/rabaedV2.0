import {
  confirmedRegisterImport,
  previewRegisterImportRequest,
  readRegisterRequest,
  registerImport,
  registerImportFields,
  registerImportMappings,
  registerImports,
  registerSheet,
  registerValues,
  renameRegisterImportMappingRequest,
  saveRegisterImportMappingRequest,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { contentDisposition, noFileStore } from "../documents/file-store.ts";
import { idOrNotFound, notFound, visibleOrNotFound } from "../http-error.ts";
import {
  changeRegisterImportMapping,
  confirmRegisterImport,
  getRegisterImport,
  getRegisterImportFields,
  listRegisterImports,
  memberImporter,
  previewRegisterImport,
  readRegister,
  registerImportOriginal,
  registerImportValues,
  saveRegisterImportMapping,
} from "../register-import/register-import.ts";
import { refusal } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });
const importParams = z.object({ importId: z.string() });
const mappingParams = z.object({ mappingId: z.string() });
// A 10 MB register as base64 in JSON, with room for the rest of the body.
const registerBodyLimit = 15 * 1024 * 1024;

// The Submittal Register Import (RP-637, spec RP-631): the Submittals Module's
// "Import register" wizard and its Imports page. Only the importing Participant's
// Members read an import (visibility.md RP-589-1): anyone else, and a made-up id, get
// the plain 404. A Member who may raise no Submittals Type on the Project gets 403.
// RP-644: the original register's download and the saved mappings, both the importing
// Participant's only, never with a time.
export const registerImportRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    // A Member's preview keeps its original register where a file store is set up.
    const importerOf = (memberId: string) => memberImporter(ctx.db, memberId, ctx.files === noFileStore ? undefined : ctx.files);

    app.post(
      "/v1/projects/:projectId/register-imports/read",
      { bodyLimit: registerBodyLimit, schema: { params: projectParams, body: readRegisterRequest, response: { 200: registerSheet } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await readRegister(importerOf(memberId), idOrNotFound(request.params.projectId), request.body);
        if (!result.ok) throw refusal(result);
        return result.sheet;
      },
    );

    app.get(
      "/v1/projects/:projectId/register-imports/fields",
      { schema: { params: projectParams, response: { 200: registerImportFields } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await getRegisterImportFields(importerOf(memberId), idOrNotFound(request.params.projectId));
        if ("ok" in result) throw refusal(result);
        return result;
      },
    );

    app.post(
      "/v1/projects/:projectId/register-imports/values",
      { bodyLimit: registerBodyLimit, schema: { params: projectParams, body: previewRegisterImportRequest, response: { 200: registerValues } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await registerImportValues(importerOf(memberId), idOrNotFound(request.params.projectId), request.body);
        if (!result.ok) throw refusal(result);
        return result.values;
      },
    );

    app.post(
      "/v1/projects/:projectId/register-imports",
      { bodyLimit: registerBodyLimit, schema: { params: projectParams, body: previewRegisterImportRequest, response: { 201: registerImport } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await previewRegisterImport(importerOf(memberId), idOrNotFound(request.params.projectId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send(await visibleOrNotFound(getRegisterImport(importerOf(memberId), result.id)));
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
      return visibleOrNotFound(getRegisterImport(importerOf(memberId), idOrNotFound(request.params.importId)));
    });

    // The original register, as uploaded (story 34): its own name, and no time in any header.
    app.get("/v1/register-imports/:importId/original", { schema: { params: importParams } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const original = await registerImportOriginal(importerOf(memberId), idOrNotFound(request.params.importId));
      if (!original) throw notFound();
      return reply
        .header("content-type", original.contentType)
        .header("content-disposition", contentDisposition(original.fileName, original.contentType))
        .header("cache-control", "private, no-store")
        .send(Buffer.from(original.bytes));
    });

    app.post(
      "/v1/register-imports/:importId/confirm",
      { schema: { params: importParams, response: { 200: confirmedRegisterImport } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await confirmRegisterImport(importerOf(memberId), idOrNotFound(request.params.importId), ctx.now());
        if (!result.ok) throw refusal(result);
        return { rowsCreated: result.rowsCreated };
      },
    );

    // Saved mappings (story 11): each answers the Participant's saved mappings after it.
    app.post(
      "/v1/projects/:projectId/register-import-mappings",
      { schema: { params: projectParams, body: saveRegisterImportMappingRequest, response: { 201: registerImportMappings } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await saveRegisterImportMapping(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send(result.mappings);
      },
    );

    app.put(
      "/v1/register-import-mappings/:mappingId",
      { schema: { params: mappingParams, body: renameRegisterImportMappingRequest, response: { 200: registerImportMappings } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await changeRegisterImportMapping(ctx.db, memberId, idOrNotFound(request.params.mappingId), { name: request.body.name });
        if (!result.ok) throw refusal(result);
        return result.mappings;
      },
    );

    app.delete("/v1/register-import-mappings/:mappingId", { schema: { params: mappingParams, response: { 200: registerImportMappings } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const result = await changeRegisterImportMapping(ctx.db, memberId, idOrNotFound(request.params.mappingId), "delete");
      if (!result.ok) throw refusal(result);
      return result.mappings;
    });
  };
