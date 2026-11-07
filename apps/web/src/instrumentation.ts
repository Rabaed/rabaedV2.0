import { visitorForwardSecretFromEnv } from "./lib/visitor-forward.ts";

/**
 * Runs once as a web server instance starts, before it takes a request (Next's instrumentation file).
 * A VISITOR_FORWARD_SECRET shorter than 32 characters stops it here, as the api's config does
 * (RP-1230); the error names the variable, never the value.
 */
export function register(): void {
  visitorForwardSecretFromEnv();
}
