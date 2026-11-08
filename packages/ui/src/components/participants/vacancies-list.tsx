import { stepAgeWeeks, type Locale, type ProjectVacancies } from "@rabaed/domain";
import type { ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { PoolMark, vacancyIcon } from "../views/kanban-card.tsx";

export type VacanciesListLabels = {
  /** One line under the title: what a Vacancy is. */
  description: string;
  /** "Waiting for a new Consultant". */
  waitingFor: (role: string) => string;
  /** An item the Admin doesn't see, by its Step and the Project only: "An item at Consultant review on Riyadh Gate Tower". */
  hiddenItem: (step: string, project: string) => string;
  /** In place of a Document Number the item has none of yet. */
  noNumber: string;
  /** When there is none. */
  empty: string;
};

export type VacanciesListProps = {
  vacancies: ProjectVacancies["vacancies"];
  projectName: string;
  /** Step Age is counted to this moment. */
  now: Date;
  locale: Locale;
  labels: VacanciesListLabels;
  /** An item's page. */
  hrefFor: (itemId: string) => string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/**
 * The Project's Vacancies, for the Host Company's Project Admin (RP-952, ADR 0028): each Step a
 * withdrawn Participant held on another Company's item, the role it waits for ("Waiting for a new
 * ‹role›"), and how long, in Step Age dots from when it became a Vacancy (no date, never "overdue").
 * An item the Admin sees is named and linked; one they don't is only its Step and the Project
 * (the owner's Q3, scenario RP-952-6): never its number, Subject or a Company.
 */
export function VacanciesList({ vacancies, projectName, now, locale, labels, hrefFor, linkAs: Link = "a" }: VacanciesListProps) {
  if (vacancies.length === 0) return <p className="text-sm text-muted">{labels.empty}</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{labels.description}</p>
      <ul className="max-h-[480px] divide-y divide-border-subtle overflow-y-auto rounded-md border border-border" data-testid="vacancies">
        {vacancies.map((v) => {
          const step = v.step.name[locale];
          return (
            <li key={v.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 space-y-1">
                {v.item ? (
                  <Link href={hrefFor(v.item.id)} className={cn("block min-w-0 rounded-sm text-sm hover:underline", focusRing)}>
                    {v.item.documentNumber ? <DocNo value={v.item.documentNumber} className="font-semibold" /> : <span className="text-muted">{labels.noNumber}</span>}
                    <span className="text-text-secondary"> · {v.item.title}</span>
                  </Link>
                ) : (
                  <p className="text-sm text-text-secondary">{labels.hiddenItem(step, projectName)}</p>
                )}
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {v.item && <span className="font-semibold">{step}</span>}
                  {v.item && <span aria-hidden="true" className="text-faint">·</span>}
                  <span className="flex items-center gap-2 text-text-secondary">
                    <PoolMark icon={vacancyIcon} />
                    {labels.waitingFor(v.projectRole.name[locale])}
                  </span>
                </p>
              </div>
              <AgeDots weeks={stepAgeWeeks(new Date(v.vacantSince), now)} locale={locale} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
