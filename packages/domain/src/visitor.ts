// The visitor a public route's limit counts (typed Verification Codes, RP-157; password-reset
// requests, RP-1058), as web names it to the api (RP-1230). One definition for both, so the visitor
// web names is the one the api would have counted.

/** Where web names the visitor it calls the api for, and the key that lets the api believe it. */
export const VISITOR_HEADER = "x-rabaed-visitor";
export const VISITOR_KEY_HEADER = "x-rabaed-visitor-key";

/**
 * The last entry of an X-Forwarded-For-style address list (a header sent twice counts as one list):
 * the address the proxy nearest the reader saw, whatever a client wrote before it. Undefined when
 * there is none.
 */
export function lastForwardedEntry(header: string | readonly string[] | null | undefined): string | undefined {
  return [header ?? []]
    .flat()
    .join(",")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address !== "")
    .at(-1);
}
