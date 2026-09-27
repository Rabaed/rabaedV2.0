import React from 'react';

/**
 * Workflow tag — Tonal tints.
 * Disciplines (CV · AR · EL · ME · SU) are tinted chips, one distinct hue each,
 * shown as "Label (CODE)". Document types (MAR · SAR · DAR · DAS · NPD) are
 * neutral outline lozenges — never coloured, so they don't compete with trade.
 * Pass `lang="ar"` for Arabic labels.
 */
const DISC = {
  CV: { h: 'amber',  en: 'Civil Works',        ar: 'أعمال مدنية' },
  AR: { h: 'violet', en: 'Architecture',       ar: 'أعمال معمارية' },
  EL: { h: 'cyan',   en: 'Electrical Works',   ar: 'أعمال كهربائية' },
  ME: { h: 'green',  en: 'Mechanical Works',   ar: 'أعمال ميكانيكية' },
  SU: { h: 'orange', en: 'Surveying',          ar: 'أعمال المساحة' },
};
const DOCS = ['MAR', 'SAR', 'DAR', 'DAS', 'NPD'];

export function Tag({ code = 'CV', label, showLabel = true, lang = 'en', style = {}, ...rest }) {
  if (DOCS.includes(code) || !DISC[code]) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', height: 'var(--lozenge-h)', padding: '0 6px',
        borderRadius: 'var(--lozenge-r)', boxShadow: 'inset 0 0 0 1px var(--doctype-ring)', color: 'var(--doctype-fg)',
        fontFamily: 'var(--font-ui)', fontSize: 10.5, fontWeight: 700, letterSpacing: '.03em', lineHeight: 1, whiteSpace: 'nowrap', ...style,
      }} {...rest}>{code}</span>
    );
  }
  const d = DISC[code];
  const text = showLabel ? `${label ?? d[lang] ?? d.en} (${code})` : code;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 'var(--chip-h)', padding: '0 var(--chip-px)',
      borderRadius: 'var(--chip-r)', background: `var(--tone-${d.h}-tint)`, color: `var(--tone-${d.h}-fg)`,
      fontFamily: 'inherit', fontSize: 'var(--chip-fs)', fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap', ...style,
    }} {...rest}>{text}</span>
  );
}

export default Tag;
