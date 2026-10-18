import { withMember } from "@rabaed/db";
import { signedUrl } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { sql } from "kysely";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";

const params = z.object({ workItemId: z.string() });

// "Download PDF" on a closed item (RP-620; ADR 0023; visibility.md V7, the
// Documental Record row): a short-lived signed link to its sealed record,
// through the same access check as Documents. Everyone who sees the closed
// item gets it; for anyone else, for an item with no record yet, and for a
// made-up id, the same plain 404. E1 and E2 (a linked item's record, Signatory
// Access) come with RP-614 and the Links' record.
export const documentalRecordRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/work-items/:workItemId/documental-record", { schema: { params, response: { 200: signedUrl } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const id = idOrNotFound(request.params.workItemId);
      const file = await withMember(ctx.db, memberId, async (trx) => {
        const { rows } = await sql<{ storage_key: string; file_name: string }>`
          select storage_key, file_name from app.documental_record_file(${id}::uuid)
        `.execute(trx);
        return rows[0] ?? null;
      });
      return visibleOrNotFound(
        Promise.resolve(file ? ctx.files.signDownload(file.storage_key, { fileName: file.file_name, contentType: "application/pdf" }, ctx.now()) : null),
      );
    });
  };
