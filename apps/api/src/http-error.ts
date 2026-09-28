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
