import { itemsToCreate, outcomeLook, type BilingualText, type Outcome, type OutcomeLook, type WorkItemHistory } from "@rabaed/domain";

/**
 * The Submittal Panel's approval log and Internal Communication (RP-1067, spec RP-1054 gaps A6–A9,
 * README §5): one timeline, newest first, worked out apart from React so it can be tested.
 *
 * Both read only the history read (`GET /v1/work-items/:id/history`), split by its `audience`. The
 * read already leaves out another Participant's internal events and names another Company by name
 * only, except the signer of the final Code (V5, V14, "Work Item history"). Nothing here puts back
 * what it hides: the model only sorts, splits and groups what it gives.
 */

export type SubmittalTimelineEvent = WorkItemHistory["events"][number];

export type SubmittalLogEntry =
  /** When it got its Document Number (the Creation Date): for the raiser's Participant only. */
  | { kind: "created"; at: string }
  /** One shared move between Participants: a Submit, a Send Back, a Code. */
  | {
      kind: "event";
      event: SubmittalTimelineEvent;
      /** Who acted, by name: one of the viewer's own Company's people, or the Code's signer (V14); null for another Company's. */
      person: BilingualText | null;
      /** The shared text written with it: the Cover Note with a Submit, the Remarks with a Code. */
      texts: SubmittalTimelineText[];
      tone: SubmittalTimelineTone;
      /** On the Code that raised Comments (Code B): how many the viewer sees, of which Type; null for none. */
      comments: { typeCode: string; count: number } | null;
    }
  /**
   * Another Company's stretch of the route, its internal Steps collapsed into one block (V14):
   * "<Company> review", by the name the read gives, with no people, no Steps and no time.
   */
  | { kind: "review"; companyName: BilingualText };

export type SubmittalApprovalLogInput = {
  /** The history read's events, oldest first, as it gives them. */
  events: readonly SubmittalTimelineEvent[];
  /** The viewer's own Company (`GET /v1/me`), by the legal name the history names Companies by. */
  viewerCompany: BilingualText | null;
  /** The item read's Creation Date: given to the raiser's Participant only, null for everyone else. */
  creationDate: string | null;
  /** The item's Type's outcomes on the Project (the List's `filters.outcomes`), to colour a Code by its place in the set. */
  outcomes?: readonly Pick<Outcome, "code" | "polarity" | "actions">[];
  /** The item read's `raisedItems`: the items raised from it per Type, counting only those the viewer sees. */
  raisedItems?: readonly { type: { code: string }; open: number; closed: number }[];
};

/** A timeline entry's dot (README §5): neutral, ok (green), warn (amber) or bad (red). */
export type SubmittalTimelineTone = "neutral" | "ok" | "warn" | "bad";

const toneOfLook: Record<OutcomeLook, SubmittalTimelineTone> = { a: "ok", b: "warn", c: "bad", d: "bad" };

export type SubmittalTimelineText = { kind: "coverNote" | "remarks" | "internalNote" | "reason"; text: string };

/** The Cover Note's key in the Submit's Action Form (the Rabaed Default `cover_note` Screen). */
export const coverNoteKey = "cover_note";

const written = (text: unknown): text is string => typeof text === "string" && text.trim() !== "";

/** The log's text: the Cover Note and the Remarks only (gap A7); a text box only when one was written. */
function sharedTexts(event: SubmittalTimelineEvent): SubmittalTimelineText[] {
  const cover = event.answers?.[coverNoteKey];
  return [
    ...(written(cover) ? [{ kind: "coverNote" as const, text: cover }] : []),
    ...(written(event.remarks) ? [{ kind: "remarks" as const, text: event.remarks }] : []),
  ];
}

const sameName =(a: BilingualText | null, b: BilingualText | null) => a !== null && b !== null && a.en === b.en && a.ar === b.ar;

