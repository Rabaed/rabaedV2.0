import { CHAT_MESSAGE_MAX_LENGTH, type BaseRole, type ChatAuthor, type Locale } from "@rabaed/domain";

// The Submittal Panel's Chat tab (RP-1069; GLOSSARY Chat; visibility.md V6): what it decides apart from drawing.

/**
 * Chat opens on the item's Submission Date: before it only the raiser's Participant sees the item, so
 * nothing written then could later reach another Company (spec RP-1054, owner decision C1).
 */
export function submittalPanelChatOpen(submissionDate: string | null): boolean {
  return submissionDate !== null;
}

/**
 * Whether a key in the composer sends: Enter does, Shift+Enter adds a line. Never while an input
 * method is still composing, since Arabic and other IMEs confirm a word with Enter.
 */
export function submittalPanelChatSends(event: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

/**
 * What the composer holds, as the API would judge it: "ready" is text once trimmed, at most
 * CHAT_MESSAGE_MAX_LENGTH characters (code points). The database's check is the rule; this only keeps
 * Send from offering what it refuses, and says why.
 */
export function submittalPanelChatDraft(body: string): "ready" | "empty" | "too_long" {
  const trimmed = body.trim();
  if (trimmed === "") return "empty";
  return [...trimmed].length <= CHAT_MESSAGE_MAX_LENGTH ? "ready" : "too_long";
}

export type SubmittalPanelChatAuthor = {
  /** The Member's name: only of the reader's own Company. */
  person: string | null;
  company: string;
  /** The Project Role's name, as the Project names it. */
  role: string;
  /** For the role's badge colour and icon. */
  baseRole: BaseRole;
};

/**
 * A message's author as the reader may know them, exactly as the Chat read gives it: of the reader's own
 * Company, the Member by name; of another Company, that Company's name and Project Role only, never its
 * people (V14). Another Company's author is never named here, whatever came with it.
 */
export function submittalPanelChatAuthor(author: ChatAuthor, locale: Locale): SubmittalPanelChatAuthor {
  return {
    person: author.kind === "own" ? author.memberName[locale] : null,
    company: author.companyName[locale],
    role: author.projectRole.name[locale],
    baseRole: author.projectRole.baseRole,
  };
}
