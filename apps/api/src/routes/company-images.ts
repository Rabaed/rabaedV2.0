import { COMPANY_IMAGE_MAX_BYTES, companyImageKinds, myCompany, saveCompanyImageRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound, notSignedIn } from "../http-error.ts";
import { myCompany as readMyCompany, saveCompanyImage } from "../identity/company-image.ts";
import { refusal } from "../refusals.ts";

// The Company profile's logo and Stamp (RP-617): the signed-in Member's own Company's, read by
// every Member of it, uploaded by its Authorized Person only. Another Company's is a plain 404.
export const companyImageRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/me/company", { schema: { response: { 200: myCompany } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      const mine = await readMyCompany(ctx.db, ctx.files, memberId, ctx.now());
      if (!mine) throw notSignedIn();
      return mine;
    });

    // A new logo or Stamp, in force from now: a record already made keeps the one it was made with.
    app.put(
      "/v1/companies/:companyId/:kind",
      {
        // The image, base64-encoded in JSON, may be larger than the default body limit.
        bodyLimit: Math.ceil(COMPANY_IMAGE_MAX_BYTES / 3) * 4 + 1024,
        schema: {
          params: z.object({ companyId: z.string(), kind: z.enum(companyImageKinds) }),
          body: saveCompanyImageRequest,
          response: { 200: myCompany },
        },
      },
      async (request) => {
        const memberId = ctx.requireMember(request);
        const companyId = idOrNotFound(request.params.companyId);
        const result = await saveCompanyImage(ctx.db, ctx.files, memberId, companyId, request.params.kind, request.body, ctx.now());
        if (!result.ok) throw refusal(result);
        const mine = await readMyCompany(ctx.db, ctx.files, memberId, ctx.now());
        if (!mine) throw notSignedIn();
        return mine;
      },
    );
  };
