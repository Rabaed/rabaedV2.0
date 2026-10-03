import { addOptionRequest, createOptionListRequest, optionLists, optionReasonRequest, renameOptionRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, type AdminContext } from "../app.ts";
import { addOption, createOptionList, listOptionLists, renameOption, setOptionRetired } from "../option-lists.ts";

const refused = (reason: "not_found" | "duplicate_value" | "too_deep") => new HttpError(reason === "not_found" ? 404 : 409, reason);

// Option Lists (RP-279): a Rabaed Engineer maintains them; every edit needs a reason.
export const optionListRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    const signedIn = {
      onRequest: async (request: Parameters<AdminContext["requireEngineer"]>[0]) => {
        ctx.requireEngineer(request);
      },
    };
    const listParams = z.object({ listId: z.uuid() });
    const optionParams = z.object({ optionId: z.uuid() });

    app.get("/v1/option-lists", { ...signedIn, schema: { response: { 200: optionLists } } }, async () => ({
      optionLists: await listOptionLists(ctx.db),
    }));

    app.post(
      "/v1/option-lists",
      { ...signedIn, schema: { body: createOptionListRequest, response: { 201: z.object({ id: z.uuid() }) } } },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        return reply.code(201).send({ id: await createOptionList(ctx.db, engineerId, request.body) });
      },
    );

    app.post(
      "/v1/option-lists/:listId/options",
      { ...signedIn, schema: { params: listParams, body: addOptionRequest, response: { 201: z.object({ id: z.uuid() }) } } },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await addOption(ctx.db, engineerId, request.params.listId, request.body);
        if (!result.ok) throw refused(result.reason);
        return reply.code(201).send({ id: result.value });
      },
    );

    app.post(
      "/v1/options/:optionId/rename",
      { ...signedIn, schema: { params: optionParams, body: renameOptionRequest } },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await renameOption(ctx.db, engineerId, request.params.optionId, request.body);
        if (!result.ok) throw refused(result.reason);
        return reply.code(204).send();
      },
    );

    for (const [path, retired] of [
      ["retire", true],
      ["restore", false],
    ] as const) {
      app.post(
        `/v1/options/:optionId/${path}`,
        { ...signedIn, schema: { params: optionParams, body: optionReasonRequest } },
        async (request, reply) => {
          const engineerId = ctx.requireEngineer(request);
          const result = await setOptionRetired(ctx.db, engineerId, request.params.optionId, retired, request.body.reason);
          if (!result.ok) throw refused(result.reason);
          return reply.code(204).send();
        },
      );
    }
  };
