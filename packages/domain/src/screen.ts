import { z } from "zod";
import { actionFormProblems } from "./action-form.ts";
import { bilingualText, type BilingualText } from "./company.ts";
import { answerFields, formSchema, type FormSchema } from "./form.ts";
import type { PublishContext, SchemaProblemCode } from "./form-publish.ts";

// Screens (ADR 0019, RP-516; workflow-engine.md §5.7; data-model.md screen). A Screen is
// a named, reusable, versioned Action Form: an Action Form schema (action-form.ts) whose
// answer fields are each shared or internal to the acting Participant. A Transition
// names the Screen it shows by key, and publishing a Workflow Version pins the Screen's
// latest published Version. Shared answers go in the Transition's event, read by
// everyone who sees the item from that Transition on; internal ones in an event of
// their own, read by the acting Participant only (V5).

/** A Screen's key: snake_case, as Step, Transition and Form keys are. A Transition names its Screen by it. */
export const screenKey = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);

/** A Screen Version's content: its Action Form schema (checked at publish) and the keys of the fields internal to the acting Participant. */
const screenContent = z.object({
  schema: z.unknown(),
  internalFields: z.array(z.string().max(64)).max(200).default([]),
});

/** A Project Admin creates a Screen on the Project: its key, its name and its first draft. */
export const createScreenRequest = screenContent.extend({ key: screenKey, name: bilingualText });
export type CreateScreenRequest = z.infer<typeof createScreenRequest>;

/** Save a Screen's draft: the next Version, published separately. */
export const saveScreenDraftRequest = screenContent;
export type SaveScreenDraftRequest = z.infer<typeof saveScreenDraftRequest>;

/** One thing stopping a Screen Version from being published, about its field `key` (`invalid_schema`: `key` is the path). */
export type ScreenProblem = { key: string; code: SchemaProblemCode | "invalid_schema" | "unknown_internal_field" };

/**
 * What stops `schema`, with `internalFields` internal, from being published as a Screen
 * Version: where it isn't a Form schema, else the Action Form checks (publish check 7),
 * then every internal key that isn't one of its answer fields. Empty when there is nothing.
 */
export function screenProblems(schema: unknown, internalFields: readonly string[], context: PublishContext = {}): ScreenProblem[] {
  const parsed = formSchema.safeParse(schema);
  if (!parsed.success) return parsed.error.issues.map((i) => ({ key: i.path.join(".") || "(schema)", code: "invalid_schema" }));
  const answered = new Set(answerFields(parsed.data).map((f) => f.key));
  return [
    ...actionFormProblems(parsed.data, context),
    ...internalFields.filter((key) => !answered.has(key)).map((key): ScreenProblem => ({ key, code: "unknown_internal_field" })),
  ];
}

/** Who owns a Screen: Rabaed (a Rabaed Default Screen), a Project, or a Company's Library (ADR 0016). */
export type ScreenOwnerKind = "rabaed" | "project" | "company";

/** A Screen Version's content as read. */
export type ScreenVersionContent = { versionNo: number; schema: FormSchema; internalFields: string[] };

/**
 * A Screen as a Member reads it: every Member of its Project (V20), its Company for a
 * Library one (V18), everyone for a Rabaed Default; its draft for its authors only.
 */
export type ScreenRead = {
  id: string;
  key: string;
  name: BilingualText;
  owner: ScreenOwnerKind;
  projectId: string | null;
  publishedVersions: number[];
  published: ScreenVersionContent | null;
  draft: ScreenVersionContent | null;
  canAuthor: boolean;
};

/** The Screens a Project's Workflows may show: its own and the Rabaed Defaults, each with its latest published Version number. */
export type ScreenList = {
  screens: { id: string; key: string; name: BilingualText; owner: ScreenOwnerKind; latestVersionNo: number | null }[];
};
