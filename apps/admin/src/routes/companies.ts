import { crNumber, engineerReason, onboardCompanyRequest, onboardingLeads, type BilingualText, type Locale } from "@rabaed/domain";
import { invitationMessage } from "@rabaed/mailer";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, type AdminContext } from "../app.ts";
import { closeOnboardingLead, listOnboardingLeads } from "../onboarding-leads.ts";
import { inviteAuthorizedPerson, onboardCompany } from "../onboarding.ts";

export const companyRoutes =
  (ctx: AdminContext): FastifyPluginAsyncZod =>
  async (app) => {
    /** Emails the Authorized Person their invitation, in their language, linking to the customer web. */
    const sendInvitation = (to: { email: string; locale: Locale; companyName: BilingualText; token: string }) =>
      ctx.mailer.send(invitationMessage({ to: to.email, locale: to.locale, companyName: to.companyName, token: to.token }, ctx.config.webUrl));

    // Onboards a Company and invites its Authorized Person by email. Should
    // the email fail, the Company stands; invite again (below).
    app.post(
      "/v1/companies",
      {
        schema: {
          body: onboardCompanyRequest,
          response: { 201: z.object({ companyId: z.uuid(), authorizedPersonId: z.uuid(), invitationSentTo: z.string() }) },
        },
      },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const body = request.body;
        const result = await onboardCompany(ctx.db, engineerId, body, ctx.now(), ctx.config.invitationTtlMs);
        if (!result.ok) throw new HttpError(409, `duplicate_${result.conflict}`);
        const person = body.authorizedPerson;
        await sendInvitation({ email: person.email, locale: person.locale, companyName: body.legalName, token: result.invitation.token });
        return reply.code(201).send({ companyId: result.companyId, authorizedPersonId: result.authorizedPersonId, invitationSentTo: person.email });
      },
    );

    // Invites a Company's Authorized Person again, by the Company's CR number.
    app.post(
      "/v1/invitations",
      {
        schema: {
          body: z.object({ crNumber, reason: engineerReason }),
          response: { 201: z.object({ companyId: z.uuid(), invitationSentTo: z.string() }) },
        },
      },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await inviteAuthorizedPerson(ctx.db, engineerId, request.body, ctx.now(), ctx.config.invitationTtlMs);
        if (!result.ok) throw result.reason === "not_found" ? new HttpError(404, "not_found") : new HttpError(409, "already_active");
        const { invited } = result;
        await sendInvitation({ email: invited.email, locale: invited.locale, companyName: invited.companyName, token: invited.invitation.token });
        return reply.code(201).send({ companyId: invited.companyId, invitationSentTo: invited.email });
      },
    );

    // The CR numbers Project Admins invited that aren't on Rabaed, for Rabaed to onboard (ADR 0009).
    app.get(
      "/v1/onboarding-leads",
      { schema: { querystring: z.object({ reason: engineerReason }), response: { 200: onboardingLeads } } },
      async (request) => {
        const engineerId = ctx.requireEngineer(request);
        return { leads: await listOnboardingLeads(ctx.db, engineerId, request.query.reason) };
      },
    );

    // Takes a lead that won't be onboarded off Rabaed's list. The Project Admin's
    // invitation stays pending until they withdraw it (ADR 0009).
    app.post(
      "/v1/onboarding-leads/:leadId/close",
      { schema: { params: z.object({ leadId: z.uuid() }), body: z.object({ reason: engineerReason }) } },
      async (request, reply) => {
        const engineerId = ctx.requireEngineer(request);
        const result = await closeOnboardingLead(ctx.db, engineerId, request.params.leadId, request.body.reason, ctx.now());
        if (!result.ok) throw new HttpError(404, "not_found");
        return reply.code(204).send();
      },
    );
  };
