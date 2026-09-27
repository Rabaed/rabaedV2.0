import React from 'react';

/** User avatar — image or auto-coloured initials, with optional status dot. */
const PALETTE = [
  ['var(--tomato-100)', 'var(--tomato-700)'],
  ['var(--delft-100)', 'var(--delft-600)'],
  ['var(--naples-100)', 'var(--naples-800)'],
  ['var(--success-100)', 'var(--success-700)'],
  ['var(--tone-blue-tint)', 'var(--tone-blue-fg)'],
  ['var(--chip-ar-bg)', 'var(--chip-ar-fg)'],
];

function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export function Avatar({ name = '', src = null, size = 40, status = null, ring = false, style = {}, ...rest }) {
  const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length;
  const [bg, fg] = PALETTE[idx];
  const statusColors = { online: 'var(--success-600)', busy: 'var(--danger-600)', away: 'var(--naples-500)', offline: 'var(--gray-500)' };
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flex: 'none', ...style }} {...rest}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: src ? 'var(--gray-100)' : bg,
          color: fg,
          fontFamily: 'var(--font-ui)',
          fontWeight: 'var(--fw-semibold)',
          fontSize: Math.max(11, Math.round(size * 0.38)),
          border: ring ? '2px solid var(--surface-card)' : 'none',
          boxShadow: ring ? '0 0 0 2px var(--color-primary)' : 'none',
        }}
      >
        {src ? <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(name)}
      </span>
      {status && (
        <span
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: Math.round(size * 0.28),
            height: Math.round(size * 0.28),
            borderRadius: '50%',
            background: statusColors[status] || statusColors.offline,
            border: '2px solid var(--surface-card)',
          }}
        />
      )}
    </span>
  );
}

export default Avatar;