/**
 * The approval log, newest first: the shared moves only (internal ones are Internal Communication),
 * each of another Company's turns preceded by one "<Company> review" block standing for its internal
 * Steps. A turn that opens the log (another Company's first Submit, before which the viewer saw
 * nothing) gets no block.
 */
export function submittalApprovalLog({ events, viewerCompany, creationDate, outcomes = [], raisedItems = [] }: SubmittalApprovalLogInput): SubmittalLogEntry[] {
  const outcomeOf = (event: SubmittalTimelineEvent) => (event.outcome === null ? undefined : outcomes.find((o) => o.code === event.outcome));
  const tone = (event: SubmittalTimelineEvent): SubmittalTimelineTone => {
    const outcome = outcomeOf(event);
    if (outcome) return toneOfLook[outcomeLook(outcome, outcomes)];
    // A shared move with a reason given is a Send Back: the item goes back.
    return event.reason !== null ? "warn" : "neutral";
  };
  const comments = (event: SubmittalTimelineEvent) => {
    const outcome = outcomeOf(event);
    const typeCode = outcome ? itemsToCreate(outcome) : null;
    const raised = typeCode === null ? undefined : raisedItems.find((r) => r.type.code === typeCode);
    const count = raised ? raised.open + raised.closed : 0;
    return typeCode !== null && count > 0 ? { typeCode, count } : null;
  };
  // The read gives it to the raiser's Participant only; when the Draft was started is never shown.
  const oldestFirst: SubmittalLogEntry[] = creationDate === null ? [] : [{ kind: "created", at: creationDate }];
  let previous: SubmittalTimelineEvent | null = null;
  for (const event of events) {
    if (event.audience !== "shared") continue;
    const company = event.by.companyName;
    const another = company !== null && !sameName(company, viewerCompany);
    if (another && previous !== null && !sameName(previous.by.companyName, company)) oldestFirst.push({ kind: "review", companyName: company });
    // Another Company by name only, but for whoever issued the Code (V14); never more than the read gives.
    const person = another && event.type !== "issue_code" ? null : event.by.memberName;
    oldestFirst.push({ kind: "event", event, person, texts: sharedTexts(event), tone: tone(event), comments: comments(event) });
    previous = event;
  }
  return oldestFirst.reverse();
}

export type SubmittalInternalEntry = {
  event: SubmittalTimelineEvent;
  /** Who acted, as the read names them: the viewer's own people; another Company's (the Consultant's Recommendation the Owner reads, ADR 0022) by its name only. */
  person: BilingualText | null;
  /** An Internal Note, or a Return's reason. */
  texts: SubmittalTimelineText[];
  tone: SubmittalTimelineTone;
};

/**
 * Internal Communication (gap A9, V5), newest first: the internal events the history read gives the
 * viewer, which are their own Participant's only (Internal Notes, internal Step moves, Returns,
 * internal approvals, a Recommended Code). A shared move is the approval log's, never here.
 */
export function submittalInternalLog(events: readonly SubmittalTimelineEvent[], outcomes: readonly Pick<Outcome, "code" | "polarity" | "actions">[] = []): SubmittalInternalEntry[] {
  const tone = (event: SubmittalTimelineEvent): SubmittalTimelineTone => {
    const recommended = event.recommendedCode === null ? undefined : outcomes.find((o) => o.code === event.recommendedCode);
    if (recommended) return toneOfLook[outcomeLook(recommended, outcomes)];
    // A Return goes back with its reason.
    return event.reason !== null && event.type !== "assigned" ? "warn" : "neutral";
  };
  return events
    .filter((event) => event.audience === "internal")
    .map((event) => ({
      event,
      person: event.by.memberName,
      texts: [
        ...(written(event.internalNote) ? [{ kind: "internalNote" as const, text: event.internalNote }] : []),
        // An `assigned` event's reason is why it was handed over, which its label already says.
        ...(written(event.reason) && event.type !== "assigned" ? [{ kind: "reason" as const, text: event.reason }] : []),
      ],
      tone: tone(event),
    }))
    .reverse();
}
