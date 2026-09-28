"use client";

import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Label } from "@/components/ui/label";
import { Link, useRouter } from "@/i18n/navigation";

type Person = { id: string; name: string };

/**
 * A Participant's Project Members. `candidates` (the Company's Members not yet on
 * the Project) is given only to the Authorized Person, who alone adds and removes.
 */
export function ProjectMembersEditor({
  participantId,
  members,
  candidates,
}: {
  participantId: string;
  members: (Person & { email: string })[];
  candidates: Person[] | null;
}) {
  const t = useTranslations("participants");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const canManage = candidates !== null;

  async function send(method: "POST" | "DELETE", path: string, body?: unknown) {
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
              <span>
                <span className="font-medium">{m.name}</span>{" "}
                <bdi dir="ltr" className="text-muted">
                  {m.email}
                </bdi>
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
          <div className="min-w-60 flex-1 space-y-2">
            <Label htmlFor="project-member">{t("addMember")}</Label>
            <select
              id="project-member"
              name="memberId"
              className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-sm"
            >
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
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
