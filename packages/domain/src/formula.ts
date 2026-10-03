// The formula language of `calculated` fields (form-engine.md §2.4; RP-283):
// numbers, numeric field keys and `sum(table.column)`, joined by `+ − × ÷` and
// parentheses (`-`, `*` and `/` are taken too). One evaluator works the result
// out in the browser, live, and on the server, which stores it with the answers.
// Pure, with no I/O, so the offline app can use it later (ADR 0004).

/** A parsed formula. */
export type Formula =
  | { kind: "number"; value: number }
  | { kind: "field"; key: string }
  | { kind: "sum"; table: string; column: string }
  | { kind: "negate"; of: Formula }
  | { kind: "operation"; op: Operator; left: Formula; right: Formula };

type Operator = "+" | "-" | "*" | "/";

/** What a formula reads: a field by `key`, or with `column`, that column of the table `key`. */
export type FormulaReference = { key: string; column?: string };

const operators: Record<string, Operator> = { "+": "+", "-": "-", "−": "-", "*": "*", "×": "*", "/": "/", "÷": "/" };

type Token =
  | { kind: "number"; value: number }
  | { kind: "key"; key: string }
  | { kind: "operator"; op: Operator }
  | { kind: "(" | ")" | "." };

// One token after any spaces: a number in Latin digits, a key, or a sign.
const tokenPattern = /\s*(?:(\d+(?:\.\d+)?)|([a-z][a-z0-9_]*)|([-+−*×/÷().]))/y;

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  for (let at = 0; text.slice(at).trim() !== ""; ) {
    tokenPattern.lastIndex = at;
    const match = tokenPattern.exec(text);
    if (!match) return null;
    at = tokenPattern.lastIndex;
    const [, digits, key, sign] = match;
    if (digits !== undefined) tokens.push({ kind: "number", value: Number(digits) });
    else if (key !== undefined) tokens.push({ kind: "key", key });
    else if (sign! in operators) tokens.push({ kind: "operator", op: operators[sign!]! });
    else tokens.push({ kind: sign as "(" | ")" | "." });
  }
  return tokens;
}

/** The formula `text` means, or null when it isn't one. */
export function parseFormula(text: string): Formula | null {
  const tokens = tokenize(text);
  if (!tokens) return null;
  let at = 0;
  const operatorAt = (ops: readonly Operator[]) => {
    const token = tokens[at];
    return token?.kind === "operator" && ops.includes(token.op) ? token.op : null;
  };

  // Left to right, × ÷ before + −.
  const chain = (ops: readonly Operator[], operand: () => Formula | null) => (): Formula | null => {
    let left = operand();
    for (let op = operatorAt(ops); left && op; op = operatorAt(ops)) {
      at++;
      const right = operand();
      left = right && { kind: "operation", op, left, right };
    }
    return left;
  };

  const factor = (): Formula | null => {
    const token = tokens[at++];
    switch (token?.kind) {
      case "number":
        return token;
      case "operator": {
        if (token.op !== "-") return null;
        const of = factor();
        return of && { kind: "negate", of };
      }
      case "(": {
        const inner = expression();
        return inner && tokens[at++]?.kind === ")" ? inner : null;
      }
      case "key": {
        if (token.key !== "sum" || tokens[at]?.kind !== "(") return { kind: "field", key: token.key };
        const [, table, dot, column, close] = tokens.slice(at, at + 5);
        at += 5;
        return table?.kind === "key" && dot?.kind === "." && column?.kind === "key" && close?.kind === ")"
          ? { kind: "sum", table: table.key, column: column.key }
          : null;
      }
      default:
        return null;
    }
  };
  const term = chain(["*", "/"], factor);
  const expression = chain(["+", "-"], term);

  const formula = expression();
  return formula && at === tokens.length ? formula : null;
}

/** The fields and table columns a formula reads, once each, in the order written. */
export function formulaReferences(formula: Formula): FormulaReference[] {
  const read = (f: Formula): FormulaReference[] => {
    switch (f.kind) {
      case "number":
        return [];
      case "field":
        return [{ key: f.key }];
      case "sum":
        return [{ key: f.table, column: f.column }];
      case "negate":
        return read(f.of);
      case "operation":
        return [...read(f.left), ...read(f.right)];
    }
  };
  const seen = new Set<string>();
  return read(formula).filter((r) => {
    const id = `${r.key}.${r.column ?? ""}`;
    return !seen.has(id) && seen.add(id);
  });
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * The formula's result over `answers`, unrounded; null when it is empty: an
 * input is missing (or isn't a number), a column it sums has no number in it,
 * or it divides by zero. 0 is an input.
 */
export function evaluateFormula(formula: Formula, answers: Readonly<Record<string, unknown>>): number | null {
  const value = (f: Formula): number | null => {
    switch (f.kind) {
      case "number":
        return f.value;
      case "field": {
        const answer = answers[f.key];
        return isNumber(answer) ? answer : null;
      }
      case "sum": {
        const rows = answers[f.table];
        if (!Array.isArray(rows)) return null;
        const cells = rows.map((row: unknown) => (typeof row === "object" && row !== null ? (row as Record<string, unknown>)[f.column] : undefined));
        const numbers = cells.filter(isNumber);
        return numbers.length === 0 ? null : numbers.reduce((sum, n) => sum + n, 0);
      }
      case "negate": {
        const of = value(f.of);
        return of === null ? null : -of;
      }
      case "operation": {
        const left = value(f.left);
        const right = value(f.right);
        if (left === null || right === null) return null;
        if (f.op === "/" && right === 0) return null;
        return f.op === "+" ? left + right : f.op === "-" ? left - right : f.op === "*" ? left * right : left / right;
      }
    }
  };
  const result = value(formula);
  return result !== null && Number.isFinite(result) ? result : null;
}

/**
 * `value` rounded to `decimals` places, halves away from zero. The float error
 * of the arithmetic is dropped first, so 1.005 rounds to 1.01 and 0.1 + 0.2 is 0.3.
 */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(Number((Math.abs(value) * factor).toPrecision(15))) / factor;
  // No −0.
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}
