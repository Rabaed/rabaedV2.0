import { withMember, type Db } from "@rabaed/db";
import { signedUrl } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { sql } from "kysely";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { contentDisposition } from "../documents/file-store.ts";
import { idOrNotFound, notFound, visibleOrNotFound } from "../http-error.ts";

const params = z.object({ workItemId: z.string() });
const linkParams = z.object({ workItemId: z.string(), linkId: z.string() });

type RecordFile = { storage_key: string; file_name: string };

/** The record file a record read (`app.documental_record_file` or `app.linked_documental_record_file`) gives Member `memberId`, or null. */
const firstRecordFile = (db: Db, memberId: string, read: ReturnType<typeof sql<RecordFile>>) =>
  withMember(db, memberId, async (trx) => (await read.execute(trx)).rows[0] ?? null);

// "Download PDF" on a closed item (RP-620; ADR 0023; visibility.md V7, the
// Documental Record row): a short-lived signed link to its sealed record,
// through the same access check as Documents. Everyone who sees the closed
// item gets it; for anyone else, for an item with no record yet, and for a
// made-up id, the same plain 404. E2 (Signatory Access) comes with RP-614.
export const documentalRecordRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/work-items/:workItemId/documental-record", { schema: { params, response: { 200: signedUrl } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const id = idOrNotFound(request.params.workItemId);
      const file = await firstRecordFile(ctx.db, memberId, sql<RecordFile>`select storage_key, file_name from app.documental_record_file(${id}::uuid)`);
      return visibleOrNotFound(
        Promise.resolve(file ? ctx.files.signDownload(file.storage_key, { fileName: file.file_name, contentType: "application/pdf" }, ctx.now()) : null),
      );
    });

    // E1 (RP-1087, story 57; visibility.md E1, the Links row): a linked item's record, opened
    // through the Link of an item the Member sees, by the Link's id, even when the linked item is
    // outside their Visibility. The api sends the PDF itself: a signed link would name its storage
    // key, which holds the linked item's id, and a hidden item's id never reaches the browser.
    // HEAD answers the same with no body, so the Link's page knows to offer it. A removed Link, a
    // target not closed or with no published record, and a Member who doesn't see the item all get
    // the plain 404; the linked item's own URL stays 404 to them.
    app.route({
      method: ["GET", "HEAD"],
      url: "/v1/work-items/:workItemId/links/:linkId/documental-record",
      schema: { params: linkParams },
      handler: async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const id = idOrNotFound(request.params.workItemId);
        const linkId = idOrNotFound(request.params.linkId);
        const file = await firstRecordFile(
          ctx.db,
          memberId,
          sql<RecordFile>`select storage_key, file_name from app.linked_documental_record_file(${id}::uuid, ${linkId}::uuid)`,
        );
        if (!file) throw notFound();
        // HEAD checks the stored file too, so the Link's page never offers a download that 404s.
        const head = request.method === "HEAD";
        const body = head ? null : await ctx.files.stream(file.storage_key);
        if (head ? !(await ctx.files.stat(file.storage_key)) : !body) throw notFound();
        reply
          .header("content-type", "application/pdf")
          .header("content-disposition", contentDisposition(file.file_name, "application/pdf"))
          .header("cache-control", "private, no-store");
        return reply.send(body ?? undefined);
      },
    });
  };
