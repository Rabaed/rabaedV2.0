# Form answers are read only through one function that strips what the reader may not see

ADR 0006 stores a Work Item's answers as one JSONB document, and row-level security decides who sees the Work Item. But RLS works on whole rows. Some answers point at things another Company may not see: a `member` answer holds the id of a Contractor's person (V14), and from Form engine part 2b a `work_item_ref` holds the id of another Work Item the reader may not be able to see (E1). Once a Consultant can see the item, the database role could read those ids straight from `work_item.data`. The API already hides them, but the visibility rules apply to every layer, not only the API (RP-275).

We decided that the app role can't read `work_item.data` directly. Answers are read only through one database function, which re-checks that the caller sees the item and **strips every reference the caller may not see**: another Company's Member (shown elsewhere as that Company's name only, V14), a Participant they may not see, and later a Work Item they may not see. Every field type that holds a reference goes through that one gate. The answers stay one document, so sealing and hashing are unchanged, and the hash is still taken over the full, unstripped answers.

## Considered Options

- **A table per reference type, each with its own row-level security** (as Trade, Location and Scopes were split out in RP-270): rejected; every new reference type would need its own table, and the answers would be spread across many tables, against ADR 0006.
- **Keep the protection in the API only, with a written exception to the visibility rules:** rejected; it breaks the rule that every channel applies the same layers.

## Consequences

Any new field type that stores an id must declare how the function strips it, and a seam-2 test must prove that the app role can't read it for another Company.

## Amended 2026-10-05 (Form engine part 2b)

A `work_item_ref` reference the caller may not see is **replaced, not dropped**: the function returns that item's Document Number and Subject in place of its id. E1 lets everyone who sees a Work Item see the number and Subject of every item it links to, so dropping the reference would hide a Link the rules allow, while keeping the id would let the caller ask for the item. `member` and `participant` references are still dropped.
