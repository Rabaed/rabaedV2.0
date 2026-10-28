import { z } from "zod";
import { bilingualText } from "./company.ts";
import { baseRoles } from "./project.ts";

// Chat on a Work Item (RP-1062; GLOSSARY Chat; visibility.md V6 and the Chat row): a text-only thread every
// Participant with access reads, written from the item's Submission Date on. Messages are never edited or deleted.

/** The longest Chat message, in characters, once trimmed. */
export const CHAT_MESSAGE_MAX_LENGTH = 4000;

const projectRole = z.object({ baseRole: z.enum(baseRoles), name: bilingualText });

/**
 * Who wrote a message, as the reader may know it. Of the reader's own Company: the Member by name. Of another
 * Company: that Company's name and Project Role only, never its people (V14).
 */
export const chatAuthor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("own"), memberName: bilingualText, companyName: bilingualText, projectRole }),
  z.object({ kind: z.literal("other"), companyName: bilingualText, projectRole }),
]);
export type ChatAuthor = z.infer<typeof chatAuthor>;

/** An item's Chat, oldest first, with how many messages it holds (the tab's count). */
export const workItemChat = z.object({
  messages: z.array(
    z.object({
      id: z.uuid(),
      author: chatAuthor,
      /** The reader wrote it. */
      mine: z.boolean(),
      body: z.string(),
      /** When it was posted; never before the item's Submission Date. */
      at: z.iso.datetime(),
    }),
  ),
  count: z.number().int().nonnegative(),
});
export type WorkItemChat = z.infer<typeof workItemChat>;

/** A message to post: text only, trimmed, 1 to CHAT_MESSAGE_MAX_LENGTH characters. */
export const postChatMessageRequest = z.object({ body: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH) });
export type PostChatMessageRequest = z.infer<typeof postChatMessageRequest>;

export const postedChatMessage = z.object({ id: z.uuid() });
export type PostedChatMessage = z.infer<typeof postedChatMessage>;
