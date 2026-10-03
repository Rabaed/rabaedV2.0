import { documentList, signedUrl, startDocumentUploadRequest, startedDocumentUpload } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { confirmUpload, downloadDocument, listDocuments, removeDocument, startUpload } from "../documents/documents.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { refusal } from "../refusals.ts";

const workItemParams = z.object({ workItemId: z.string() });
const documentParams = z.object({ workItemId: z.string(), documentId: z.string() });

// Documents of a Work Item (the Attachments System Field). Hidden exactly like
// their item: anyone who can't see it gets a 404, for its Documents and their
// URLs alike, that names nothing.
export const documentRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/work-items/:workItemId/documents",
      { schema: { params: workItemParams, response: { 200: documentList } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        return visibleOrNotFound(listDocuments(ctx.db, memberId, id, ctx.config.documents));
      },
    );

    // Step 1 of an upload: a signed URL for exactly the declared file.
    app.post(
      "/v1/work-items/:workItemId/documents",
      { schema: { params: workItemParams, body: startDocumentUploadRequest, response: { 201: startedDocumentUpload } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const result = await startUpload(ctx.db, ctx.files, memberId, id, request.body, ctx.config.documents, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send(result.started);
      },
    );

    // Step 3: the file is in the store.
    app.post(
      "/v1/work-items/:workItemId/documents/:documentId/confirm",
      { schema: { params: documentParams } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const documentId = idOrNotFound(request.params.documentId);
        const result = await confirmUpload(ctx.db, ctx.files, memberId, id, documentId, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );

    app.get(
      "/v1/work-items/:workItemId/documents/:documentId/download",
      { schema: { params: documentParams, response: { 200: signedUrl } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const documentId = idOrNotFound(request.params.documentId);
        return visibleOrNotFound(downloadDocument(ctx.db, ctx.files, memberId, id, documentId, ctx.now()));
      },
    );

    // Remove: in Draft only; refused once the Document is frozen.
    app.delete(
      "/v1/work-items/:workItemId/documents/:documentId",
      { schema: { params: documentParams } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const documentId = idOrNotFound(request.params.documentId);
        const result = await removeDocument(ctx.db, memberId, id, documentId, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
