import { withMember } from "@rabaed/db";
import { workingCopyAnswer, type WorkingCopyAnswer } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { sql } from "kysely";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notFound } from "../http-error.ts";

const params = z.object({ workItemId: z.string() });

// "Download PDF" on an item that isn't closed (RP-621; ADR 0023; visibility.md, the Working
// Copy row, V1; scenario RP-23-3): its Working Copy, printed by the worker from the item as
// shared, the same file for every viewer, through a short-lived signed link as Documents are.
// The first ask queues it ('preparing'); the web asks again until it is 'ready'. A closed item
// answers 'closed' (its download is the Documental Record). Anyone who doesn't see the item (a
// Draft: anyone but the Members who see the Draft), and a made-up id, get the plain 404.
// POST: an ask may queue the printing.
export const workingCopyRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.post("/v1/work-items/:workItemId/working-copy", { schema: { params, response: { 200: workingCopyAnswer } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const id = idOrNotFound(request.params.workItemId);
      const asked = await withMember(ctx.db, memberId, async (trx) => {
        const { rows } = await sql<{ outcome: string; storage_key: string | null; file_name: string | null }>`
          select outcome, storage_key, file_name from app.request_working_copy(${id}::uuid, ${ctx.config.version})
        `.execute(trx);
        return rows[0]!;
      });
      switch (asked.outcome) {
        case "ready": {
          const link = await ctx.files.signDownload(asked.storage_key!, { fileName: asked.file_name!, contentType: "application/pdf" }, ctx.now());
          return { status: "ready", ...link } satisfies WorkingCopyAnswer;
        }
        case "preparing":
        case "failed":
        case "closed":
          return { status: asked.outcome } satisfies WorkingCopyAnswer;
        default:
          throw notFound();
      }
    });
  };
