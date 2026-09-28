/** An error the API answers with `{ error: code }` and this status. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Not found, or not visible to you: the two are indistinguishable (visibility.md). */
export const notFound = () => new HttpError(404, "not_found");
export const notSignedIn = () => new HttpError(401, "not_signed_in");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id from the URL, or a 404 exactly like one that doesn't exist (ids are UUIDs). */
export function idOrNotFound(value: string): string {
  if (!uuid.test(value)) throw notFound();
  return value;
}

/** Signed in, but not allowed to do this to something you can see. */
export const forbidden = () => new HttpError(403, "forbidden");
