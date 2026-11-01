import { z } from "zod";

/**
 * An optional environment value, a secret or any other string: absent, empty or blank, it is unset. A `.env` holds an
 * unset value as an empty line (`KEY=`), and `z.string().min(1).optional()` refuses that, so an empty
 * `UAT_SEALING_AUTHORITY_KEY=` in .env.example would have stopped the worker in every lane (#560, RP-1196).
 * The env schemas use this for every optional string; `rabaed/env-optional-secret` keeps them to it.
 */
export const optionalSecret = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().min(1).optional());
