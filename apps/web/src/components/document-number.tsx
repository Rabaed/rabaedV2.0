import { cn } from "@/lib/utils";

/**
 * A Document Number (e.g. TWR-MAR-0000001). Always left-to-right and isolated
 * from the surrounding text, so it reads the same inside Arabic sentences.
 */
export function DocumentNumber({ value, className }: { value: string; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("docno", className)}>
      {value}
    </bdi>
  );
}
