import { markNotificationsReadRequest, notificationList } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppContext } from "../app.ts";
import { listNotifications, markNotificationsRead } from "../notifications/notifications.ts";

// The signed-in Member's in-app notifications (the bell).
export const notificationRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/notifications", { schema: { response: { 200: notificationList } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return listNotifications(ctx.db, memberId);
    });

    app.post("/v1/notifications/read", { schema: { body: markNotificationsReadRequest } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      await markNotificationsRead(ctx.db, memberId, request.body.ids, ctx.now());
      return reply.code(204).send();
    });
  };
