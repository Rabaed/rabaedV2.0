import { z } from "zod";

/**
 * An optional environment value, a secret or any other string: absent, empty or blank, it is unset. A `.env` holds an
 * unset value as an empty line (`KEY=`), and `z.string().min(1).optional()` refuses that, so an empty
 * `UAT_SEALING_AUTHORITY_KEY=` in .env.example would have stopped the worker in every lane (#560, RP-1196).
 * The env schemas use this for every optional string; `rabaed/env-optional-secret` keeps them to it.
 */
const blankAsUnset = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const optionalSecret = z.preprocess(blankAsUnset, z.string().min(1).optional());

/** Where web names the visitor it calls the api for, and the key that lets the api believe it (RP-1230). */
export const VISITOR_HEADER = "x-rabaed-visitor";
export const VISITOR_KEY_HEADER = "x-rabaed-visitor-key";

/** The shortest VISITOR_FORWARD_SECRET web and the api take (RP-1230). */
export const VISITOR_FORWARD_SECRET_MIN_LENGTH = 32;

/**
 * VISITOR_FORWARD_SECRET, the key with which web names the visitor a public route's limit counts (RP-1230). Absent,
 * empty or blank, it is unset, and the api counts the direct caller as before. Set but shorter than 32 characters, it is
 * refused, so the process does not start with a guessable key; the error names the variable, never the value.
 */
export const visitorForwardSecret = z.preprocess(
  blankAsUnset,
  z.string().min(VISITOR_FORWARD_SECRET_MIN_LENGTH, `must be ${VISITOR_FORWARD_SECRET_MIN_LENGTH} characters or more`).optional(),
);

/** VISITOR_FORWARD_SECRET from an environment, by the rule above: undefined when unset, a throw when too short. */
export const readVisitorForwardSecret = (source: Record<string, string | undefined>): string | undefined =>
  z.object({ VISITOR_FORWARD_SECRET: visitorForwardSecret }).parse(source).VISITOR_FORWARD_SECRET;
