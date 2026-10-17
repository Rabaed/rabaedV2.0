import { mySignature, saveSignatureRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppContext } from "../app.ts";
import { notSignedIn } from "../http-error.ts";
import { mySignature as readMySignature, saveSignature } from "../identity/signature.ts";
import { refusal } from "../refusals.ts";

// Profile → Add Signature (RP-85): the signed-in Member's own Signature, and nobody else's.
export const signatureRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/me/signature", { schema: { response: { 200: mySignature } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return readMySignature(ctx.db, ctx.files, memberId, ctx.now());
    });

    // A new Signature, in force from now: a Transition already taken keeps the one it was taken with.
    app.put("/v1/me/signature", { schema: { body: saveSignatureRequest, response: { 200: mySignature } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const result = await saveSignature(ctx.db, ctx.files, memberId, request.body, ctx.now());
      if (!result.ok) {
        if (result.reason === "not_found") throw notSignedIn();
        throw refusal(result);
      }
      return readMySignature(ctx.db, ctx.files, memberId, ctx.now());
    });
  };
