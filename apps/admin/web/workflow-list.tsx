"use client";

import type { AdminWorkflowSummary, Locale } from "@rabaed/domain";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rabaed/ui";
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { message } from "./messages.ts";
import { strings } from "./strings.ts";

/** The Rabaed Default Workflows, one row per Work Item Type, with their published Versions. */
export function WorkflowList({ locale }: { locale: Locale }) {
  const s = strings(locale);
  const [types, setTypes] = useState<AdminWorkflowSummary[] | "failed" | null>(null);
  useEffect(() => {
    api<{ types: AdminWorkflowSummary[] }>("GET", "/v1/workflows").then(
      (r) => setTypes(r.types),
      () => setTypes("failed"),
    );
  }, []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{s.workflows}</h1>
      <p className="max-w-3xl text-muted">{s.listIntro}</p>
      {types === null && <p className="text-muted">{s.loading}</p>}
      {types === "failed" && <p role="alert">{s.loadFailed}</p>}
      {Array.isArray(types) && (
        <Table label={s.listName}>
          <TableHeader>
            <TableRow>
              <TableHead>{s.colType}</TableHead>
              <TableHead>{s.colName}</TableHead>
              <TableHead>{s.colModule}</TableHead>
              <TableHead>{s.colVersions}</TableHead>
              <TableHead>{s.colDraft}</TableHead>
              <TableHead>
                <span className="sr-only">{s.open}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((type) => (
              <TableRow key={type.code}>
                <TableCell>
                  <span dir="ltr" className="font-semibold">
                    {type.code}
                  </span>
                </TableCell>
                <TableCell>{type.name[locale]}</TableCell>
                <TableCell>{message(locale, `projectTabs.${type.moduleKey}`)}</TableCell>
                <TableCell>
                  {type.publishedVersions.length === 0 ? (
                    <span className="text-muted">{s.noVersions}</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {type.publishedVersions.map((v) => (
                        <Badge key={v} tone={v === Math.max(...type.publishedVersions) ? "brand" : "neutral"}>
                          <span dir="ltr">{s.version(v)}</span>
                        </Badge>
                      ))}
                    </span>
                  )}
                </TableCell>
                <TableCell>{type.hasDraft ? <Badge tone="warning">{s.draftWaiting}</Badge> : <span className="text-muted">{s.noDraft}</span>}</TableCell>
                <TableCell>
                  <a href={`#/${encodeURIComponent(type.code)}`} className="text-brand underline">
                    {s.open}
                    <span className="sr-only"> {type.code}</span>
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
