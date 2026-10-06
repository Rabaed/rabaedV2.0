# Random ids, not UUIDv7

When a Draft was first started is kept for audit and, once the item has its Document Number, shown to nobody (GLOSSARY "Creation Date", visibility.md). Other Companies see the Submission Date, so they never learn how long the raiser worked on an item. But every table's ids were UUIDv7, which data-model.md called "time-sortable, safe to expose". A UUIDv7 carries the millisecond it was made. A Work Item's id is made when its Draft starts and appears in every response, URL, Link and notification, so anyone who sees the item, other Companies included, could decode when its Draft was started. The same held for the ids of Links made with the Draft and of Documents copied into a Revision. The ids were not safe to expose; the RP-373 grilling (2026-10-06) found this along with the other channels listed in visibility.md under "Creation Date".

We decided that **every table's ids are random (UUIDv4)**. An id carries no time, so it is safe to expose everywhere, and still can't be guessed or enumerated.

## Considered Options

- **Random ids only for the tables whose ids reveal a Draft-started time** (Work Items, Links, Documents): rejected. It is a per-table judgement that each new table has to get right, and a wrong one leaks silently.
- **Keep UUIDv7 as the key and add a separate random public id:** rejected. Two ids per row, and every read and URL has to remember which one it may show.

## Consequences

- Ids lose their time order, so indexes on them lose locality. Accepted: irrelevant at Rabaed's scale.
- Nothing may sort by id to mean "by creation". Un-numbered Drafts in the List and Kanban, which have no Document Number to sort by, come last, ordered by Subject, then id.
- Existing rows keep their ids; only new rows get random ones. Dev and demo are re-seeded, so their data carries no UUIDv7 ids.
