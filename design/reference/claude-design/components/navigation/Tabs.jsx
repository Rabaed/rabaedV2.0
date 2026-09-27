import React from 'react';
import { Icon } from '../core/Icon.jsx';

/**
 * Project module tab bar — matches the SaaS shell (Overview → Settings).
 * 52px white bar, 28px gaps, muted labels; active tab is tomato 600 with a
 * 2.5px underline. Scrolls horizontally with the scrollbar hidden. RTL-aware
 * via logical properties (inherits `dir` from the page).
 */
export function Tabs({ items = [], value, onChange = () => {}, style = {} }) {
  const [hover, setHover] = React.useState(null);
  return (
    <div
      role="tablist"
      className="rb-tabs"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 28,
        height: 52,
        paddingInline: 28,
        background: 'var(--ui-surface)',
        borderBottom: '1px solid var(--ui-border-2)',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        ...style,
      }}
    >
      {items.map((it) => {
        const key = it.value ?? it.label;
        const active = key === value;
        const hov = hover === key && !active;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            onMouseEnter={() => setHover(key)}
            onMouseLeave={() => setHover(null)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: 0,
              height: '100%',
              background: 'transparent',
              border: 'none',
              borderBottom: `2.5px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 14.5,
              fontWeight: active ? 600 : 500,
              color: active ? 'var(--color-primary)' : hov ? 'var(--ui-text)' : 'var(--ui-muted)',
              transition: 'color var(--dur-fast)',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            {it.icon && <Icon name={it.icon} size={18} />}
            {it.label}
            {it.count != null && (
              <span style={{
                fontFamily: 'var(--font-ui)', fontSize: 11.5, fontWeight: 600,
                padding: '1px 8px', borderRadius: 20,
                background: active ? 'var(--tone-tomato-tint)' : 'var(--tone-gray-tint)',
                color: active ? 'var(--tone-tomato-fg)' : 'var(--ui-muted)',
              }}>{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
