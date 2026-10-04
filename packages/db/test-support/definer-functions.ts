// Finds SECURITY DEFINER functions in migration SQL (RP-287). Only a function's
// header (from `create function` to the `as` that opens its body) is read, so
// words inside a body or a comment never count.

type Header = { name: string; text: string };

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function headersOf(sql: string): Header[] {
  const source = stripComments(sql);
  const start = /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/gi;
  const headers: Header[] = [];
  for (let found = start.exec(source); found; found = start.exec(source)) {
    const afterName = start.lastIndex;
    const body = /\bas\s+(\$[A-Za-z_]*\$|')/i.exec(source.slice(afterName));
    if (!body) {
      headers.push({ name: found[1]!, text: source.slice(afterName) });
      break;
    }
    const bodyStart = afterName + body.index + body[0].length;
    headers.push({ name: found[1]!, text: source.slice(afterName, afterName + body.index) });
    // Resume after the body, so a `create function` quoted inside it is not read.
    const close = source.indexOf(body[1]!, bodyStart);
    start.lastIndex = close === -1 ? source.length : close + body[1]!.length;
  }
  return headers;
}

const definers = (sql: string) => headersOf(sql).filter(({ text }) => /\bsecurity\s+definer\b/i.test(text));

/** Names of the SECURITY DEFINER functions in `sql` that set no search_path. */
export function definerFunctionsWithoutSearchPath(sql: string): string[] {
  return definers(sql)
    .filter(({ text }) => !/\bset\s+search_path\b/i.test(text))
    .map(({ name }) => name);
}

export function definerFunctionCount(sql: string): number {
  return definers(sql).length;
}
