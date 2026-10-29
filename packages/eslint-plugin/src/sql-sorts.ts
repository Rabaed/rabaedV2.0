/**
 * Reading `order by` clauses in SQL text, pragmatically (not a SQL parser): shared by the migration checks
 * (scripts/check-migrations-hidden-sort.ts, scripts/check-sort-tiebreakers.ts) and the
 * rabaed/order-by-tiebreaker lint rule, so a sort is read one way everywhere.
 */

// Words that end an `order by` clause when met outside parentheses.
const clauseEnd = new Set(["limit", "offset", "fetch", "for", "union", "intersect", "except", "rows", "range", "groups", "window", "returning", "loop", "into", "then", "else", "end", "when"]);

/**
 * The SQL with each comment blanked out (newlines kept, so offsets and line
 * numbers still match), and each comment's text by line. A `'…'` literal or a
 * `"…"` identifier is skipped over, so `--` inside one starts no comment; its
 * contents stay in the code, so dynamic SQL in a literal is checked like any
 * other. A `$$` body is code, not skipped.
 */
export function splitComments(sql: string): { code: string; comments: Map<number, string> } {
  const comments = new Map<number, string>();
  let code = "";
  let line = 1;
  const blank = (text: string) => {
    for (const [i, part] of text.split("\n").entries()) {
      if (i > 0) line++;
      comments.set(line, (comments.get(line) ?? "") + part);
    }
    return text.replace(/[^\n]/g, " ");
  };
  for (let i = 0; i < sql.length; ) {
    const two = sql.slice(i, i + 2);
    let end: number;
    if (two === "--") {
      end = sql.indexOf("\n", i);
      if (end === -1) end = sql.length;
      code += blank(sql.slice(i, end));
    } else if (two === "/*") {
      end = sql.indexOf("*/", i + 2);
      end = end === -1 ? sql.length : end + 2;
      code += blank(sql.slice(i, end));
    } else if (sql[i] === "'" || sql[i] === '"') {
      // A doubled quote inside is an escaped one.
      const quote = sql[i];
      end = i + 1;
      while (end < sql.length && !(sql[end] === quote && sql[end + 1] !== quote)) end += sql[end] === quote ? 2 : 1;
      end = Math.min(end + 1, sql.length);
      const literal = sql.slice(i, end);
      line += literal.split("\n").length - 1;
      code += literal;
    } else {
      end = i + 1;
      if (sql[i] === "\n") line++;
      code += sql[i];
    }
    i = end;
  }
  return { code, comments };
}

/** Where the sort clause starting at `start` (just after `order by`) ends: a `;`, `$$`, an unmatched `)` or a word that ends it. */
export function orderByEnd(code: string, start: number): number {
  const token = /\$\$|[();]|[a-z_]\w*/gi;
  token.lastIndex = start;
  let depth = 0;
  for (let match = token.exec(code); match; match = token.exec(code)) {
    const word = match[0].toLowerCase();
    if (word === "(") depth++;
    else if (word === ")" && depth-- === 0) return match.index;
    else if (word === ";" || word === "$$" || (depth === 0 && clauseEnd.has(word))) return match.index;
  }
  return code.length;
}

/** A timestamp column, maybe qualified or quoted: `at`, `created_at`, `l.updated_at`, `"x"."at"` (RP-1105). */
export const timestampColumn = /^(?:"?\w+"?\.)?"?(?:at|\w+_at)"?$/i;

/** A sort whose last key is a timestamp column. */
export interface UntiedSort {
  /** 1-based line of the last key. */
  line: number;
  /** The last key as written, e.g. `e.at`. */
  key: string;
}

const exceptionComment = /sort-tiebreaker:\s*\S/;
const sortStart = /\border\s+by\b/gi;
// What may follow a key's expression: a collation, a direction (or USING), NULLS FIRST/LAST.
const modifiers = /(?:\s+collate\s+(?:"[^"]*"|\w+))?(?:\s+(?:asc|desc|using\s+\S+))?(?:\s+nulls\s+(?:first|last))?$/i;

/** Each `'…'` literal in comment-free code, as [start, end) with `end` just past its closing quote. */
function literalSpans(code: string): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '"') {
      const close = code.indexOf('"', i + 1);
      i = close === -1 ? code.length : close;
    } else if (code[i] === "'") {
      let end = i + 1;
      while (end < code.length && !(code[end] === "'" && code[end + 1] !== "'")) end += code[end] === "'" ? 2 : 1;
      spans.push([i, Math.min(end + 1, code.length)]);
      i = end;
    }
  }
  return spans;
}

/** Offset of the last key of the sort list in code[start, end): after its last comma outside parentheses and literals. */
function lastKeyStart(code: string, start: number, end: number, literals: [number, number][]): number {
  let depth = 0;
  let last = start;
  for (let i = start; i < end; i++) {
    const literal = literals.find(([s, e]) => s === i && e <= end);
    if (literal) {
      i = literal[1] - 1;
      continue;
    }
    if (code[i] === "(") depth++;
    else if (code[i] === ")") depth--;
    else if (code[i] === "," && depth === 0) last = i + 1;
  }
  return last;
}

/**
 * Each `order by` in the SQL (a query's, a window's or an aggregate's) whose last key is a timestamp column, unless
 * a `-- sort-tiebreaker: <reason>` comment on that key's line or the line above covers it. A sort inside a `'…'`
 * literal (dynamic SQL: `execute 'select … order by at' using …`, `format('… order by at', …)`) ends at the literal.
 * A key counts only as a plain column; an expression, a position or an output alias is not followed.
 */
export function untiedSorts(sql: string): UntiedSort[] {
  const { code, comments } = splitComments(sql);
  const excepted = (line: number) => exceptionComment.test(comments.get(line) ?? "");
  const literals = literalSpans(code);
  const found: UntiedSort[] = [];
  for (const clause of code.matchAll(sortStart)) {
    const start = clause.index + clause[0].length;
    const inside = literals.find(([s, e]) => s < clause.index && clause.index < e);
    const end = inside ? Math.min(orderByEnd(code, start), inside[1] - 1) : orderByEnd(code, start);
    const from = lastKeyStart(code, start, end, literals);
    const raw = code.slice(from, end);
    const key = raw.trim().replace(modifiers, "").trim();
    if (!timestampColumn.test(key)) continue;
    const line = code.slice(0, from + raw.indexOf(key)).split("\n").length;
    if (excepted(line) || excepted(line - 1)) continue;
    found.push({ line, key });
  }
  return found;
}
