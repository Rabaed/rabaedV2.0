import * as React from 'react';

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Discipline (tinted) or document type (neutral outline lozenge). @default 'CV' */
  code?: 'CV' | 'AR' | 'EL' | 'ME' | 'SU' | 'MAR' | 'SAR' | 'DAR' | 'DAS' | 'NPD';
  /** Override the discipline label. */
  label?: string;
  /** Discipline: "Label (CODE)" vs just CODE. @default true */
  showLabel?: boolean;
  /** Label language for disciplines. @default 'en' */
  lang?: 'en' | 'ar';
}

/** Tonal discipline chip or neutral document-type lozenge. */
export function Tag(props: TagProps): React.ReactElement;
export default Tag;
