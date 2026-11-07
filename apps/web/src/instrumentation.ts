import { visitorForwardSecretFromEnv } from "./lib/visitor-forward.ts";

/**
 * Runs once as a web server instance starts, before it serves a request (Next's instrumentation
 * file; not during `next build`). A VISITOR_FORWARD_SECRET shorter than 32 characters fails it, so
 * every request to that instance fails, naming the variable, never the value (RP-1230). The api
 * refuses to start the same way (config.ts), and the deploy refuses such a secret before Vercel gets it.
 */
export function register(): void {
  visitorForwardSecretFromEnv();
}
