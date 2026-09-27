import React from 'react';

/**
 * Status badge — Tonal tints. Tint background + strong text, optional dot,
 * 24px · r7 · 12/600. `solid` for final states (Code A / D, Closed).
 * Tones map onto the shared --tone-* hue set.
 */
const HUE = { brand: 'tomato', success: 'green', danger: 'red', warning: 'amber', info: 'blue', pending: 'violet', neutral: 'gray', accent: 'amber', cyan: 'cyan', orange: 'orange' };

export function Badge({ children, tone = 'neutral', variant = 'soft', dot = false, style = {}, ...rest }) {
  const h = HUE[tone] || tone;
  const solid = variant === 'solid';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        height: 'var(--chip-h)', padding: '0 var(--chip-px)', borderRadius: 'var(--chip-r)',
        background: solid ? `var(--tone-${h}-solid)` : `var(--tone-${h}-tint)`,
        color: solid ? '#fff' : `var(--tone-${h}-fg)`,
        fontFamily: 'inherit', fontSize: 'var(--chip-fs)', fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: solid ? '#fff' : `var(--tone-${h}-solid)` }} />}
      {children}
    </span>
  );
}

export default Badge;
