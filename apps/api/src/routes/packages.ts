import {
  addPackageItemRequest,
  createdPackage,
  packageComments,
  packageDetail,
  packageList,
  packageNameRequest,
  submitPackageRequest,
  submittedPackage,
} from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { HttpError, idOrNotFound, visibleOrNotFound } from "../http-error.ts";
import {
  addPackageItem,
  createPackage,
  discardPackage,
  getPackage,
  getPackageComments,
  listPackages,
  removePackageItem,
  renamePackage,
  submitPackage,
} from "../packages/packages.ts";
import { refusal, throwIfRefused } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });
const packageParams = z.object({ packageId: z.string() });
const packageItemParams = packageParams.extend({ workItemId: z.string() });

// Packages (spec RP-616; RP-636 an Open Package). A Member of a Participant creates
// one and adds its submittals; while it is Open they remove items, rename it or
// delete it. A Package the Member doesn't see is a 404 that names nothing, exactly
// like a made-up id (visibility.md "Direct URL or ID"); an Open Package is seen by
// its owning Participant's Members only (RP-588-1). Once Submitted, a Member who sees
// one of its items reads it too, with counts and items of the ones they see only, and
// changes nothing of it: every command is the same 404 (RP-641; RP-588-2, RP-588-3).
export const packageRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/projects/:projectId/packages", { schema: { params: projectParams, response: { 200: packageList } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return { packages: await visibleOrNotFound(listPackages(ctx.db, memberId, idOrNotFound(request.params.projectId))) };
    });

    app.post(
      "/v1/projects/:projectId/packages",
      { schema: { params: projectParams, body: packageNameRequest, response: { 201: createdPackage } } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        const result = await createPackage(ctx.db, memberId, idOrNotFound(request.params.projectId), request.body.name, ctx.now());
        if (!result.ok) throw refusal(result);
        return reply.code(201).send({ id: result.id, number: result.number });
      },
    );

    app.get("/v1/packages/:packageId", { schema: { params: packageParams, response: { 200: packageDetail } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(getPackage(ctx.db, memberId, idOrNotFound(request.params.packageId), ctx.now()));
    });

    // The Comments raised from its submittals' Code B (RP-647), for information: only the ones the
    // Member sees; a Package they don't see is the same 404.
    app.get("/v1/packages/:packageId/comments", { schema: { params: packageParams, response: { 200: packageComments } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return visibleOrNotFound(getPackageComments(ctx.db, memberId, idOrNotFound(request.params.packageId), ctx.now()));
    });

    app.patch("/v1/packages/:packageId", { schema: { params: packageParams, body: packageNameRequest } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      throwIfRefused(await renamePackage(ctx.db, memberId, idOrNotFound(request.params.packageId), request.body.name, ctx.now()));
      return reply.code(204).send();
    });

    app.delete("/v1/packages/:packageId", { schema: { params: packageParams } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      throwIfRefused(await discardPackage(ctx.db, memberId, idOrNotFound(request.params.packageId), ctx.now()));
      return reply.code(204).send();
    });

    app.post(
      "/v1/packages/:packageId/items",
      { schema: { params: packageParams, body: addPackageItemRequest } },
      async (request, reply) => {
        const memberId = ctx.requireMember(request);
        throwIfRefused(await addPackageItem(ctx.db, memberId, idOrNotFound(request.params.packageId), request.body.workItemId, ctx.now()));
        return reply.code(204).send();
      },
    );

    // Submit Package (RP-638): each not-yet-Submitted item's own Submit, all or
    // nothing. Not ready, the 409 lists the items that stop it the Member sees.
    app.post(
      "/v1/packages/:packageId/submit",
      { schema: { params: packageParams, body: submitPackageRequest, response: { 200: submittedPackage } } },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const result = await submitPackage(ctx.db, memberId, idOrNotFound(request.params.packageId), request.body, ctx.now());
        if (result.ok) return { submitted: result.submitted };
        if (result.reason === "package_not_ready") {
          throw new HttpError(409, "package_not_ready", { notReady: result.notReady, othersNotReady: result.othersNotReady });
        }
        throw refusal(result);
      },
    );

    app.delete("/v1/packages/:packageId/items/:workItemId", { schema: { params: packageItemParams } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      const packageId = idOrNotFound(request.params.packageId);
      const workItemId = idOrNotFound(request.params.workItemId);
      throwIfRefused(await removePackageItem(ctx.db, memberId, packageId, workItemId, ctx.now()));
      return reply.code(204).send();
    });
  };
