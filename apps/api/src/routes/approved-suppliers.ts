import { addApprovedSupplierRequest, approvedSuppliers, approvedSuppliersQuery } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import { addApprovedSupplier, listApprovedSuppliers, withdrawApprovedSupplier } from "../projects/approved-suppliers.ts";
import { refusal } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });
const supplierParams = z.object({ supplierId: z.string() });
const created = z.object({ id: z.uuid() });

// The Approved Supplier List (Project Settings → Approved Supplier List, RP-592).
// Every Project Member of every Participant lists it: names, Trade, Scope and
// status, never what put a supplier there (V10). Only a Project Admin adds or
// withdraws one: anyone else gets a 404, exactly like a made-up id, so it names nothing.
export const approvedSupplierRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/v1/projects/:projectId/approved-suppliers",
      { schema: { params: projectParams, querystring: approvedSuppliersQuery, response: { 200: approvedSuppliers } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const projectId = idOrNotFound(request.params.projectId);
        return { suppliers: await visibleOrNotFound(listApprovedSuppliers(ctx.db, memberId, projectId, request.query)) };
      },
    );

    app.post(
      "/v1/projects/:projectId/approved-suppliers",
      { schema: { params: projectParams, body: addApprovedSupplierRequest, response: { 201: created } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await addApprovedSupplier(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ id: result.id });
      },
    );

    app.post(
      "/v1/approved-suppliers/:supplierId/withdraw",
      { schema: { params: supplierParams } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await withdrawApprovedSupplier(ctx.db, memberId, idOrNotFound(request.params.supplierId), ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(204).send();
      },
    );
  };
