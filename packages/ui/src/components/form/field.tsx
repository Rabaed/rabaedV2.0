"use client";

import { createContext, useContext, useId, type AriaAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon } from "../icon/icon.tsx";

type FieldContextValue = {
  /** The control's id, which the label points at. */
  id: string;
  labelId: string;
  /** Help and error ids, for `aria-describedby`. */
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** Props a control takes from its Field, merged under its own. */
export type FieldControlProps = {
  id?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
  "aria-labelledby"?: string;
};

/**
 * Wires a control to its Field: id (so the label names it), description (help
 * and error), invalid, required, disabled and read-only. The control's own
 * props win. Outside a Field it returns the props unchanged.
 */
export function useFieldControl<P extends FieldControlProps>(props: P) {
  const field = useContext(FieldContext);
  if (!field) {
    return { ...props, required: !!props.required, disabled: !!props.disabled, readOnly: !!props.readOnly, labelId: undefined };
  }
  const invalid = props["aria-invalid"] ?? (field.invalid || undefined);
  return {
    ...props,
    id: props.id ?? field.id,
    required: props.required ?? field.required,
    disabled: props.disabled ?? field.disabled,
    readOnly: props.readOnly ?? field.readOnly,
    "aria-describedby": [field.describedBy, props["aria-describedby"]].filter(Boolean).join(" ") || undefined,
    "aria-invalid": invalid,
    labelId: field.labelId,
  };
}

export type FieldProps = {
  label: ReactNode;
  /** A hint shown under the control and read with it. */
  help?: ReactNode;
  /** An error message; marks the control invalid and is read with it. */
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /**
   * `stacked` (default): label above, for inputs, textareas, selects and groups.
   * `inline`: control then label on one line, for a checkbox or switch.
   */
  layout?: "stacked" | "inline";
  /** For a RadioGroup or SegmentedControl: the label names the group (via `aria-labelledby`) rather than one control. */
  group?: boolean;
  /** The control's id; generated when omitted. */
  id?: string;
  className?: string;
  children: ReactNode;
};

/**
 * A labelled form field: label, optional help text, required marker and error
 * message, all programmatically tied to the one control inside it.
 */
export function Field({
  label,
  help,
  error,
  required = false,
  disabled = false,
  readOnly = false,
  layout = "stacked",
  group = false,
  id: idProp,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const id = idProp ?? `field${generated.replaceAll(":", "")}`;
  const labelId = `${id}-label`;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const context: FieldContextValue = {
    id,
    labelId,
    describedBy: [helpId, errorId].filter(Boolean).join(" ") || undefined,
    invalid: !!error,
    required,
    disabled,
    readOnly,
  };

  const labelContent = (
    <>
      {label}
      {required && (
        // The control itself is marked required; the asterisk is visual only.
        <span aria-hidden="true" className="ms-0.5 text-danger">
          *
        </span>
      )}
    </>
  );
  const labelClass = cn("text-body font-medium text-text", disabled && "text-muted");
  const labelElement = group ? (
    <span id={labelId} className={labelClass}>
      {labelContent}
    </span>
  ) : (
    <label id={labelId} htmlFor={id} className={labelClass}>
      {labelContent}
    </label>
  );

  const messages = (help || error) && (
    <div className="flex flex-col gap-1">
      {help && (
        <p id={helpId} className="text-sm text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1 text-sm text-danger">
          <Icon name="alert-circle" size={16} className="mt-0.5" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );

  return (
    <FieldContext.Provider value={context}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        {layout === "inline" ? (
          <div className="flex items-center gap-2">
            {children}
            {labelElement}
          </div>
        ) : (
          <>
            {labelElement}
            {children}
          </>
        )}
        {messages}
      </div>
    </FieldContext.Provider>
  );
}
