# The Documental Record is a sealed PDF/A-3 made from its Record Data

Settled in the RP-23 grilling of 2026-10-16, with the product owner; it also settles RP-529. Amends [ADR 0003](0003-docusign-grade-signing-not-legally-qualified.md) (how the seal is made and trusted) and keeps [ADR 0017](0017-the-documental-record-names-everyone-who-acted.md) (who the record names).

ADR 0003 asked for a PDF sealed with Rabaed's own certificate, a trusted timestamp, a verification QR and a signing trail, and left open how the PDF is made, which certificate seals it, and what the record is made from. The product owner wants a record that nobody can change without it showing, matching the designer's sample records (MAR, DAR, DAS), and nothing that costs money yet.

We decided:

- **Record Data first.** When an item closes, the backend writes its **Record Data**: one XML file holding everything the record prints (the fields, each Transition on the path with the Member's name, Position and Company, its time and content hash, every Document's name and fingerprint, the outcome). The PDF is made **only** from it, and it never changes. It holds nothing the PDF doesn't print, since anyone holding the PDF can open it.
- **PDF/A-3, carrying the Record Data.** The record is a PDF/A-3 file (archival: fonts inside, nothing external) with the Record Data XML attached inside it, as KSA e-invoices carry their XML. Other files that can't be pages (DWG, Excel, ZIP) are attached inside too, up to 100 MB in all; above that they are listed with their fingerprints and stay in Rabaed.
- **Sealed, with no paid certificate for now.** The PDF is sealed with PAdES B-LT, signed by a key held in AWS KMS under Rabaed's own certificate, with a timestamp from a free public RFC 3161 service. Any change breaks the seal in Adobe Reader. Adobe shows the signer's identity as unverified until a reader trusts Rabaed's certificate; the public verification page is where a record is checked. Buying a certificate Adobe trusts (AATL) is a later purchase, not a redesign; a legally qualified KSA signature stays deferred (ADR 0003).
- **Made by the backend.** A worker renders the one Rabaed layout from the Record Data with headless Chromium (Arabic shaping, mixed RTL and LTR, the Thmanyah fonts, for which the product owner has consent), converts it to PDF/A-3, checks it and seals it. Each record keeps one location, name and URL.
- **Checked before anyone can download it.** Every new PDF must open, carry a valid seal, validate as PDF/A-3, show every signer's Signature and count its pages; a failure alerts in Rabaed Admin instead of publishing.
- **Re-produce, never reseal the item.** If the PDF maker had a bug, a Rabaed Engineer re-produces the affected records from the same Record Data, at the same location, name and URL, with a new seal date. The item and its Transitions are never reopened; the faulty copy is kept in admin-only history and its verification page says it was replaced.
- **Signature and Stamp are both required to act.** A Member can't take any Transition without a saved Signature, nor while their Company has no Stamp, since a paper submittal without the Company's stamp isn't processed either.
- **Review duration is information, not an SLA.** A Form may show, on the record, the days from the Submission Date to the reply. Rabaed still shows no due dates or deadlines.

## Considered Options

- **A JavaScript PDF library (pdfkit, pdfmake, react-pdf).** Rejected: Arabic shaping and bidirectional text are weak.
- **WeasyPrint, Typst or LaTeX.** Rejected: a second runtime or template language that can't share the web's markup.
- **Rendering straight from the database at close, with no Record Data.** Rejected: a corrected PDF could never be shown to come from the same facts.
- **A certificate Adobe trusts, from the start.** Deferred: it costs money; it changes only the certificate, not the design.
- **Several PDF Templates per Form, including customers' paper-matching layouts.** Rejected: one Rabaed layout for every record; the Form's fields are what differ between an MAR and a SAR.
- **Distribution Lists with expiring links to emails outside Rabaed.** Rejected: the record reaches people through the ordinary notifications, inside Rabaed.

## Consequences

- RP-529 is settled by this ADR: the same backend makes the watermarked Working Copy of an unfinished item, unsealed and naming Companies only.
- The Project files bucket must let the worker read Documents and write records (today only the api task role may).
- The content hash gains each Document's own file fingerprint, taken at upload.
- The Company profile gains a logo and a Stamp; the Member profile's Signature can be drawn, typed or uploaded.
