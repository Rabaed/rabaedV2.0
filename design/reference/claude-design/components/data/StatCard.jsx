import React from 'react';
import { Icon } from '../core/Icon.jsx';

/**
 * KPI / metric tile — white card on the board canvas, tonal icon tile,
 * Plex tabular value, optional trend pill. Colour lives only in the icon
 * (Tonal tint hue set) so dashboards stay calm and tomato stays the brand.
 * Legacy pastel names map to tones: lavender→violet, mint→green,
 * blush→tomato, butter→amber, sky→blue, slate→gray.
 */
const LEGACY = { lavender: 'violet', mint: 'green', blush: 'tomato', butter: 'amber', sky: 'blue', slate: 'gray' };

export function StatCard({ label, value, sublabel, icon = 'chart-bar', tint = 'tomato', trend, style = {}, ...rest }) {
  const h = LEGACY[tint] || tint;
  const up = trend && trend.dir !== 'down';
  const good = trend && (trend.good ?? up);
  return (
    <div
      style={{
        background: 'var(--ui-surface)', border: '1px solid var(--ui-border)', borderRadius: 16,
        padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 190,
        fontFamily: 'inherit', ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 40, height: 40, flex: 'none', borderRadius: 11,
          background: `var(--tone-${h}-tint)`, color: `var(--tone-${h}-solid)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={icon} size={20} />
        </span>
        {trend && (
          <span style={{
            marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3,
            height: 22, padding: '0 7px', borderRadius: 6, fontFamily: 'var(--font-ui)', fontSize: 11.5, fontWeight: 600,
            background: good ? 'var(--tone-green-tint)' : 'var(--tone-red-tint)', color: good ? 'var(--tone-green-fg)' : 'var(--tone-red-fg)',
          }}>
            <Icon name={up ? 'arrow-up' : 'arrow-down'} size={13} />{trend.value}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 28, fontWeight: 700, color: 'var(--ui-text)', lineHeight: 1, letterSpacing: '-.01em', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ui-text-2)' }}>{label}</span>
        {sublabel && <span style={{ fontSize: 12, color: 'var(--ui-faint)' }}>{sublabel}</span>}
      </div>
    </div>
  );
}

export default StatCard;
