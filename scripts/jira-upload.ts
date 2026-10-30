import { openAsBlob } from "node:fs";
import { basename, resolve } from "node:path";

// Attaches files, such as UAT screenshots, to a Jira issue (RP-1100). Jira's own
// upload route hands back a ready-made curl with the API token inside it, which
// an agent could paste into a script, doc or commit; the repo is public. This
// reads the token from the environment, sends it only in the request's header,
// and never prints it or builds a command that holds it.
//
// Usage: node scripts/jira-upload.ts <RP-nnn> <file>...
// Environment: JIRA_EMAIL, JIRA_API_TOKEN (see .env.example; never commit the values).
// Prints one line per attachment: its id, file name, size and content URL.

const JIRA = "https://rabaedsa.atlassian.net";
// eslint-disable-next-line rabaed/no-avoid-terms -- the node command, by its own name
const USAGE = "usage: node scripts/jira-upload.ts <RP-nnn> <file>...";

export interface Credentials {
  email: string;
  token: string;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  content: string;
}

export interface UploadFile {
  name: string;
  data: Blob;
}

/** The Jira credentials from the environment; an error names what is missing, never a value. */
export function credentialsFrom(env: NodeJS.ProcessEnv): Credentials {
  const email = env.JIRA_EMAIL;
  const token = env.JIRA_API_TOKEN;
  if (email && token) return { email, token };
  const missing = [email ? undefined : "JIRA_EMAIL", token ? undefined : "JIRA_API_TOKEN"].filter(Boolean).join(" and ");
  throw new Error(`Set ${missing} in your environment (see .env.example).`);
}

/** Uploads the files to the issue in one request; Jira answers with every attachment it made. */
export async function uploadAttachments(issue: string, files: UploadFile[], credentials: Credentials, fetchImpl: typeof fetch = fetch): Promise<Attachment[]> {
  const form = new FormData();
  for (const file of files) form.append("file", file.data, file.name);
  const headers = {
    Authorization: `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`).toString("base64")}`,
    Accept: "application/json",
    // Jira refuses a multipart upload without it (its XSRF check).
    "X-Atlassian-Token": "no-check",
  };
  const response = await fetchImpl(`${JIRA}/rest/api/3/issue/${issue}/attachments`, { method: "POST", headers, body: form });
  // Status only: Jira's error text is not echoed.
  if (!response.ok) throw new Error(`Jira POST ${issue} attachments answered ${response.status}`);
  return (await response.json()) as Attachment[];
}

/** One attachment as a line of output. */
export const formatAttachment = (a: Attachment) => `${a.id}  ${a.filename}  ${Math.max(1, Math.round(a.size / 1024))} KB  ${a.content}`;

export function parseArgs(argv: string[]): { issue: string; files: string[] } {
  const [issue, ...files] = argv;
  if (!issue || !/^[A-Z][A-Z0-9]*-\d+$/.test(issue) || files.length === 0) throw new Error(USAGE);
  return { issue, files };
}

async function main(): Promise<void> {
  const { issue, files } = parseArgs(process.argv.slice(2));
  const credentials = credentialsFrom(process.env);
  const uploads = await Promise.all(files.map(async (path) => ({ name: basename(path), data: await openAsBlob(path) })));
  const attachments = await uploadAttachments(issue, uploads, credentials);
  console.log(`${issue}: ${attachments.length} attached`);
  for (const attachment of attachments) console.log(formatAttachment(attachment));
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
