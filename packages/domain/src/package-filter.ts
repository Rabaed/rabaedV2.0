import { z } from "zod";
import type { BilingualText } from "./company.ts";
import type { Locale } from "./locale.ts";
import type { PackageSummary, PackageTrade } from "./package.ts";
import { matchesSearch } from "./search-match.ts";

// The Packages view's search and filters (RP-953; design/prompts/packages.md "1. Packages
// view"): a search over the PKG number and the name in both languages, and filters by Trade
// and by owning Company. They apply to the Packages the board API gives the viewer, and their
// choices come from those Packages only (packageFilterChoices): the Trades of the submittals
// the viewer sees in them and their owning Companies, so no choice names a Trade or a Company
// the viewer sees nothing of (visibility.md RP-953-1; RP-588-1 to RP-588-3 still hold).

/** What the Packages view is narrowed to. A Trade or Company list matches any of its values; the three together, all of them. */
export type PackagesFilter = {
  q?: string;
  /** Trades, by dimension value id. */
  trade: string[];
  /** Owning Companies, by their Participant's id. */
  company: string[];
};

/** The owning Companies the view offers, by Participant, each with its Company name only (V14). */
export type PackageCompanyChoice = { participantId: string; companyName: BilingualText };

/** The Packages that match `filter`, in their order. */
export function filterPackages(packages: readonly PackageSummary[], filter: PackagesFilter): PackageSummary[] {
  return packages.filter(
    (p) =>
      matchesSearch(filter.q, [p.number, p.name.en, p.name.ar]) &&
      (filter.trade.length === 0 || p.trades.some((t) => filter.trade.includes(t.id))) &&
      (filter.company.length === 0 || filter.company.includes(p.owner.participantId)),
  );
}

/** The filter's choices, from `packages` alone, each once: their Trades by code (across Packages, so not each one's Project order), their owning Companies by name in `locale`. */
export function packageFilterChoices(packages: readonly PackageSummary[], locale: Locale): { trades: PackageTrade[]; companies: PackageCompanyChoice[] } {
  const trades = new Map<string, PackageTrade>();
  const companies = new Map<string, PackageCompanyChoice>();
  for (const p of packages) {
    for (const t of p.trades) trades.set(t.id, t);
    companies.set(p.owner.participantId, p.owner);
  }
  return {
    trades: [...trades.values()].sort((a, b) => a.code.localeCompare(b.code, "en") || a.id.localeCompare(b.id)),
    companies: [...companies.values()].sort(
      (a, b) => a.companyName[locale].localeCompare(b.companyName[locale], locale) || a.participantId.localeCompare(b.participantId),
    ),
  };
}

const ids = (raw: string | undefined) => (raw ?? "").split(",").filter((v) => z.uuid().safeParse(v).success);

/** The filter a Packages view URL holds; a value that isn't an id is left out, so an old or edited link still opens. */
export function packagesFilterFromSearchParams(params: URLSearchParams | Record<string, string | string[] | undefined>): PackagesFilter {
  const get = (key: string) => (params instanceof URLSearchParams ? (params.get(key) ?? undefined) : [params[key]].flat()[0]);
  const q = get("q")?.trim();
  return { ...(q ? { q } : {}), trade: ids(get("trade")), company: ids(get("company")) };
}

/** The Packages view's URL query for `filter`, with `view=packages`. */
export function packagesFilterSearchParams(filter: PackagesFilter): URLSearchParams {
  const params = new URLSearchParams({ view: "packages" });
  if (filter.q) params.set("q", filter.q);
  if (filter.trade.length > 0) params.set("trade", filter.trade.join(","));
  if (filter.company.length > 0) params.set("company", filter.company.join(","));
  return params;
}
