import { Badge, Icon } from "@rabaed/ui";
import { Link } from "@/i18n/navigation";

/**
 * Where an import page sits (RP-1144; the kit's import-register.html › `.ir-crumb`): Submittals ›
 * Imports › … Every part but the last links back; the last is the page itself.
 */
export function RegisterImportCrumbs({ label, parts }: { label: string; parts: { text: string; href?: string }[] }) {
  return (
    <nav aria-label={label} className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
      {parts.map((part, index) => (
        <span key={index} className="flex min-w-0 items-center gap-2">
          {index > 0 && <Icon name="chevron-right" size={14} className="shrink-0" />}
          {part.href ? (
            <Link href={part.href} className="hover:text-text hover:underline">
              {part.text}
            </Link>
          ) : (
            <bdi aria-current="page" className="truncate font-semibold text-text">
              {part.text}
            </bdi>
          )}
        </span>
      ))}
    </nav>
  );
}

/** A Package an import created ("New") or added to ("Used"), as the kit marks it (imp/imports.js › pkCells). */
export function PackageUseBadge({ created, label }: { created: boolean; label: string }) {
  return <Badge tone={created ? "success" : "info"}>{label}</Badge>;
}
