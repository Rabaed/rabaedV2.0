// A Signature card as the Documental Record prints it (RP-650, apps/worker/src/record/layout.ts):
// a bordered card holding the person (name, Positions, Company, when) beside the Signature on its
// ruled line, captioned "Signature". The record is a PDF made from its own HTML, so this repeats its
// look in the app's tokens: the same parts in the same order, the same proportions (the person and
// a 48 mm Signature box). Presentational.

export type SignatureCardLabels = {
  /** Names the card, e.g. "How it looks on a record". */
  title: string;
  /** The caption under the Signature, and its image's name, e.g. "Signature". */
  signature: string;
};

export type SignatureCardPerson = {
  name: string;
  /** The Member's Positions, one line each. */
  positions: string[];
  company: string;
  /** Today's date, already worded in the Member's language (Latin digits). */
  date: string;
};

export function SignatureCard({ labels, person, imageUrl }: { labels: SignatureCardLabels; person: SignatureCardPerson; imageUrl: string | null }) {
  return (
    <div role="group" aria-label={labels.title} className="grid max-w-[600px] grid-cols-[1fr_minmax(0,11rem)] items-start gap-4 rounded-md border border-control-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <div className="font-bold">{person.name}</div>
        {person.positions.map((position) => (
          <div key={position} className="text-xs text-muted">
            {position}
          </div>
        ))}
        <div className="text-xs text-muted">{person.company}</div>
        <div className="text-xs text-muted">{person.date}</div>
      </div>
      <div className="flex min-h-[4.5rem] flex-col justify-end border-b border-text text-center">
        {/* The Member's own drawing, a typed canvas or an upload held in the page: a data URL, not a static asset. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made in the editor */}
        {imageUrl && <img src={imageUrl} alt={labels.signature} className="mx-auto block max-h-16 max-w-full object-contain" />}
        <div className="text-xs text-muted">{labels.signature}</div>
      </div>
    </div>
  );
}
