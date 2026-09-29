"use client";

import { Button, Checkbox, Field, Select } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Link, useRouter } from "@/i18n/navigation";

type Person = { id: string; name: string };
type Position = { key: string; name: string };

/**
 * A Participant's Project Members and their Positions. `candidates` (the
 * Company's Members not yet on the Project) is given only to the Authorized
 * Person, who alone adds, removes and gives Positions.
 */
export function ProjectMembersEditor({
  participantId,
  members,
  positions,
  candidates,
}: {
  participantId: string;
  members: (Person & { email: string; positions: string[] })[];
  positions: Position[];
  candidates: Person[] | null;
}) {
  const t = useTranslations("participants");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const canManage = candidates !== null;

  async function send(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown) {
    setPending(true);
    setError(false);
    try {
      const res = await fetch(`/api/v1/participants/${participantId}/members${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) return setError(true);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const memberId = new FormData(event.currentTarget).get("memberId");
    if (memberId) void send("POST", "", { memberId });
  }

  function togglePosition(member: Person & { positions: string[] }, key: string, on: boolean) {
    const next = on ? [...member.positions, key] : member.positions.filter((p) => p !== key);
    void send("PUT", `/${member.id}/positions`, { positions: next });
  }

  function remove(member: Person) {
    if (window.confirm(t("confirmRemove", { name: member.name }))) void send("DELETE", `/${member.id}`);
  }

  return (
    <div className="space-y-6">
      {members.length === 0 ? (
        <p className="text-muted">{t("noMembers")}</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border" data-testid="project-members">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
              <span className="space-y-1">
                <span className="block">
                  <span className="font-medium">{m.name}</span>{" "}
                  <bdi dir="ltr" className="text-muted">
                    {m.email}
                  </bdi>
                </span>
                {canManage ? (
                  <fieldset className="flex flex-wrap gap-4 text-sm">
                    <legend className="sr-only">{t("positions")}</legend>
                    {positions.map((p) => (
                      <Field key={p.key} label={p.name} layout="inline" disabled={pending}>
                        <Checkbox
                          checked={m.positions.includes(p.key)}
                          onCheckedChange={(checked) => togglePosition(m, p.key, checked === true)}
                        />
                      </Field>
                    ))}
                  </fieldset>
                ) : (
                  <span className="block text-sm text-muted">
                    {positions
                      .filter((p) => m.positions.includes(p.key))
                      .map((p) => p.name)
                      .join(" · ")}
                  </span>
                )}
              </span>
              {canManage && (
                <span className="flex items-center gap-2">
                  <Link
                    href={`/participants/${participantId}/members/${m.id}/visibility`}
                    className="text-sm text-primary underline underline-offset-4"
                  >
                    {t("visibility")}
                  </Link>
                  <Button variant="ghost" size="sm" className="text-danger" disabled={pending} onClick={() => remove(m)}>
                    {t("remove")}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && candidates.length > 0 && (
        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-4">
          <Field label={t("addMember")} id="project-member" className="min-w-60 flex-1">
            {/* Keyed by the candidates, so it starts again on the first one after an add. */}
            <Select
              key={candidates.map((c) => c.id).join()}
              name="memberId"
              defaultValue={candidates[0]?.id}
              options={candidates.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {t("add")}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {t("unavailable")}
        </p>
      )}
    </div>
  );
}
