import { describe, expect, it } from "vitest";
import { failed, loaded, loading, mapRead, transitionGate } from "./transition-gate";

// What opening a Transition shows (RP-85, RP-617): the Signature pop-up, the no-Stamp message, the
// Action Form, or, while a reading is still on its way or has failed, nothing yet or an error, so
// no Action Form opens whose answers would be lost when the Transition is refused.

const company = { name: "Al Noor" };
const yes = loaded(true);
const no = loaded(false);

describe("transitionGate", () => {
  it("opens the Action Form for a Member with a Signature whose Company has a Stamp", () => {
    expect(transitionGate({ hasSignature: yes, hasStamp: yes, company: loading })).toEqual({ show: "actionForm" });
  });

  it("asks for the Signature first, even when the Company has no Stamp, or it is not known yet", () => {
    for (const hasStamp of [yes, no, loading, failed]) {
      expect(transitionGate({ hasSignature: no, hasStamp, company: loading })).toEqual({ show: "signature" });
    }
  });

  it("shows the no-Stamp message, naming the Member's own Company, once it is read", () => {
    expect(transitionGate({ hasSignature: yes, hasStamp: no, company: loaded(company) })).toEqual({ show: "stamp", company });
  });

  it("waits while what decides it is still on its way", () => {
    expect(transitionGate({ hasSignature: loading, hasStamp: yes, company: loading })).toEqual({ show: "wait" });
    expect(transitionGate({ hasSignature: yes, hasStamp: loading, company: loading })).toEqual({ show: "wait" });
    // No Stamp, and the Company to name in the message not read yet: an early click waits.
    expect(transitionGate({ hasSignature: yes, hasStamp: no, company: loading })).toEqual({ show: "wait" });
  });

  it("is unavailable, never the Action Form, when a reading failed", () => {
    expect(transitionGate({ hasSignature: failed, hasStamp: yes, company: loaded(company) })).toEqual({ show: "unavailable" });
    expect(transitionGate({ hasSignature: yes, hasStamp: failed, company: failed })).toEqual({ show: "unavailable" });
    expect(transitionGate({ hasSignature: yes, hasStamp: no, company: failed })).toEqual({ show: "unavailable" });
  });
});

describe("mapRead", () => {
  it("maps a loaded value and keeps loading and failed as they are", () => {
    expect(mapRead(loaded(company), (c) => c.name)).toEqual(loaded("Al Noor"));
    expect(mapRead(loading, () => 1)).toBe(loading);
    expect(mapRead(failed, () => 1)).toBe(failed);
  });
});
