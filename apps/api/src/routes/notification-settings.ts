import { notificationSettingsView, updateNotificationSettingsRequest } from "@rabaed/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { idOrNotFound } from "../http-error.ts";
import { getNotificationSettings, setProjectMute, updateNotificationSettings } from "../notifications/settings.ts";
import { refusal } from "../refusals.ts";

const projectParams = z.object({ projectId: z.string() });

// The signed-in Member's notification settings (RP-355), and a mute per Project
// they are on. A Project they are not on answers exactly like one that doesn't
// exist (404).
export const notificationSettingsRoutes =
  (ctx: AppContext): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/v1/notification-settings", { schema: { response: { 200: notificationSettingsView } } }, async (request) => {
      const memberId = ctx.requireMember(request);
      return getNotificationSettings(ctx.db, memberId);
    });

    app.put("/v1/notification-settings", { schema: { body: updateNotificationSettingsRequest } }, async (request, reply) => {
      const memberId = ctx.requireMember(request);
      await updateNotificationSettings(ctx.db, memberId, request.body, ctx.now());
      return reply.code(204).send();
    });

    for (const [method, muted] of [
      ["PUT", true],
      ["DELETE", false],
    ] as const) {
      app.route({
        method,
        url: "/v1/projects/:projectId/mute",
        schema: { params: projectParams },
        handler: async (request, reply) => {
          const memberId = ctx.requireMember(request);
          const result = await setProjectMute(ctx.db, memberId, idOrNotFound(request.params.projectId), muted);
          if (!result.ok) throw refusal(result);
          return reply.code(204).send();
        },
      });
    }
  };
