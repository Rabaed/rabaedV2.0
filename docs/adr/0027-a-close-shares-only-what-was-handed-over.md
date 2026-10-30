# A close shares only what was handed over

V19 let a close share the holder's files: after an item closed (by a Code, a Cancel, or Rabaed's own Cancel when a Company leaves), another Participant could download a Document the holder had added while holding the item but never Submitted, through `app.item_row_as_arrived`. The sealed Documental Record already left such files out (RP-147: the appendix holds only Documents shared as of the last arrival), so the live item and the Record disagreed about what was shared. We decided (2026-10-31, the product owner, RP-955) that **a close shares only what was handed over**: what other Participants saw at the item's last arrival with them. A file the holder added after that stays the holder's, after the close as well. This matches the Record, and it matches V19's rule that the holder's changes reach others only when they hand the item over.

The Transition content hashes (ADR 0017) still cover the exact content, such files included; only who may read them narrows.

## Considered Options

- **Keep V19 and widen the Record** to the holder's unsubmitted files. Rejected: it shows other Companies files their holder never chose to hand over, and visibility is the first requirement.
- **Share at a close by Code, not at a Cancel.** Rejected: two rules for one question, and a Code's own files already travel with its reply Screen (ADR 0024).
