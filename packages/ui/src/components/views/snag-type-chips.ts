import type { BilingualText } from "@rabaed/domain";

// The Snag List's type chips (RP-1109, decision RP-1004): one "Questions" chip for the three
// Question Types, and one chip for every other Type. Counts are the API's, of the items the
// viewer sees (V1); the Questions chip only adds its Types' counts up, so it shows no more.

/** The Question Types, each asking another role (GLOSSARY: Question). */
export const questionTypes: readonly string[] = ["QSN", "QSC", "QSO"];

type Type = { code: string; name: BilingualText };

export type TypeChip =
  | { kind: "type"; key: string; codes: string[]; type: Type; count: number | undefined }
  | { kind: "questions"; key: "questions"; codes: string[]; count: number | undefined };

/**
 * The chips after All, in the Module's order: the Questions chip where its first Type is, filtering
 * to the Question Types the Module has. Without counts (under a search) no chip has a number.
 */
export function typeChipsOf(types: readonly Type[], counts: readonly { code: string; count: number }[] | undefined): TypeChip[] {
  const countOf = (codes: readonly string[]) => (counts ? codes.reduce((sum, code) => sum + (counts.find((c) => c.code === code)?.count ?? 0), 0) : undefined);
  const questions = types.filter((t) => questionTypes.includes(t.code)).map((t) => t.code);
  const chips: TypeChip[] = [];
  for (const type of types) {
    if (!questionTypes.includes(type.code)) chips.push({ kind: "type", key: type.code, codes: [type.code], type, count: countOf([type.code]) });
    else if (type.code === questions[0]) chips.push({ kind: "questions", key: "questions", codes: questions, count: countOf(questions) });
  }
  return chips;
}

/** A chip is chosen when the query filters to its Types exactly, in any order. */
export function chipChosen(chip: TypeChip, queryType: readonly string[]): boolean {
  return queryType.length === chip.codes.length && chip.codes.every((code) => queryType.includes(code));
}
