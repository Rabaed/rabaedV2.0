import { describe, expect, it } from "vitest";
import { credentialsFrom, formatAttachment, parseArgs, uploadAttachments } from "./jira-upload.ts";

// RP-1100. The fake token is built at run time, so no file holds one.
const token = ["not", "-a-", "real", "-token-", "x".repeat(12)].join("");
const credentials = { email: "someone@example.com", token };

interface Sent {
  url: string;
  init: RequestInit;
}

/** A fetch that records the request and answers with the given status and body. */
function fakeFetch(status: number, body: unknown): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fetchImpl, sent };
}

const file = (name: string) => ({ name, data: new Blob(["png bytes"], { type: "image/png" }) });

describe("uploadAttachments", () => {
  it("posts every file to the issue's attachments, authorised from the credentials", async () => {
    const { fetch, sent } = fakeFetch(200, [
      { id: "101", filename: "a.png", size: 9, mimeType: "image/png", content: "https://rabaedsa.atlassian.net/rest/api/3/attachment/content/101" },
      { id: "102", filename: "b.png", size: 9, mimeType: "image/png", content: "https://rabaedsa.atlassian.net/rest/api/3/attachment/content/102" },
    ]);
    const attachments = await uploadAttachments("RP-42", [file("a.png"), file("b.png")], credentials, fetch);
    expect(sent).toHaveLength(1);
    const [{ url, init }] = sent as [Sent];
    expect(url).toBe("https://rabaedsa.atlassian.net/rest/api/3/issue/RP-42/attachments");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Atlassian-Token"]).toBe("no-check");
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`someone@example.com:${token}`).toString("base64")}`);
    const form = init.body as FormData;
    expect(form.getAll("file").map((entry) => (entry as File).name)).toEqual(["a.png", "b.png"]);
    expect(attachments.map((a) => a.id)).toEqual(["101", "102"]);
  });

  it("fails with the status only: no token, no Jira error text", async () => {
    const { fetch } = fakeFetch(401, { errorMessages: [`echo ${token}`] });
    const failure = uploadAttachments("RP-42", [file("a.png")], credentials, fetch);
    await expect(failure).rejects.toThrow("Jira POST RP-42 attachments answered 401");
    await expect(failure).rejects.not.toThrow(token);
  });
});

describe("credentialsFrom", () => {
  it("reads JIRA_EMAIL and JIRA_API_TOKEN", () => {
    expect(credentialsFrom({ JIRA_EMAIL: "someone@example.com", JIRA_API_TOKEN: token })).toEqual(credentials);
  });

  it("names the missing variables, never a value", () => {
    expect(() => credentialsFrom({ JIRA_EMAIL: "someone@example.com" })).toThrow("Set JIRA_API_TOKEN in your environment");
    expect(() => credentialsFrom({})).toThrow("Set JIRA_EMAIL and JIRA_API_TOKEN in your environment");
  });
});

describe("parseArgs", () => {
  it("takes an issue key and one or more files", () => {
    expect(parseArgs(["RP-7", "shot 1.png", "b.png"])).toEqual({ issue: "RP-7", files: ["shot 1.png", "b.png"] });
  });

  it("refuses a missing file or a key that is not one", () => {
    expect(() => parseArgs(["RP-7"])).toThrow("usage:");
    expect(() => parseArgs(["rp7", "a.png"])).toThrow("usage:");
    expect(() => parseArgs([])).toThrow("usage:");
  });
});

describe("formatAttachment", () => {
  it("prints the id, file name and size, with no credentials in it", () => {
    const line = formatAttachment({ id: "101", filename: "a.png", size: 2048, mimeType: "image/png", content: "https://rabaedsa.atlassian.net/rest/api/3/attachment/content/101" });
    expect(line).toBe("101  a.png  2 KB  https://rabaedsa.atlassian.net/rest/api/3/attachment/content/101");
    expect(line).not.toContain(token);
  });
});
