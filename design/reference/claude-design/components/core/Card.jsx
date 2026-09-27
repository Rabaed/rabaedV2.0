import React from 'react';

/** Surface container — white card with hairline border + soft shadow. */
export function Card({ children, padding = 20, interactive = false, elevation = 'sm', style = {}, ...rest }) {
  const shadows = { none: 'none', xs: 'var(--shadow-xs)', sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)' };
  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        boxShadow: shadows[elevation] || shadows.sm,
        padding,
        transition: interactive ? 'box-shadow var(--dur-base), transform var(--dur-base)' : 'none',
        cursor: interactive ? 'pointer' : 'default',
        ...style,
      }}
      onMouseEnter={interactive ? (e) => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; } : undefined}
      onMouseLeave={interactive ? (e) => { e.currentTarget.style.boxShadow = shadows[elevation] || shadows.sm; e.currentTarget.style.transform = 'translateY(0)'; } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Card;
