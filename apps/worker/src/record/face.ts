import type { RecordFace } from "@rabaed/domain";
import { isShortCode, type RecordData } from "./record-data.ts";

// The record's printed face (RP-157; workflow-engine.md §7): what the public verification page shows,
// taken from the Record Data the record printed and nothing else, so the page shows the record as it
// was sealed (never the live item), in the language(s) it printed. The signers are the approval flow's
// entries: the path to the outcome (recordPath), in its order.

export function recordFace(data: RecordData): RecordFace {
  return {
    language: data.language,
    documentNumber: data.documentNumber,
    subject: data.subject,
    project: data.projectName,
    // The layout prints a short code (A, B, C, D) as itself and any other outcome by its name only.
    outcome: { code: isShortCode(data.outcome.code) ? data.outcome.code : null, name: data.outcome.name },
    signers: data.transitions.map((t) => ({ name: t.name, positions: [...t.positions], company: t.company })),
  };
}
