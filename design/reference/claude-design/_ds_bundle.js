/* @ds-bundle: {"format":4,"namespace":"RabaedDesignSystem_a8093d","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"StatCard","sourcePath":"components/data/StatCard.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Segmented","sourcePath":"components/forms/Segmented.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"bdd84d2f9d63","components/core/Badge.jsx":"54aae74d22c4","components/core/Button.jsx":"33afd49317a4","components/core/Card.jsx":"0794ef98edda","components/core/Icon.jsx":"51312f3a58d0","components/core/IconButton.jsx":"48b697657c17","components/core/Tag.jsx":"7852b29211fe","components/data/StatCard.jsx":"6c2577aea834","components/forms/Checkbox.jsx":"ca7fd469c78b","components/forms/Input.jsx":"146e199ac780","components/forms/Radio.jsx":"600e5b852718","components/forms/Segmented.jsx":"003b6d105284","components/forms/Select.jsx":"4e5aee06c5d3","components/forms/Switch.jsx":"00400e809bb2","components/navigation/Tabs.jsx":"ea8504a72d20","guidelines/filter-panel.js":"9adbebd645b3","guidelines/tweaks-panel.jsx":"d259e3a86f73","ui_kits/app/floor/data.js":"f9369f602628","ui_kits/app/floor/floor.js":"0cfe7ba37e78","ui_kits/app/list/filter-panel.js":"4ba8dd245dbd","ui_kits/app/list/kanban.js":"1eef258066ec","ui_kits/app/list/list.js":"f8e863e59312","ui_kits/app/map/data.js":"25ddc15111c9","ui_kits/app/map/map.js":"19b4318461bb","ui_kits/app/plan/data.js":"ef1fd3fce0a4","ui_kits/app/plan/mobile.js":"5a99f47967a2","ui_kits/app/plan/plan.js":"aa352167db64","ui_kits/app/reports/data.js":"73142e0590e0","ui_kits/app/reports/reports.js":"98b0861bb978","ui_kits/app/settings/numbering.js":"405de1f35c78","ui_kits/app/shell/pages.js":"1e98bc5409e0","ui_kits/app/shell/shell.js":"340eb78acb47","ui_kits/app/snag/data.js":"0951aa4c0183","ui_kits/app/snag/mobile.js":"232232eed40e","ui_kits/app/snag/snag.js":"979b5e0974a2","ui_kits/app/wf/data.js":"42e0432e1eac","ui_kits/app/wf/view.js":"b6c55b77fe3a","ui_kits/app/wf/wf.js":"bf8f46731be2"},"inlinedExternals":[],"unexposedExports":[{"name":"btnSizes","sourcePath":"components/core/Button.jsx"},{"name":"btnStyle","sourcePath":"components/core/Button.jsx"},{"name":"btnVariants","sourcePath":"components/core/Button.jsx"},{"name":"ensureSpinKeyframes","sourcePath":"components/core/Button.jsx"},{"name":"fieldBox","sourcePath":"components/forms/Input.jsx"},{"name":"fieldHelp","sourcePath":"components/forms/Input.jsx"},{"name":"fieldLabel","sourcePath":"components/forms/Input.jsx"},{"name":"useBtnState","sourcePath":"components/core/Button.jsx"},{"name":"useFieldState","sourcePath":"components/forms/Input.jsx"}]} */

(() => {

const __ds_ns = (window.RabaedDesignSystem_a8093d = window.RabaedDesignSystem_a8093d || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** User avatar — image or auto-coloured initials, with optional status dot. */
const PALETTE = [['var(--tomato-100)', 'var(--tomato-700)'], ['var(--delft-100)', 'var(--delft-600)'], ['var(--naples-100)', 'var(--naples-800)'], ['var(--success-100)', 'var(--success-700)'], ['var(--tone-blue-tint)', 'var(--tone-blue-fg)'], ['var(--chip-ar-bg)', 'var(--chip-ar-fg)']];
function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
function Avatar({
  name = '',
  src = null,
  size = 40,
  status = null,
  ring = false,
  style = {},
  ...rest
}) {
  const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length;
  const [bg, fg] = PALETTE[idx];
  const statusColors = {
    online: 'var(--success-600)',
    busy: 'var(--danger-600)',
    away: 'var(--naples-500)',
    offline: 'var(--gray-500)'
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: 'relative',
      display: 'inline-flex',
      flex: 'none',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
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
      boxShadow: ring ? '0 0 0 2px var(--color-primary)' : 'none'
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials(name)), status && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: Math.round(size * 0.28),
      height: Math.round(size * 0.28),
      borderRadius: '50%',
      background: statusColors[status] || statusColors.offline,
      border: '2px solid var(--surface-card)'
    }
  }));
}
Object.assign(__ds_scope, { Avatar, __ds_default_components_core_Avatar_4ed3sh: Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Status badge — Tonal tints. Tint background + strong text, optional dot,
 * 24px · r7 · 12/600. `solid` for final states (Code A / D, Closed).
 * Tones map onto the shared --tone-* hue set.
 */
const HUE = {
  brand: 'tomato',
  success: 'green',
  danger: 'red',
  warning: 'amber',
  info: 'blue',
  pending: 'violet',
  neutral: 'gray',
  accent: 'amber',
  cyan: 'cyan',
  orange: 'orange'
};
function Badge({
  children,
  tone = 'neutral',
  variant = 'soft',
  dot = false,
  style = {},
  ...rest
}) {
  const h = HUE[tone] || tone;
  const solid = variant === 'solid';
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      height: 'var(--chip-h)',
      padding: '0 var(--chip-px)',
      borderRadius: 'var(--chip-r)',
      background: solid ? `var(--tone-${h}-solid)` : `var(--tone-${h}-tint)`,
      color: solid ? '#fff' : `var(--tone-${h}-fg)`,
      fontFamily: 'inherit',
      fontSize: 'var(--chip-fs)',
      fontWeight: 600,
      lineHeight: 1,
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: solid ? '#fff' : `var(--tone-${h}-solid)`
    }
  }), children);
}
Object.assign(__ds_scope, { Badge, __ds_default_components_core_Badge_2ajn45: Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Rabaed Button — "Compact utility" direction.
 * 34px (md), radius 6, 13.5/600. Tomato primary, gray-fill secondary,
 * transparent tertiary, solid red danger. Blue focus ring (keyboard only).
 * States: default · hover · pressed · focus · loading · disabled.
 * Font inherits from the page, so Arabic (RTL) pages render in Thmanyah and
 * icon order mirrors automatically (logical flex order).
 */
const btnVariants = {
  primary: {
    bg: 'var(--btn-pri)',
    hov: 'var(--btn-pri-h)',
    prs: 'var(--btn-pri-p)',
    fg: 'var(--btn-pri-fg)',
    light: true
  },
  secondary: {
    bg: 'var(--btn-sec)',
    hov: 'var(--btn-sec-h)',
    prs: 'var(--btn-sec-p)',
    fg: 'var(--btn-sec-fg)'
  },
  tertiary: {
    bg: 'var(--btn-ter)',
    hov: 'var(--btn-ter-h)',
    prs: 'var(--btn-ter-p)',
    fg: 'var(--btn-ter-fg)',
    dis: 'transparent'
  },
  danger: {
    bg: 'var(--btn-dan)',
    hov: 'var(--btn-dan-h)',
    prs: 'var(--btn-dan-p)',
    fg: 'var(--btn-dan-fg)',
    light: true
  }
};
const ALIAS = {
  ghost: 'tertiary',
  subtle: 'secondary',
  outline: 'secondary'
};
const btnSizes = {
  sm: {
    h: 28,
    px: 10,
    fs: 12.5,
    gap: 5,
    ic: 15
  },
  md: {
    h: 34,
    px: 12,
    fs: 13.5,
    gap: 6,
    ic: 16
  },
  lg: {
    h: 40,
    px: 16,
    fs: 14,
    gap: 8,
    ic: 18
  }
};
function useBtnState(disabled) {
  const [st, set] = React.useState({
    h: false,
    p: false,
    f: false
  });
  const on = (k, v) => () => !disabled && set(s => ({
    ...s,
    [k]: v
  }));
  return [st, {
    onMouseEnter: on('h', true),
    onMouseLeave: () => set(s => ({
      ...s,
      h: false,
      p: false
    })),
    onMouseDown: on('p', true),
    onMouseUp: on('p', false),
    onFocus: e => set(s => ({
      ...s,
      f: e.currentTarget.matches(':focus-visible')
    })),
    onBlur: () => set(s => ({
      ...s,
      f: false
    }))
  }];
}
function btnStyle(variant, size, st, {
  disabled,
  loading,
  square
} = {}) {
  const v = btnVariants[ALIAS[variant] || variant] || btnVariants.primary;
  const s = btnSizes[size] || btnSizes.md;
  const bg = disabled ? v.dis ?? 'var(--btn-dis)' : st.p ? v.prs : st.h ? v.hov : v.bg;
  return {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s.gap,
    height: s.h,
    minWidth: square ? s.h : undefined,
    width: square ? s.h : undefined,
    padding: square ? 0 : `0 ${s.px}px`,
    border: 'none',
    outline: 'none',
    borderRadius: 6,
    fontFamily: 'inherit',
    fontSize: s.fs,
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    background: bg,
    color: loading ? 'transparent' : disabled ? 'var(--btn-dis-fg)' : v.fg,
    boxShadow: st.f && !disabled ? '0 0 0 2px var(--focus-offset), 0 0 0 4px var(--focus-ring)' : 'none',
    transform: st.p && !disabled ? 'scale(0.98)' : 'none',
    cursor: disabled ? 'not-allowed' : loading ? 'progress' : 'pointer',
    transition: 'background 120ms, box-shadow 120ms, transform 80ms',
    pointerEvents: loading ? 'none' : undefined
  };
}
function BtnSpinner({
  color,
  size = 15
}) {
  return /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      insetInlineStart: '50%',
      top: '50%',
      width: size,
      height: size,
      marginInlineStart: -size / 2,
      marginTop: -size / 2,
      borderRadius: '50%',
      border: `2px solid ${color}`,
      borderRightColor: 'transparent',
      animation: 'rb-spin 0.7s linear infinite'
    }
  });
}
let injected = false;
function ensureSpinKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.textContent = '@keyframes rb-spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(el);
}
function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft = null,
  iconRight = null,
  fullWidth = false,
  disabled = false,
  loading = false,
  type = 'button',
  style = {},
  ...rest
}) {
  ensureSpinKeyframes();
  const [st, handlers] = useBtnState(disabled || loading);
  const v = btnVariants[ALIAS[variant] || variant] || btnVariants.primary;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    "aria-busy": loading || undefined,
    "data-variant": variant
  }, handlers, {
    style: {
      ...btnStyle(variant, size, st, {
        disabled,
        loading
      }),
      ...(fullWidth ? {
        display: 'flex',
        width: '100%'
      } : {}),
      ...style
    }
  }, rest), loading && /*#__PURE__*/React.createElement(BtnSpinner, {
    color: v.light ? '#ffffff' : v.fg
  }), iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      opacity: loading ? 0 : 1
    }
  }, iconLeft), children != null && /*#__PURE__*/React.createElement("span", null, children), iconRight && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      opacity: loading ? 0 : 1
    }
  }, iconRight));
}
Object.assign(__ds_scope, { btnVariants, btnSizes, useBtnState, btnStyle, ensureSpinKeyframes, Button, __ds_default_components_core_Button_51d4zy: Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Surface container — white card with hairline border + soft shadow. */
function Card({
  children,
  padding = 20,
  interactive = false,
  elevation = 'sm',
  style = {},
  ...rest
}) {
  const shadows = {
    none: 'none',
    xs: 'var(--shadow-xs)',
    sm: 'var(--shadow-sm)',
    md: 'var(--shadow-md)',
    lg: 'var(--shadow-lg)'
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      boxShadow: shadows[elevation] || shadows.sm,
      padding,
      transition: interactive ? 'box-shadow var(--dur-base), transform var(--dur-base)' : 'none',
      cursor: interactive ? 'pointer' : 'default',
      ...style
    },
    onMouseEnter: interactive ? e => {
      e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      e.currentTarget.style.transform = 'translateY(-2px)';
    } : undefined,
    onMouseLeave: interactive ? e => {
      e.currentTarget.style.boxShadow = shadows[elevation] || shadows.sm;
      e.currentTarget.style.transform = 'translateY(0)';
    } : undefined
  }, rest), children);
}
Object.assign(__ds_scope, { Card, __ds_default_components_core_Card_pwdrbg: Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Rabaed icon. Wraps the Tabler icon webfont (the product's
 * Vuesax/Iconsax-linear look). Pass a semantic `name` — see the
 * NAMES map for the curated product set — or any raw Tabler id.
 */
const NAMES = {
  search: 'search',
  bell: 'bell',
  calendar: 'calendar',
  document: 'file-text',
  'document-download': 'file-download',
  folder: 'folder',
  trash: 'trash',
  edit: 'edit',
  eye: 'eye',
  'eye-off': 'eye-off',
  'chevron-down': 'chevron-down',
  'chevron-up': 'chevron-up',
  'chevron-right': 'chevron-right',
  'chevron-left': 'chevron-left',
  'arrow-up': 'arrow-up',
  'arrow-down': 'arrow-down',
  add: 'plus',
  close: 'x',
  settings: 'settings',
  filter: 'adjustments-horizontal',
  clipboard: 'clipboard-text',
  building: 'building',
  buildings: 'buildings',
  user: 'user',
  users: 'users',
  chart: 'chart-pie',
  'chart-bar': 'chart-bar',
  grid: 'category',
  check: 'circle-check',
  'check-square': 'square-check',
  logout: 'logout',
  info: 'info-circle',
  message: 'message',
  menu: 'menu-2',
  more: 'dots',
  'more-vertical': 'dots-vertical',
  refresh: 'refresh',
  clock: 'clock',
  bookmark: 'bookmark',
  download: 'download',
  upload: 'upload',
  link: 'external-link',
  home: 'home',
  flag: 'flag',
  star: 'star',
  warning: 'alert-triangle',
  sort: 'arrows-sort',
  print: 'printer',
  attach: 'paperclip',
  lock: 'lock'
};
function Icon({
  name = 'search',
  size = 20,
  color = 'currentColor',
  strokeWidth,
  style = {},
  ...rest
}) {
  const id = NAMES[name] || name;
  return /*#__PURE__*/React.createElement("i", _extends({
    className: `ti ti-${id}`,
    "aria-hidden": "true",
    style: {
      fontSize: size,
      lineHeight: 1,
      color,
      display: 'inline-flex',
      ...(strokeWidth ? {
        WebkitTextStroke: `${strokeWidth - 1}px currentColor`
      } : {}),
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Icon, __ds_default_components_core_Icon_pwifaz: Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Square icon-only button — same "Compact utility" look and states as Button. */
function IconButton({
  icon = 'more-vertical',
  variant = 'tertiary',
  size = 'md',
  label = 'action',
  active = false,
  disabled = false,
  style = {},
  ...rest
}) {
  const map = {
    solid: 'primary',
    soft: 'secondary',
    outline: 'secondary',
    ghost: 'tertiary'
  };
  const vv = map[variant] || variant;
  const [st, handlers] = __ds_scope.useBtnState(disabled);
  const s = __ds_scope.btnSizes[size] || __ds_scope.btnSizes.md;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    "aria-pressed": active || undefined,
    disabled: disabled
  }, handlers, {
    style: {
      ...__ds_scope.btnStyle(vv, size, {
        ...st,
        h: st.h || active
      }, {
        disabled,
        square: true
      }),
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: s.ic + 2
  }));
}
Object.assign(__ds_scope, { IconButton, __ds_default_components_core_IconButton_p7lntj: IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Workflow tag — Tonal tints.
 * Disciplines (CV · AR · EL · ME · SU) are tinted chips, one distinct hue each,
 * shown as "Label (CODE)". Document types (MAR · SAR · DAR · DAS · NPD) are
 * neutral outline lozenges — never coloured, so they don't compete with trade.
 * Pass `lang="ar"` for Arabic labels.
 */
const DISC = {
  CV: {
    h: 'amber',
    en: 'Civil Works',
    ar: 'أعمال مدنية'
  },
  AR: {
    h: 'violet',
    en: 'Architecture',
    ar: 'أعمال معمارية'
  },
  EL: {
    h: 'cyan',
    en: 'Electrical Works',
    ar: 'أعمال كهربائية'
  },
  ME: {
    h: 'green',
    en: 'Mechanical Works',
    ar: 'أعمال ميكانيكية'
  },
  SU: {
    h: 'orange',
    en: 'Surveying',
    ar: 'أعمال المساحة'
  }
};
const DOCS = ['MAR', 'SAR', 'DAR', 'DAS', 'NPD'];
function Tag({
  code = 'CV',
  label,
  showLabel = true,
  lang = 'en',
  style = {},
  ...rest
}) {
  if (DOCS.includes(code) || !DISC[code]) {
    return /*#__PURE__*/React.createElement("span", _extends({
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        height: 'var(--lozenge-h)',
        padding: '0 6px',
        borderRadius: 'var(--lozenge-r)',
        boxShadow: 'inset 0 0 0 1px var(--doctype-ring)',
        color: 'var(--doctype-fg)',
        fontFamily: 'var(--font-ui)',
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '.03em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style
      }
    }, rest), code);
  }
  const d = DISC[code];
  const text = showLabel ? `${label ?? d[lang] ?? d.en} (${code})` : code;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      height: 'var(--chip-h)',
      padding: '0 var(--chip-px)',
      borderRadius: 'var(--chip-r)',
      background: `var(--tone-${d.h}-tint)`,
      color: `var(--tone-${d.h}-fg)`,
      fontFamily: 'inherit',
      fontSize: 'var(--chip-fs)',
      fontWeight: 600,
      lineHeight: 1,
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), text);
}
Object.assign(__ds_scope, { Tag, __ds_default_components_core_Tag_1gfzecu: Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/data/StatCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * KPI / metric tile — white card on the board canvas, tonal icon tile,
 * Plex tabular value, optional trend pill. Colour lives only in the icon
 * (Tonal tint hue set) so dashboards stay calm and tomato stays the brand.
 * Legacy pastel names map to tones: lavender→violet, mint→green,
 * blush→tomato, butter→amber, sky→blue, slate→gray.
 */
const LEGACY = {
  lavender: 'violet',
  mint: 'green',
  blush: 'tomato',
  butter: 'amber',
  sky: 'blue',
  slate: 'gray'
};
function StatCard({
  label,
  value,
  sublabel,
  icon = 'chart-bar',
  tint = 'tomato',
  trend,
  style = {},
  ...rest
}) {
  const h = LEGACY[tint] || tint;
  const up = trend && trend.dir !== 'down';
  const good = trend && (trend.good ?? up);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--ui-surface)',
      border: '1px solid var(--ui-border)',
      borderRadius: 16,
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      minWidth: 190,
      fontFamily: 'inherit',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 40,
      height: 40,
      flex: 'none',
      borderRadius: 11,
      background: `var(--tone-${h}-tint)`,
      color: `var(--tone-${h}-solid)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 20
  })), trend && /*#__PURE__*/React.createElement("span", {
    style: {
      marginInlineStart: 'auto',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      height: 22,
      padding: '0 7px',
      borderRadius: 6,
      fontFamily: 'var(--font-ui)',
      fontSize: 11.5,
      fontWeight: 600,
      background: good ? 'var(--tone-green-tint)' : 'var(--tone-red-tint)',
      color: good ? 'var(--tone-green-fg)' : 'var(--tone-red-fg)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: up ? 'arrow-up' : 'arrow-down',
    size: 13
  }), trend.value)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-ui)',
      fontSize: 28,
      fontWeight: 700,
      color: 'var(--ui-text)',
      lineHeight: 1,
      letterSpacing: '-.01em',
      fontVariantNumeric: 'tabular-nums'
    }
  }, value), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      fontWeight: 500,
      color: 'var(--ui-text-2)'
    }
  }, label), sublabel && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--ui-faint)'
    }
  }, sublabel)));
}
Object.assign(__ds_scope, { StatCard, __ds_default_components_data_StatCard_4la461: StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
/** Checkbox — 16px, r4, tomato when checked. Supports indeterminate, disabled, keyboard focus ring. Surface-aware. */
function Checkbox({
  checked = false,
  indeterminate = false,
  onChange = () => {},
  label,
  disabled = false,
  size = 'md',
  style = {}
}) {
  const [f, setF] = React.useState(false);
  const px = size === 'lg' ? 18 : 16;
  const on = checked || indeterminate;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: 'inherit',
      fontSize: 13.5,
      color: disabled ? 'var(--fld-dis-txt)' : 'var(--fld-txt)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    onChange: e => onChange(e.target.checked, e),
    onFocus: e => setF(e.target.matches(':focus-visible')),
    onBlur: () => setF(false),
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: px,
      height: px,
      flex: 'none',
      borderRadius: size === 'lg' ? 5 : 4,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      background: disabled ? on ? 'var(--ctl-off)' : 'var(--fld-dis)' : on ? 'var(--ctl-on)' : 'var(--fld-bg)',
      boxShadow: (on && !disabled ? 'none' : `inset 0 0 0 1.5px ${disabled ? 'var(--fld-bd)' : 'var(--ctl-off)'}`) + (f ? ', 0 0 0 2px var(--ring-offset), 0 0 0 4px var(--fld-ring)' : ''),
      transition: 'background 120ms'
    }
  }, indeterminate ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "minus",
    size: 12
  }) : checked ? /*#__PURE__*/React.createElement("i", {
    className: "ti ti-check",
    style: {
      fontSize: 12,
      lineHeight: 1
    }
  }) : null), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox, __ds_default_components_forms_Checkbox_i1jt6f: Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Rabaed text field — three looks, one API:
 *  - outline (default): white field + 1px border. Tables, filters, toolbars.
 *  - filled: soft gray fill, no border (white + hairline on .surface-gray). Long forms.
 *  - inset: 48px, label inside the box. Create / edit wizards.
 * Surface-aware via tokens/forms.css (.surface-gray, .theme-dark).
 * States: hover · focus (blue ring) · error · success · disabled · read-only.
 */
function fieldBox({
  variant,
  st,
  error,
  success,
  disabled,
  readOnly,
  multiline,
  size,
  rows = 3
}) {
  const inset = variant === 'inset';
  const h = inset ? 'var(--fld-h-inset)' : size === 'sm' ? 'var(--fld-h-sm)' : 'var(--fld-h)';
  let bg = variant === 'filled' ? st.h ? 'var(--fld-fill-h)' : 'var(--fld-fill)' : 'var(--fld-bg)';
  let ring = variant === 'filled' ? 'var(--fld-fill-bd)' : st.h ? 'var(--fld-bd-h)' : 'var(--fld-bd)';
  let halo = null;
  if (st.f) {
    bg = 'var(--fld-bg)';
    ring = 'var(--fld-ring)';
    halo = 'var(--fld-ring-a)';
  }
  if (error) {
    ring = 'var(--fld-err)';
    if (st.f) halo = 'var(--fld-err-a)';
  }
  let shadow = `inset 0 0 0 1px ${ring}` + (halo ? `, 0 0 0 3px ${halo}` : '');
  if (variant === 'filled' && error && !st.f) shadow = `inset 0 -2px 0 var(--fld-err), inset 0 0 0 1px var(--fld-fill-bd)`;
  if (disabled) {
    bg = 'var(--fld-dis)';
    shadow = variant === 'filled' ? 'none' : 'inset 0 0 0 1px var(--fld-bd)';
  }
  if (readOnly) {
    bg = 'transparent';
    shadow = 'none';
  }
  return {
    position: 'relative',
    display: 'flex',
    flexDirection: inset ? 'column' : 'row',
    alignItems: inset ? 'stretch' : multiline ? 'flex-start' : 'center',
    justifyContent: inset && !multiline ? 'center' : 'flex-start',
    gap: inset ? 2 : 8,
    minHeight: multiline ? inset ? 88 : 76 : undefined,
    height: multiline ? 'auto' : h,
    padding: readOnly ? 0 : multiline ? inset ? '8px 12px' : '8px 10px' : inset ? '0 12px' : '0 10px',
    borderRadius: inset ? 8 : 'var(--fld-r)',
    background: bg,
    boxShadow: shadow,
    color: disabled ? 'var(--fld-dis-txt)' : 'var(--fld-txt)',
    cursor: disabled ? 'not-allowed' : readOnly ? 'default' : 'text',
    transition: 'box-shadow 120ms, background 120ms',
    boxSizing: 'border-box'
  };
}
function useFieldState() {
  const [st, set] = React.useState({
    h: false,
    f: false
  });
  return [st, {
    onMouseEnter: () => set(s => ({
      ...s,
      h: true
    })),
    onMouseLeave: () => set(s => ({
      ...s,
      h: false
    }))
  }, {
    onFocus: () => set(s => ({
      ...s,
      f: true
    })),
    onBlur: () => set(s => ({
      ...s,
      f: false
    }))
  }];
}
function fieldLabel({
  label,
  required,
  optional,
  optionalText = 'Optional'
}) {
  if (!label) return null;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 4,
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--fld-label)'
    }
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fld-err)'
    }
  }, "*"), optional && /*#__PURE__*/React.createElement("span", {
    style: {
      marginInlineStart: 'auto',
      fontWeight: 400,
      fontSize: 12,
      color: 'var(--fld-mut)'
    }
  }, optionalText));
}
function fieldHelp({
  hint,
  error,
  count
}) {
  if (!hint && !error && count == null) return null;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      fontSize: 12,
      color: error ? 'var(--fld-err)' : 'var(--fld-mut)'
    }
  }, error && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "alert-circle",
    size: 14
  }), /*#__PURE__*/React.createElement("span", null, error || hint), count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      marginInlineStart: 'auto',
      fontFamily: 'var(--font-ui)'
    }
  }, count));
}
const FieldLabel = fieldLabel;
const FieldHelp = fieldHelp;
function Input({
  label,
  placeholder,
  value,
  defaultValue,
  onChange,
  type = 'text',
  variant = 'outline',
  size = 'md',
  icon = null,
  prefix,
  suffix,
  shortcut,
  hint,
  error,
  success = false,
  required = false,
  optional = false,
  optionalText,
  disabled = false,
  readOnly = false,
  multiline = false,
  rows = 3,
  maxLength,
  style = {},
  inputStyle = {},
  ...rest
}) {
  const [st, hov, foc] = useFieldState();
  const [inner, setInner] = React.useState(defaultValue ?? '');
  const val = value ?? inner;
  const inset = variant === 'inset';
  const Tag = multiline ? 'textarea' : 'input';
  const errMsg = typeof error === 'string' ? error : null;
  const control = /*#__PURE__*/React.createElement(Tag, _extends({
    type: multiline ? undefined : type,
    value: val,
    onChange: e => {
      if (value === undefined) setInner(e.target.value);
      onChange && onChange(e);
    },
    placeholder: placeholder,
    disabled: disabled,
    readOnly: readOnly,
    rows: multiline ? rows : undefined,
    maxLength: maxLength,
    "aria-invalid": !!error || undefined
  }, foc, {
    style: {
      flex: 1,
      minWidth: 0,
      width: '100%',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      padding: 0,
      margin: 0,
      font: 'inherit',
      fontSize: 13.5,
      lineHeight: multiline ? 1.5 : 1.2,
      color: 'inherit',
      resize: multiline ? 'vertical' : undefined,
      ...inputStyle
    }
  }, rest));
  const addons = /*#__PURE__*/React.createElement(React.Fragment, null, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16,
    color: "var(--fld-mut)"
  }), prefix && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-ui)',
      fontSize: 12.5,
      fontWeight: 600,
      color: 'var(--fld-mut)',
      paddingInlineEnd: 8,
      boxShadow: 'inset -1px 0 0 var(--fld-bd)',
      alignSelf: 'stretch',
      display: 'flex',
      alignItems: 'center'
    }
  }, prefix));
  const tail = /*#__PURE__*/React.createElement(React.Fragment, null, success && !error && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 16,
    color: "var(--fld-ok)"
  }), shortcut && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 10.5px var(--font-ui)',
      color: 'var(--fld-mut)',
      boxShadow: 'inset 0 0 0 1px var(--fld-bd)',
      borderRadius: 4,
      padding: '1px 5px'
    }
  }, shortcut), suffix);
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'inherit',
      ...style
    }
  }, !inset && /*#__PURE__*/React.createElement(FieldLabel, {
    label: label,
    required: required,
    optional: optional,
    optionalText: optionalText
  }), /*#__PURE__*/React.createElement("span", _extends({}, hov, {
    style: fieldBox({
      variant,
      st,
      error,
      success,
      disabled,
      readOnly,
      multiline,
      size
    })
  }), inset && label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 1.2,
      color: error ? 'var(--fld-err)' : st.f ? 'var(--fld-ring)' : 'var(--fld-mut)'
    }
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fld-err)'
    }
  }, " *")), inset ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: multiline ? 'flex-start' : 'center',
      gap: 8,
      minWidth: 0,
      flex: multiline ? 1 : undefined
    }
  }, addons, control, tail) : /*#__PURE__*/React.createElement(React.Fragment, null, addons, control, tail)), /*#__PURE__*/React.createElement(FieldHelp, {
    hint: hint,
    error: errMsg,
    count: maxLength ? `${String(val).length} / ${maxLength}` : null
  }));
}
Object.assign(__ds_scope, { fieldBox, useFieldState, fieldLabel, fieldHelp, Input, __ds_default_components_forms_Input_jsghkw: Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
/** Radio button — 16px ring, tomato 5px inner ring when selected. Use inside a group with the same `name`. Surface-aware. */
function Radio({
  checked = false,
  onChange = () => {},
  label,
  name,
  value,
  disabled = false,
  size = 'md',
  style = {}
}) {
  const [f, setF] = React.useState(false);
  const px = size === 'lg' ? 18 : 16;
  const ring = size === 'lg' ? 5.5 : 5;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: 'inherit',
      fontSize: 13.5,
      color: disabled ? 'var(--fld-dis-txt)' : 'var(--fld-txt)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "radio",
    name: name,
    value: value,
    checked: checked,
    disabled: disabled,
    onChange: e => onChange(value ?? true, e),
    onFocus: e => setF(e.target.matches(':focus-visible')),
    onBlur: () => setF(false),
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: px,
      height: px,
      flex: 'none',
      borderRadius: '50%',
      background: disabled ? 'var(--fld-dis)' : 'var(--fld-bg)',
      boxShadow: (checked ? `inset 0 0 0 ${ring}px ${disabled ? 'var(--ctl-off)' : 'var(--ctl-on)'}` : `inset 0 0 0 1.5px ${disabled ? 'var(--fld-bd)' : 'var(--ctl-off)'}`) + (f ? ', 0 0 0 2px var(--ring-offset), 0 0 0 4px var(--fld-ring)' : ''),
      transition: 'box-shadow 120ms'
    }
  }), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Radio, __ds_default_components_forms_Radio_jyiy9r: Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Segmented.jsx
try { (() => {
/** Segmented control — pick one of 2–4 options (Kanban / List / Timeline). Surface-aware. */
function Segmented({
  options = [],
  value,
  onChange = () => {},
  size = 'md',
  style = {}
}) {
  const h = size === 'sm' ? 24 : 28;
  return /*#__PURE__*/React.createElement("span", {
    role: "radiogroup",
    style: {
      display: 'inline-flex',
      gap: 2,
      padding: 2,
      borderRadius: 7,
      background: 'var(--fld-fill)',
      boxShadow: 'inset 0 0 0 1px var(--fld-bd)',
      fontFamily: 'inherit',
      ...style
    }
  }, options.map(o => {
    const v = o.value ?? o;
    const on = v === value;
    return /*#__PURE__*/React.createElement("button", {
      key: v,
      type: "button",
      role: "radio",
      "aria-checked": on,
      onClick: () => onChange(v),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: h,
        padding: '0 12px',
        border: 'none',
        borderRadius: 5,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background: on ? 'var(--fld-bg)' : 'transparent',
        color: on ? 'var(--fld-txt)' : 'var(--fld-mut)',
        boxShadow: on ? '0 1px 2px rgba(0,0,0,.08), inset 0 0 0 1px var(--fld-bd)' : 'none'
      }
    }, o.icon && /*#__PURE__*/React.createElement("i", {
      className: `ti ti-${o.icon}`,
      style: {
        fontSize: 15
      }
    }), o.label ?? o);
  }));
}
Object.assign(__ds_scope, { Segmented, __ds_default_components_forms_Segmented_15kkggc: Segmented });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Segmented.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Select / dropdown — same three looks as Input. Options may carry a `code` badge (MAR, SAR…). */
function Select({
  label,
  placeholder = 'Select…',
  value,
  options = [],
  onChange = () => {},
  variant = 'outline',
  size = 'md',
  icon,
  hint,
  error,
  required,
  optional,
  optionalText,
  disabled = false,
  defaultOpen = false,
  style = {}
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [st, hov] = __ds_scope.useFieldState();
  const [hi, setHi] = React.useState(null);
  const inset = variant === 'inset';
  const current = options.find(o => (o.value ?? o) === value);
  const text = current ? current.label ?? current : placeholder;
  const code = current && current.code;
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const badge = c => /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 10.5px var(--font-ui)',
      letterSpacing: '.03em',
      color: 'var(--fld-mut)',
      boxShadow: 'inset 0 0 0 1px var(--fld-bd)',
      borderRadius: 4,
      padding: '1px 5px'
    }
  }, c);
  const row = /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      minWidth: 0,
      flex: inset ? undefined : 1
    }
  }, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16,
    color: "var(--fld-mut)"
  }), code && badge(code), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontSize: 13.5,
      color: current ? 'inherit' : 'var(--fld-ph)'
    }
  }, text), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: open ? 'chevron-up' : 'chevron-down',
    size: 16,
    color: "var(--fld-mut)"
  }));
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'inherit',
      ...style
    }
  }, !inset && /*#__PURE__*/React.createElement(__ds_scope.fieldLabel, {
    label: label,
    required: required,
    optional: optional,
    optionalText: optionalText
  }), /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    "aria-haspopup": "listbox",
    "aria-expanded": open,
    onClick: () => setOpen(o => !o)
  }, hov, {
    style: {
      ...__ds_scope.fieldBox({
        variant,
        st: {
          ...st,
          f: open
        },
        error,
        disabled,
        size
      }),
      font: 'inherit',
      textAlign: 'start',
      border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      width: '100%'
    }
  }), inset && label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 1.2,
      color: error ? 'var(--fld-err)' : open ? 'var(--fld-ring)' : 'var(--fld-mut)'
    }
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fld-err)'
    }
  }, " *")), row), open && options.length > 0 && /*#__PURE__*/React.createElement("div", {
    role: "listbox",
    style: {
      position: 'absolute',
      top: 'calc(100% + 4px)',
      insetInline: 0,
      zIndex: 30,
      background: 'var(--menu-bg)',
      borderRadius: 8,
      padding: 4,
      boxShadow: '0 0 0 1px var(--menu-bd), 0 10px 24px rgba(10,15,30,.16)'
    }
  }, options.map(o => {
    const val = o.value ?? o;
    const lbl = o.label ?? o;
    const sel = val === value;
    return /*#__PURE__*/React.createElement("button", {
      key: val,
      type: "button",
      role: "option",
      "aria-selected": sel,
      onClick: () => {
        onChange(val);
        setOpen(false);
      },
      onMouseEnter: () => setHi(val),
      onMouseLeave: () => setHi(null),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 8px',
        border: 'none',
        borderRadius: 5,
        background: hi === val ? 'var(--menu-hov)' : 'transparent',
        color: 'var(--fld-txt)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 13,
        fontWeight: sel ? 600 : 400,
        textAlign: 'start'
      }
    }, o.code && badge(o.code), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1
      }
    }, lbl), sel && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "check",
      size: 15,
      color: "var(--fld-ring)"
    }));
  })), /*#__PURE__*/React.createElement(__ds_scope.fieldHelp, {
    hint: hint,
    error: typeof error === 'string' ? error : null
  }));
}
Object.assign(__ds_scope, { Select, __ds_default_components_forms_Select_k3ngq8: Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Toggle switch — 32×18 (md) or 36×20 (lg), tomato when on, surface-aware.
 * `labels` renders the two-sided variant (e.g. Submittal / Inspection).
 */
function Switch({
  checked = false,
  onChange = () => {},
  label,
  labels = null,
  disabled = false,
  size = 'md',
  style = {},
  ...rest
}) {
  const [f, setF] = React.useState(false);
  const W = size === 'lg' ? 36 : 32,
    H = size === 'lg' ? 20 : 18,
    K = H - 4;
  const track = /*#__PURE__*/React.createElement("span", _extends({
    role: "switch",
    tabIndex: disabled ? -1 : 0,
    "aria-checked": checked,
    "aria-disabled": disabled || undefined,
    onClick: () => !disabled && onChange(!checked),
    onKeyDown: e => {
      if (!disabled && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        onChange(!checked);
      }
    },
    onFocus: e => setF(e.currentTarget.matches(':focus-visible')),
    onBlur: () => setF(false),
    style: {
      width: W,
      height: H,
      flex: 'none',
      borderRadius: H,
      position: 'relative',
      outline: 'none',
      background: checked ? 'var(--ctl-on)' : 'var(--ctl-off)',
      opacity: disabled ? 0.45 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'background 160ms',
      boxShadow: f ? '0 0 0 2px var(--ring-offset), 0 0 0 4px var(--fld-ring)' : 'none'
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      insetInlineStart: checked ? W - K - 2 : 2,
      width: K,
      height: K,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: '0 1px 2px rgba(0,0,0,.2)',
      transition: 'inset-inline-start 160ms'
    }
  }));
  const txt = on => ({
    color: on ? 'var(--fld-txt)' : 'var(--fld-mut)',
    fontWeight: on ? 600 : 500
  });
  if (labels) {
    return /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: 'inherit',
        fontSize: 13.5,
        ...style
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: txt(!checked)
    }, labels[0]), track, /*#__PURE__*/React.createElement("span", {
      style: txt(checked)
    }, labels[1]));
  }
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: 'inherit',
      fontSize: 13.5,
      color: disabled ? 'var(--fld-dis-txt)' : 'var(--fld-txt)',
      ...style
    }
  }, track, label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Switch, __ds_default_components_forms_Switch_kgb19e: Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
/**
 * Project module tab bar — matches the SaaS shell (Overview → Settings).
 * 52px white bar, 28px gaps, muted labels; active tab is tomato 600 with a
 * 2.5px underline. Scrolls horizontally with the scrollbar hidden. RTL-aware
 * via logical properties (inherits `dir` from the page).
 */
function Tabs({
  items = [],
  value,
  onChange = () => {},
  style = {}
}) {
  const [hover, setHover] = React.useState(null);
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    className: "rb-tabs",
    style: {
      display: 'flex',
      alignItems: 'stretch',
      gap: 28,
      height: 52,
      paddingInline: 28,
      background: 'var(--ui-surface)',
      borderBottom: '1px solid var(--ui-border-2)',
      overflowX: 'auto',
      scrollbarWidth: 'none',
      ...style
    }
  }, items.map(it => {
    const key = it.value ?? it.label;
    const active = key === value;
    const hov = hover === key && !active;
    return /*#__PURE__*/React.createElement("button", {
      key: key,
      role: "tab",
      "aria-selected": active,
      onClick: () => onChange(key),
      onMouseEnter: () => setHover(key),
      onMouseLeave: () => setHover(null),
      style: {
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
        flex: 'none'
      }
    }, it.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: it.icon,
      size: 18
    }), it.label, it.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-ui)',
        fontSize: 11.5,
        fontWeight: 600,
        padding: '1px 8px',
        borderRadius: 20,
        background: active ? 'var(--tone-tomato-tint)' : 'var(--tone-gray-tint)',
        color: active ? 'var(--tone-tomato-fg)' : 'var(--ui-muted)'
      }
    }, it.count));
  }));
}
Object.assign(__ds_scope, { Tabs, __ds_default_components_navigation_Tabs_14bb2wz: Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// guidelines/filter-panel.js
try { (() => {
// Rabaed — Kanban filter panel (vanilla). mountFilter(el, {onChange})
(function () {
  const FIELDS = [{
    k: 'status',
    n: 'Status',
    a: 'الحالة',
    opts: [['Internal Review', '#2f6fe0'], ['Revised & Resubmitted', '#f0a93c'], ['Pending Approval', '#27b86e'], ['Approved', '#9aa0ad'], ['Rejected', '#e5492c'], ['Cancelled', '#3a3f4b']]
  }, {
    k: 'trade',
    n: 'Trade',
    a: 'التخصص',
    opts: [['Civil Works (CV)', 'cv'], ['Electrical Works (EL)', 'el'], ['Mechanical Works (ME)', 'me']]
  }, {
    k: 'type',
    n: 'Document type',
    a: 'نوع المستند',
    opts: [['MAR'], ['SAR'], ['DAR']]
  }, {
    k: 'owner',
    n: 'Owner',
    a: 'المسؤول',
    opts: [['Ahmed bin Said', '#3d6db5'], ['Abdullah Al Saadi', '#7a5c3a'], ['Nasser Al Kaabi', '#e98b45'], ['Mohammed Al Shamsi', '#3d6db5'], ['Sarah Al Mansoori', '#b5455a'], ['Khalid Al Dhaheri', '#6b5ad8']]
  }, {
    k: 'role',
    n: 'Role',
    a: 'الدور',
    opts: [['Contractor Engineer', '#2f6fe0'], ['Contractor Project Manager', '#7a5af0']]
  }, {
    sep: 1
  }, {
    k: 'zone',
    n: 'Zone',
    a: 'المنطقة',
    opts: [['Zone A'], ['Zone B'], ['Zone C']]
  }, {
    k: 'bldg',
    n: 'Building',
    a: 'المبنى',
    opts: [['Building 1'], ['Building 2'], ['Building 3']]
  }, {
    k: 'floor',
    n: 'Floor',
    a: 'الطابق',
    opts: [['B2'], ['B1'], ['G'], ['1'], ['2'], ['3'], ['4'], ['5'], ['R']]
  }, {
    sep: 1
  }, {
    k: 'created',
    n: 'Created date',
    a: 'تاريخ الإنشاء',
    single: 1,
    opts: [['Today'], ['Last 7 days'], ['Last 30 days'], ['This month'], ['Custom range…']]
  }, {
    k: 'days',
    n: 'Days in column',
    a: 'الأيام في العمود',
    single: 1,
    opts: [['2+ days', 'g___'], ['3+ days', 'y___'], ['5+ days', 'r___'], ['8+ days', 'rr__'], ['12+ days', 'rrr_'], ['20+ days', 'rrrr']]
  }];
  const EXTRA = [['contractor', 'Contractor', 'المقاول'], ['rev', 'Revision', 'رقم المراجعة'], ['code', 'Approval code', 'رمز الاعتماد']];
  const SAVED = {
    starred: ['My overdue MEP items', 'Zone A — this week'],
    mine: ['All Electrical MAR', 'Rejected — R2 and above', 'Pending with Project Manager', 'Building 2 · Floors 3–5', 'Created last 7 days', 'Civil Works — Basement']
  };
  const PRESET = {
    'My overdue MEP items': {
      trade: ['Mechanical Works (ME)', 'Electrical Works (EL)'],
      days: ['8+ days']
    },
    'Zone A — this week': {
      zone: ['Zone A'],
      created: ['Last 7 days']
    },
    'All Electrical MAR': {
      trade: ['Electrical Works (EL)'],
      type: ['MAR']
    },
    'Rejected — R2 and above': {
      status: ['Rejected']
    },
    'Pending with Project Manager': {
      status: ['Pending Approval'],
      role: ['Contractor Project Manager']
    },
    'Building 2 · Floors 3–5': {
      bldg: ['Building 2'],
      floor: ['3', '4', '5']
    },
    'Created last 7 days': {
      created: ['Last 7 days']
    },
    'Civil Works — Basement': {
      trade: ['Civil Works (CV)'],
      floor: ['B1', 'B2']
    }
  };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const dotsHtml = p => '<span class="fdots">' + p.split('').map(c => '<i class="' + (c === '_' ? '' : c) + '"></i>').join('') + '</span>';
  window.mountFilter = function (root, o) {
    o = o || {};
    const S = {
      tab: 'basic',
      field: 'status',
      sel: {
        status: ['Pending Approval', 'Rejected'],
        trade: ['Electrical Works (EL)']
      },
      q: '',
      saved: false,
      sq: '',
      active: null,
      fields: FIELDS.slice(),
      addOpen: false
    };
    const count = () => Object.values(S.sel).filter(v => v && v.length).length;
    function optMark(f, opt) {
      const [label, x] = opt;
      if (f.k === 'status' || f.k === 'role') return '<span class="fsd" style="background:' + x + '"></span>';
      if (f.k === 'trade') return '<span class="fchip ' + x + '">' + x.toUpperCase() + '</span>';
      if (f.k === 'owner') return '<span class="fav" style="background:' + x + '">' + label.split(' ').slice(0, 2).map(w => w[0]).join('') + '</span>';
      if (f.k === 'days') return dotsHtml(x);
      if (f.k === 'zone') return '<i class="ti ti-map"></i>';
      if (f.k === 'bldg') return '<i class="ti ti-building"></i>';
      if (f.k === 'floor') return '<i class="ti ti-stairs"></i>';
      if (f.k === 'created') return '<i class="ti ti-calendar-event"></i>';
      return '<i class="ti ti-file-text"></i>';
    }
    function render() {
      const f = S.fields.find(x => x.k === S.field) || S.fields[0],
        sel = S.sel[f.k] || [];
      const opts = f.opts.filter(op => op[0].toLowerCase().includes(S.q.toLowerCase()));
      const savedList = arr => arr.filter(n => n.toLowerCase().includes(S.sq.toLowerCase())).map(n => '<button class="fp-sv' + (S.active === n ? ' on' : '') + '" data-sv="' + esc(n) + '">' + esc(n) + (S.active === n ? '<i class="ti ti-check"></i>' : '') + '</button>').join('');
      root.innerHTML = '<div class="fp">' + '<div class="fp-hd">' + '<div class="fp-tabs"><button data-tab="basic" class="' + (S.tab === 'basic' ? 'on' : '') + '">Basic</button><button data-tab="adv" class="' + (S.tab === 'adv' ? 'on' : '') + '">Advanced</button></div>' + '<div class="fp-act"><div class="fp-svw"><button class="fp-svb' + (S.saved ? ' on' : '') + '" data-a="saved">' + (S.active ? esc(S.active) : 'Saved filters') + '<i class="ti ti-chevron-down"></i></button>' + (S.saved ? '<div class="fp-svm"><label class="fp-srch"><i class="ti ti-search"></i><input data-i="sq" placeholder="Search filters" value="' + esc(S.sq) + '"></label><div class="fp-svl"><div class="fp-gh"><i class="ti ti-star"></i>Starred filters</div>' + savedList(SAVED.starred) + '<div class="fp-gh"><i class="ti ti-user"></i>My filters</div>' + savedList(SAVED.mine) + '</div><button class="fp-all" data-a="all"><i class="ti ti-list"></i>View all saved filters<i class="ti ti-arrow-right"></i></button></div>' : '') + '</div><button class="fp-save" data-a="save"' + (count() ? '' : ' disabled') + '><i class="ti ti-star"></i>Save</button></div>' + '</div>' + (S.tab === 'basic' ? '<div class="fp-bd"><div class="fp-fields">' + S.fields.map(x => x.sep ? '<div class="fp-sep"></div>' : '<button class="fp-f' + (x.k === f.k ? ' on' : '') + '" data-f="' + x.k + '"><span>' + x.n + '<small>' + x.a + '</small></span>' + ((S.sel[x.k] || []).length ? '<b>' + S.sel[x.k].length + '</b>' : '') + '</button>').join('') + '<div class="fp-addw"><button class="fp-add" data-a="add"><i class="ti ti-plus"></i>Add field</button>' + (S.addOpen ? '<div class="fp-addm">' + EXTRA.filter(e => !S.fields.some(x => x.k === e[0])).map(e => '<button data-ad="' + e[0] + '">' + e[1] + '<small>' + e[2] + '</small></button>').join('') + '</div>' : '') + '</div>' + '<button class="fp-clear" data-a="clear"' + (count() ? '' : ' disabled') + '>Clear all</button>' + '</div><div class="fp-opts">' + '<div class="fp-oh">' + f.n + '<small>' + f.a + '</small>' + (sel.length ? '<button data-a="clrf">Clear</button>' : '') + '</div>' + (f.opts.length > 5 ? '<label class="fp-srch sm"><i class="ti ti-search"></i><input data-i="q" placeholder="Search ' + f.n.toLowerCase() + '" value="' + esc(S.q) + '"></label>' : '') + '<div class="fp-ol">' + opts.map(op => {
        const on = sel.includes(op[0]);
        return '<button class="fp-o' + (on ? ' on' : '') + '" data-o="' + esc(op[0]) + '"><span class="fck' + (f.single ? ' rd' : '') + '">' + (on ? '<i class="ti ti-check"></i>' : '') + '</span>' + optMark(f, op) + '<span class="fl">' + esc(op[0]) + '</span></button>';
      }).join('') + (opts.length ? '' : '<div class="fp-none">No matches</div>') + '</div>' + '</div></div>' : '<div class="fp-adv"><div class="fp-rule"><span class="w">Where</span><span class="pill">Status</span><span class="op">is any of</span><span class="pill v">Pending Approval, Rejected</span></div><div class="fp-rule"><span class="w and">AND</span><span class="pill">Trade</span><span class="op">is</span><span class="pill v">Electrical Works (EL)</span></div><div class="fp-rule"><span class="w and">AND</span><span class="pill">Days in column</span><span class="op">≥</span><span class="pill v">5</span></div><button class="fp-add"><i class="ti ti-plus"></i>Add rule</button></div>') + '<div class="fp-ft"><span>' + (count() ? count() + ' filter' + (count() > 1 ? 's' : '') + ' applied' : 'No filters applied') + '</span><button class="fp-done" data-a="done">Done</button></div>' + '</div>';
      o.onChange && o.onChange(count());
    }
    root.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      e.stopPropagation();
      if (b.dataset.tab) {
        S.tab = b.dataset.tab;
      } else if (b.dataset.f) {
        S.field = b.dataset.f;
        S.q = '';
      } else if (b.dataset.o) {
        const f = S.fields.find(x => x.k === S.field),
          cur = S.sel[f.k] || [],
          v = b.dataset.o;
        S.sel[f.k] = f.single ? cur[0] === v ? [] : [v] : cur.includes(v) ? cur.filter(x => x !== v) : cur.concat(v);
        S.active = null;
      } else if (b.dataset.sv) {
        S.active = b.dataset.sv;
        S.sel = JSON.parse(JSON.stringify(PRESET[S.active] || {}));
        S.saved = false;
      } else if (b.dataset.ad) {
        const e2 = EXTRA.find(x => x[0] === b.dataset.ad);
        S.fields.push({
          k: e2[0],
          n: e2[1],
          a: e2[2],
          opts: e2[0] === 'contractor' ? [['Al Futtaim Construction Co.'], ['Arabtec'], ['ALEC']] : e2[0] === 'rev' ? [['R0'], ['R1'], ['R2'], ['R3+']] : [['Code A'], ['Code B'], ['Code C'], ['Code D']]
        });
        S.field = e2[0];
        S.addOpen = false;
      } else {
        const a = b.dataset.a;
        if (a === 'saved') {
          S.saved = !S.saved;
          S.sq = '';
        }
        if (a === 'add') S.addOpen = !S.addOpen;
        if (a === 'clear') {
          S.sel = {};
          S.active = null;
        }
        if (a === 'clrf') {
          S.sel[S.field] = [];
          S.active = null;
        }
        if (a === 'save') {
          b.textContent = 'Saved ✓';
        }
        if (a === 'done') {
          o.onDone && o.onDone();
        }
        if (a === 'all') {
          S.saved = false;
        }
        if (a === 'save') return;
      }
      render();
    });
    root.addEventListener('input', e => {
      const i = e.target.dataset.i;
      if (!i) return;
      S[i] = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const n = root.querySelector('[data-i="' + i + '"]');
      if (n) {
        n.focus();
        n.setSelectionRange(pos, pos);
      }
    });
    render();
    return {
      count
    };
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "guidelines/filter-panel.js", error: String((e && e.message) || e) }); }

// guidelines/tweaks-panel.jsx
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
// Copied omelette starter. Re-running copy_starter_component with this kind overwrites this file with the latest version (page content is unaffected).

/* BEGIN USAGE */
// tweaks-panel.jsx
// Reusable Tweaks shell + form-control helpers.
// Exports (to window): useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider,
//   TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton.
//
// Owns the host protocol (listens for __activate_edit_mode / __deactivate_edit_mode,
// posts __edit_mode_available / __edit_mode_set_keys / __edit_mode_dismissed) so
// individual prototypes don't re-roll it. Ships a consistent set of controls so you
// don't hand-draw <input type="range">, segmented radios, steppers, etc.
//
// Usage (in an HTML file that loads React + Babel):
//
//   const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
//     "primaryColor": "#D97757",
//     "palette": ["#D97757", "#29261b", "#f6f4ef"],
//     "fontSize": 16,
//     "density": "regular",
//     "dark": false
//   }/*EDITMODE-END*/;
//
//   function App() {
//     const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
//     return (
//       <div style={{ fontSize: t.fontSize, color: t.primaryColor }}>
//         Hello
//         <TweaksPanel>
//           <TweakSection label="Typography" />
//           <TweakSlider label="Font size" value={t.fontSize} min={10} max={32} unit="px"
//                        onChange={(v) => setTweak('fontSize', v)} />
//           <TweakRadio  label="Density" value={t.density}
//                        options={['compact', 'regular', 'comfy']}
//                        onChange={(v) => setTweak('density', v)} />
//           <TweakSection label="Theme" />
//           <TweakColor  label="Primary" value={t.primaryColor}
//                        options={['#D97757', '#2A6FDB', '#1F8A5B', '#7A5AE0']}
//                        onChange={(v) => setTweak('primaryColor', v)} />
//           <TweakColor  label="Palette" value={t.palette}
//                        options={[['#D97757', '#29261b', '#f6f4ef'],
//                                  ['#475569', '#0f172a', '#f1f5f9']]}
//                        onChange={(v) => setTweak('palette', v)} />
//           <TweakToggle label="Dark mode" value={t.dark}
//                        onChange={(v) => setTweak('dark', v)} />
//         </TweaksPanel>
//       </div>
//     );
//   }
//
// TweakRadio is the segmented control for 2–3 short options (auto-falls-back to
// TweakSelect past ~16/~10 chars per label); reach for TweakSelect directly when
// options are many or long. For color tweaks always curate 3-4 options rather than
// a free picker; an option can also be a whole 2–5 color palette (the stored value
// is the array). The Tweak* controls are a floor, not a ceiling — build custom
// controls inside the panel if a tweak calls for UI they don't cover.
/* END USAGE */
// ─────────────────────────────────────────────────────────────────────────────

const __TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom right;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:default;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-num{display:flex;align-items:center;box-sizing:border-box;min-width:0;height:26px;padding:0 0 0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;background:rgba(255,255,255,.6)}
  .twk-num-lbl{font-weight:500;color:rgba(41,38,27,.6);cursor:ew-resize;
    user-select:none;padding-right:8px}
  .twk-num input{flex:1;min-width:0;height:100%;border:0;background:transparent;
    font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:0 8px 0 0;
    outline:none;color:inherit;-moz-appearance:textfield}
  .twk-num input::-webkit-inner-spin-button,.twk-num input::-webkit-outer-spin-button{
    -webkit-appearance:none;margin:0}
  .twk-num-unit{padding-right:8px;color:rgba(41,38,27,.45)}

  .twk-btn{appearance:none;height:26px;padding:0 12px;border:0;border-radius:7px;
    background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:default}
  .twk-btn:hover{background:rgba(0,0,0,.88)}
  .twk-btn.secondary{background:rgba(0,0,0,.06);color:inherit}
  .twk-btn.secondary:hover{background:rgba(0,0,0,.1)}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:default;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
`;

// ── useTweaks ───────────────────────────────────────────────────────────────
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys → host rewrites the EDITMODE block on disk).
function useTweaks(defaults) {
  const [values, setValues] = React.useState(defaults);
  // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
  // useState-style call doesn't write a "[object Object]" key into the persisted
  // JSON block.
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null ? keyOrEdits : {
      [keyOrEdits]: val
    };
    setValues(prev => ({
      ...prev,
      ...edits
    }));
    window.parent.postMessage({
      type: '__edit_mode_set_keys',
      edits
    }, '*');
    // Same-window signal so in-page listeners (deck-stage rail thumbnails)
    // can react — the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent('tweakchange', {
      detail: edits
    }));
  }, []);
  return [values, setTweak];
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
// Floating shell. Registers the protocol listener BEFORE announcing
// availability — if the announce ran first, the host's activate could land
// before our handler exists and the toolbar toggle would silently no-op.
// The close button posts __edit_mode_dismissed so the host's toolbar toggle
// flips off in lockstep; the host echoes __deactivate_edit_mode back which
// is what actually hides the panel.
function TweaksPanel({
  title = 'Tweaks',
  children
}) {
  const [open, setOpen] = React.useState(false);
  const dragRef = React.useRef(null);
  const offsetRef = React.useRef({
    x: 16,
    y: 16
  });
  const PAD = 16;
  const clampToViewport = React.useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth,
      h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y))
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);
  React.useEffect(() => {
    if (!open) return;
    clampToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport);
      return () => window.removeEventListener('resize', clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);
  React.useEffect(() => {
    const onMsg = e => {
      const t = e?.data?.type;
      if (t === '__activate_edit_mode') setOpen(true);else if (t === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({
      type: '__edit_mode_available'
    }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const dismiss = () => {
    setOpen(false);
    window.parent.postMessage({
      type: '__edit_mode_dismissed'
    }, '*');
  };
  const onDragStart = e => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX,
      sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = ev => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy)
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // data-om-starter: inert presence marker — Claude Design's starter-usage
  // probe reads it. The closed panel renders nothing, so the marker rides
  // the <html> element as an attribute instead of a rendered node — zero
  // elements added, so page CSS (even structural selectors like
  // :nth-child) can never observe it. It records that the page WIRES a
  // tweaks panel, whether or not the panel is open. Keep this effect.
  React.useEffect(() => {
    document.documentElement.setAttribute('data-om-starter', 'tweaks-panel');
    return () => document.documentElement.removeAttribute('data-om-starter');
  }, []);
  if (!open) return null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("style", null, __TWEAKS_STYLE), /*#__PURE__*/React.createElement("div", {
    ref: dragRef,
    className: "twk-panel",
    "data-omelette-chrome": "",
    style: {
      right: offsetRef.current.x,
      bottom: offsetRef.current.y
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-hd",
    onMouseDown: onDragStart
  }, /*#__PURE__*/React.createElement("b", null, title), /*#__PURE__*/React.createElement("button", {
    className: "twk-x",
    "aria-label": "Close tweaks",
    onMouseDown: e => e.stopPropagation(),
    onClick: dismiss
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    className: "twk-body"
  }, children)));
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function TweakSection({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "twk-sect"
  }, label), children);
}
function TweakRow({
  label,
  value,
  children,
  inline = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: inline ? 'twk-row twk-row-h' : 'twk-row'
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-lbl"
  }, /*#__PURE__*/React.createElement("span", null, label), value != null && /*#__PURE__*/React.createElement("span", {
    className: "twk-val"
  }, value)), children);
}

// ── Controls ────────────────────────────────────────────────────────────────

function TweakSlider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label,
    value: `${value}${unit}`
  }, /*#__PURE__*/React.createElement("input", {
    type: "range",
    className: "twk-slider",
    min: min,
    max: max,
    step: step,
    value: value,
    onChange: e => onChange(Number(e.target.value))
  }));
}
function TweakToggle({
  label,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "twk-row twk-row-h"
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-lbl"
  }, /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "twk-toggle",
    "data-on": value ? '1' : '0',
    role: "switch",
    "aria-checked": !!value,
    onClick: () => onChange(!value)
  }, /*#__PURE__*/React.createElement("i", null)));
}
function TweakRadio({
  label,
  value,
  options,
  onChange
}) {
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);
  // The active value is read by pointer-move handlers attached for the lifetime
  // of a drag — ref it so a stale closure doesn't fire onChange for every move.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Segments wrap mid-word once per-segment width runs out. The track is
  // ~248px (280 panel − 28 body pad − 4 seg pad), each button loses 12px
  // to its own padding, and 11.5px system-ui averages ~6.3px/char — so 2
  // options fit ~16 chars each, 3 fit ~10. Past that (or >3 options), fall
  // back to a dropdown rather than wrap.
  const labelLen = o => String(typeof o === 'object' ? o.label : o).length;
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
  const fitsAsSegments = maxLen <= ({
    2: 16,
    3: 10
  }[options.length] ?? 0);
  if (!fitsAsSegments) {
    // <select> emits strings — map back to the original option value so the
    // fallback stays type-preserving (numbers, booleans) like the segment path.
    const resolve = s => {
      const m = options.find(o => String(typeof o === 'object' ? o.value : o) === s);
      return m === undefined ? s : typeof m === 'object' ? m.value : m;
    };
    return /*#__PURE__*/React.createElement(TweakSelect, {
      label: label,
      value: value,
      options: options,
      onChange: s => onChange(resolve(s))
    });
  }
  const opts = options.map(o => typeof o === 'object' ? o : {
    value: o,
    label: o
  });
  const idx = Math.max(0, opts.findIndex(o => o.value === value));
  const n = opts.length;
  const segAt = clientX => {
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor((clientX - r.left - 2) / inner * n);
    return opts[Math.max(0, Math.min(n - 1, i))].value;
  };
  const onPointerDown = e => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = ev => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("div", {
    ref: trackRef,
    role: "radiogroup",
    onPointerDown: onPointerDown,
    className: dragging ? 'twk-seg dragging' : 'twk-seg'
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-seg-thumb",
    style: {
      left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
      width: `calc((100% - 4px) / ${n})`
    }
  }), opts.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    type: "button",
    role: "radio",
    "aria-checked": o.value === value
  }, o.label))));
}
function TweakSelect({
  label,
  value,
  options,
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("select", {
    className: "twk-field",
    value: value,
    onChange: e => onChange(e.target.value)
  }, options.map(o => {
    const v = typeof o === 'object' ? o.value : o;
    const l = typeof o === 'object' ? o.label : o;
    return /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, l);
  })));
}
function TweakText({
  label,
  value,
  placeholder,
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("input", {
    className: "twk-field",
    type: "text",
    value: value,
    placeholder: placeholder,
    onChange: e => onChange(e.target.value)
  }));
}
function TweakNumber({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange
}) {
  const clamp = n => {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };
  const startRef = React.useRef({
    x: 0,
    val: 0
  });
  const onScrubStart = e => {
    e.preventDefault();
    startRef.current = {
      x: e.clientX,
      val: value
    };
    const decimals = (String(step).split('.')[1] || '').length;
    const move = ev => {
      const dx = ev.clientX - startRef.current.x;
      const raw = startRef.current.val + dx * step;
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(Number(snapped.toFixed(decimals))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "twk-num"
  }, /*#__PURE__*/React.createElement("span", {
    className: "twk-num-lbl",
    onPointerDown: onScrubStart
  }, label), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: value,
    min: min,
    max: max,
    step: step,
    onChange: e => onChange(clamp(Number(e.target.value)))
  }), unit && /*#__PURE__*/React.createElement("span", {
    className: "twk-num-unit"
  }, unit));
}

// Relative-luminance contrast pick — checkmarks drawn over a swatch need to
// read on both #111 and #fafafa without per-option configuration. Hex input
// only (#rgb / #rrggbb); named or rgb()/hsl() colors fall through to "light".
function __twkIsLight(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, c => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = n >> 16 & 255,
    g = n >> 8 & 255,
    b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}
const __TwkCheck = ({
  light
}) => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 14 14",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "M3 7.2 5.8 10 11 4.2",
  fill: "none",
  strokeWidth: "2.2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  stroke: light ? 'rgba(0,0,0,.78)' : '#fff'
}));

// TweakColor — curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts — a lone color
// renders solid, a palette renders colors[0] as the hero (left ~2/3) with the
// rest stacked in a sharp column on the right. onChange emits the
// option in the shape it was passed (string stays string, array stays array).
// Without options it falls back to the native color input for back-compat.
function TweakColor({
  label,
  value,
  options,
  onChange
}) {
  if (!options || !options.length) {
    return /*#__PURE__*/React.createElement("div", {
      className: "twk-row twk-row-h"
    }, /*#__PURE__*/React.createElement("div", {
      className: "twk-lbl"
    }, /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("input", {
      type: "color",
      className: "twk-swatch",
      value: value,
      onChange: e => onChange(e.target.value)
    }));
  }
  // Native <input type=color> emits lowercase hex per the HTML spec, so
  // compare case-insensitively. String() guards JSON.stringify(undefined),
  // which returns the primitive undefined (no .toLowerCase).
  const key = o => String(JSON.stringify(o)).toLowerCase();
  const cur = key(value);
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-chips",
    role: "radiogroup"
  }, options.map((o, i) => {
    const colors = Array.isArray(o) ? o : [o];
    const [hero, ...rest] = colors;
    const sup = rest.slice(0, 4);
    const on = key(o) === cur;
    return /*#__PURE__*/React.createElement("button", {
      key: i,
      type: "button",
      className: "twk-chip",
      role: "radio",
      "aria-checked": on,
      "data-on": on ? '1' : '0',
      "aria-label": colors.join(', '),
      title: colors.join(' · '),
      style: {
        background: hero
      },
      onClick: () => onChange(o)
    }, sup.length > 0 && /*#__PURE__*/React.createElement("span", null, sup.map((c, j) => /*#__PURE__*/React.createElement("i", {
      key: j,
      style: {
        background: c
      }
    }))), on && /*#__PURE__*/React.createElement(__TwkCheck, {
      light: __twkIsLight(hero)
    }));
  })));
}
function TweakButton({
  label,
  onClick,
  secondary = false
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: secondary ? 'twk-btn secondary' : 'twk-btn',
    onClick: onClick
  }, label);
}
Object.assign(window, {
  useTweaks,
  TweaksPanel,
  TweakSection,
  TweakRow,
  TweakSlider,
  TweakToggle,
  TweakRadio,
  TweakSelect,
  TweakText,
  TweakNumber,
  TweakColor,
  TweakButton
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "guidelines/tweaks-panel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/floor/data.js
try { (() => {
// Floor View — sample data: Dubai Marina Tower – Phase 2 · Zone A – North Wing · Tower 1. Exposes window.FD.
(function () {
  const ST = {
    done: {
      en: 'Complete',
      ar: 'مكتمل',
      ic: 'ti-check',
      c: 'var(--tone-green-solid)',
      t: 'var(--tone-green-tint)',
      f: 'var(--tone-green-fg)',
      den: 'Every visible inspection at this space has passed.',
      dar: 'اجتازت جميع الفحوصات المرئية في هذه المساحة.'
    },
    prog: {
      en: 'In Progress',
      ar: 'قيد التنفيذ',
      ic: 'ti-refresh',
      c: 'var(--tone-blue-solid)',
      t: 'var(--tone-blue-tint)',
      f: 'var(--tone-blue-fg)',
      den: 'Open inspections or submittals, no open issues.',
      dar: 'فحوصات أو تقديمات مفتوحة، دون مشكلات مفتوحة.'
    },
    iss: {
      en: 'Issues',
      ar: 'مشكلات',
      ic: 'ti-alert-triangle',
      c: 'var(--tone-red-solid)',
      t: 'var(--tone-red-tint)',
      f: 'var(--tone-red-fg)',
      den: 'An open snag or a failed inspection.',
      dar: 'ملاحظة مفتوحة أو فحص راسب.'
    },
    pend: {
      en: 'Pending',
      ar: 'لم يبدأ',
      ic: 'ti-hourglass-high',
      c: 'var(--tone-gray-solid)',
      t: 'var(--tone-gray-tint)',
      f: 'var(--tone-gray-fg)',
      den: 'Nothing started that you can see.',
      dar: 'لم يبدأ أي عمل مرئي لك.'
    }
  };
  const ORDER = ['done', 'prog', 'iss', 'pend'];
  const TR = {
    EL: ['Electrical', 'كهرباء', 'cyan'],
    CV: ['Civil', 'مدني', 'amber'],
    ME: ['Mechanical', 'ميكانيكا', 'green'],
    PL: ['Plumbing', 'سباكة', 'blue'],
    AR: ['Finishes', 'تشطيبات', 'violet'],
    FS: ['Firestopping', 'عزل الحريق', 'orange']
  };
  const CO = {
    afc: ['Al Futtaim Construction', 'الفطيم للمقاولات', '#f8552f'],
    dry: ['Gulf Dryliners', 'الخليج للألواح الجافة', '#7a5af0'],
    mep: ['ALEC MEP', 'ألك للأعمال الكهروميكانيكية', '#1fae66'],
    fire: ['FireSafe Systems', 'فاير سيف للأنظمة', '#e98b45']
  };
  const TY = {
    insp: ['Inspections', 'الفحوصات'],
    snag: ['Snags', 'الملاحظات'],
    sub: ['Submittals', 'التقديمات']
  };
  const STAGE = {
    str: ['Structure', 'الهيكل'],
    mep: ['MEP rough-in', 'التمديدات'],
    fin: ['Finishes', 'التشطيبات']
  };
  const STG = {
    CV: 'str',
    EL: 'mep',
    ME: 'mep',
    PL: 'mep',
    FS: 'mep',
    AR: 'fin'
  };
  const ROLES = {
    admin: {
      en: 'Project Admin',
      ar: 'مسؤول المشروع',
      sub: ['All companies', 'جميع الشركات']
    },
    dry: {
      en: 'Contractor · Gulf Dryliners',
      ar: 'مقاول · الخليج للألواح الجافة',
      sub: ['Own work only', 'أعمال الشركة فقط'],
      co: 'dry'
    },
    mep: {
      en: 'Contractor · ALEC MEP',
      ar: 'مقاول · ألك',
      sub: ['Own work only', 'أعمال الشركة فقط'],
      co: 'mep'
    }
  };
  const SP = {
    apt: ['Apartments', 'الشقق'],
    cor: ['Corridor', 'الممر'],
    r1: ['Riser 01', 'الرايزر ٠١'],
    r2: ['Riser 02', 'الرايزر ٠٢'],
    lob: ['Lift lobby', 'بهو المصاعد'],
    bath: ['Bathrooms', 'الحمامات'],
    stair: ['Stair core', 'بيت الدرج'],
    plant: ['Plant room', 'غرفة المعدات'],
    roofw: ['Roof waterproofing', 'عزل السطح'],
    lmr: ['Lift machine room', 'غرفة محركات المصاعد'],
    retail: ['Retail units', 'المحلات'],
    glob: ['Main lobby', 'البهو الرئيسي'],
    load: ['Loading bay', 'منطقة التحميل'],
    sec: ['Security room', 'غرفة الأمن'],
    subst: ['Substation', 'المحطة الفرعية'],
    park: ['Car park', 'المواقف'],
    pump: ['Pump room', 'غرفة المضخات'],
    tank: ['Tank room', 'غرفة الخزانات'],
    spr: ['Sprinkler valve room', 'غرفة صمامات الرش']
  };
  // issue texts
  const IS = {
    i07: {
      t: ['Deficient and possibly inaccessible', 'معيب وقد يتعذر الوصول إليه'],
      d: ['Cable tray in Riser 01 is under-supported and boxed in behind the shaft wall — access for testing is blocked.', 'حامل الكابلات في الرايزر ٠١ غير مدعوم بشكل كافٍ ومغلق خلف جدار المنور — الوصول للاختبار متعذر.'],
      p: 'high'
    },
    i06: {
      t: ['Leakage detected', 'تم رصد تسرب'],
      d: ['Pressure test on the bathroom stack dropped 0.4 bar in 2 h. Joint at the Level 06 branch is weeping.', 'انخفض اختبار الضغط لخط الحمامات 0.4 بار خلال ساعتين. تسرب عند وصلة فرع الطابق ٠٦.'],
      p: 'high'
    },
    i01: {
      t: ['Ceiling Plasterboard – Rework Needed', 'ألواح الجبس في السقف – تتطلب إعادة عمل'],
      d: ['Joints cracked along the corridor run; boards fixed at 600 mm centres instead of 400 mm.', 'تشققات في الوصلات على طول الممر؛ الألواح مثبتة على مسافة 600 مم بدلًا من 400 مم.'],
      p: 'med'
    },
    i02: {
      t: ['SVP Firestopping – Potential Rework', 'عزل حريق أنبوب الصرف الرأسي – قد يتطلب إعادة عمل'],
      d: ['Intumescent collar at the SVP penetration looks undersized for a 110 mm pipe. Awaiting manufacturer data.', 'طوق العزل عند اختراق أنبوب الصرف يبدو أصغر من المطلوب لأنبوب 110 مم. بانتظار بيانات المصنّع.'],
      p: 'med'
    },
    i03: {
      t: ['Cable tray support spacing exceeds spec', 'تباعد دعامات حامل الكابلات يتجاوز المواصفة'],
      d: ['Supports measured at 1.8 m; spec allows 1.2 m max. Inspection failed.', 'الدعامات على مسافة 1.8 م؛ الحد الأقصى في المواصفة 1.2 م. رسب الفحص.'],
      p: 'med'
    },
    iG: {
      t: ['Earthing test results missing', 'نتائج اختبار التأريض مفقودة'],
      d: ['Substation earth pit readings not uploaded; energisation date at risk.', 'قراءات حفرة التأريض للمحطة الفرعية لم تُرفع؛ موعد التشغيل معرّض للتأخير.'],
      p: 'low'
    },
    r04: {
      t: ['Fire damper access panel missing', 'لوحة الوصول لمخمد الحريق مفقودة'],
      d: ['Access panel installed and signed off.', 'تم تركيب لوحة الوصول واعتمادها.'],
      p: 'med'
    },
    r06: {
      t: ['Ceiling void not cleaned', 'فراغ السقف غير نظيف'],
      d: ['Void cleaned and re-inspected.', 'تم تنظيف الفراغ وإعادة فحصه.'],
      p: 'low'
    }
  };
  // item code: TRADE:type:result:company[:issueKey][:week]
  const FL = [{
    id: 'rf',
    en: 'Roof',
    ar: 'السطح',
    lv: 'RF',
    sp: {
      plant: ['ME:insp:open:mep'],
      roofw: ['CV:insp:passed:afc'],
      lmr: []
    }
  }, {
    id: '08',
    en: 'Floor 08',
    ar: 'الطابق ٠٨',
    lv: 'L08',
    sp: {
      apt: ['AR:sub:open:dry'],
      cor: ['EL:insp:passed:mep'],
      r1: ['FS:insp:open:fire::33'],
      lob: []
    }
  }, {
    id: '07',
    en: 'Floor 07',
    ar: 'الطابق ٠٧',
    lv: 'L07',
    sp: {
      apt: ['AR:insp:passed:dry'],
      cor: ['ME:sub:open:mep'],
      r1: ['EL:snag:open:mep:i07']
    }
  }, {
    id: '06',
    en: 'Floor 06',
    ar: 'الطابق ٠٦',
    lv: 'L06',
    sp: {
      apt: ['AR:insp:passed:dry', 'EL:insp:passed:mep'],
      cor: ['CV:insp:passed:afc', 'AR:snag:closed:dry:r06'],
      r2: ['PL:insp:open:mep'],
      bath: ['PL:snag:open:mep:i06']
    }
  }, {
    id: '05',
    en: 'Floor 05',
    ar: 'الطابق ٠٥',
    lv: 'L05',
    sp: {
      apt: ['AR:insp:passed:dry'],
      cor: ['EL:insp:open:mep'],
      r1: []
    }
  }, {
    id: '04',
    en: 'Floor 04',
    ar: 'الطابق ٠٤',
    lv: 'L04',
    sp: {
      apt: ['AR:insp:passed:dry', 'EL:insp:passed:mep'],
      cor: ['CV:insp:passed:afc'],
      r1: ['FS:insp:passed:fire', 'FS:snag:closed:fire:r04'],
      lob: ['AR:sub:open:dry']
    }
  }, {
    id: '03',
    en: 'Floor 03',
    ar: 'الطابق ٠٣',
    lv: 'L03',
    sp: {
      apt: ['EL:insp:failed:mep:i03'],
      cor: ['AR:insp:passed:dry'],
      r1: ['ME:insp:open:mep']
    }
  }, {
    id: '02',
    en: 'Floor 02',
    ar: 'الطابق ٠٢',
    lv: 'L02',
    sp: {
      apt: ['AR:insp:passed:dry'],
      cor: ['EL:insp:passed:mep'],
      r1: ['FS:snag:open:fire:i02'],
      stair: ['CV:insp:passed:afc']
    }
  }, {
    id: '01',
    en: 'Floor 01',
    ar: 'الطابق ٠١',
    lv: 'L01',
    sp: {
      apt: ['AR:insp:passed:dry'],
      cor: ['AR:snag:open:dry:i01'],
      r1: ['EL:insp:passed:mep'],
      retail: ['ME:sub:open:mep']
    }
  }, {
    id: 'gf',
    en: 'Ground Floor',
    ar: 'الطابق الأرضي',
    lv: 'GF',
    sp: {
      glob: ['AR:insp:open:dry'],
      retail: ['EL:insp:passed:mep'],
      load: ['CV:insp:passed:afc'],
      sec: [],
      subst: ['EL:snag:open:mep:iG']
    }
  }, {
    id: 'b1',
    en: 'Basement 1',
    ar: 'القبو ١',
    lv: 'B1',
    below: 1,
    sp: {
      park: ['CV:insp:passed:afc'],
      pump: ['PL:insp:open:mep'],
      tank: ['PL:insp:passed:mep'],
      spr: ['FS:insp:open:fire']
    }
  }];
  let n = 0;
  FL.forEach(f => {
    f.spaces = Object.entries(f.sp).map(([k, arr]) => ({
      k,
      items: arr.map(code => {
        const [tr, type, res, co, ik, wk] = code.split(':');
        n++;
        return {
          tr,
          type,
          res,
          co,
          stage: STG[tr],
          wk: +wk || 28 + n % 5,
          is: ik || null,
          age: 2 + n * 5 % 16
        };
      })
    }));
  });
  const BLD = [{
    id: 't1',
    en: 'Tower 1',
    ar: 'البرج ١',
    z: 'a'
  }, {
    id: 't2',
    en: 'Tower 2',
    ar: 'البرج ٢',
    z: 'a',
    empty: 1
  }, {
    id: 'pd',
    en: 'Podium',
    ar: 'المنصة',
    z: 'a',
    off: 1
  }, {
    id: 't3',
    en: 'Tower 3',
    ar: 'البرج ٣',
    z: 'b',
    off: 1
  }];
  const ZN = {
    a: ['Zone A – North Wing', 'المنطقة أ – الجناح الشمالي'],
    b: ['Zone B – South Wing', 'المنطقة ب – الجناح الجنوبي']
  };
  window.FD = {
    ST,
    ORDER,
    TR,
    CO,
    TY,
    STAGE,
    ROLES,
    SP,
    IS,
    FL,
    BLD,
    ZN
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/floor/data.js", error: String((e && e.message) || e) }); }

// ui_kits/app/floor/floor.js
try { (() => {
// Multiple View → Floor View. Exposes window.FV {V, view, bind, after}.
(function () {
  const S = RS.S,
    {
      ST,
      ORDER,
      TR,
      CO,
      TY,
      STAGE,
      ROLES,
      SP,
      IS,
      FL,
      BLD,
      ZN
    } = FD;
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  const V = {
    bld: 't1',
    role: 'admin',
    tr: new Set(),
    ty: new Set(),
    co: new Set(),
    stage: '',
    wk: 32,
    mode: 'status',
    layout: 'stack',
    sel: null,
    z: 1,
    legend: false,
    tab: 'open',
    open: null,
    menu: null,
    drill: null,
    ff: false,
    tablet: false,
    toast: null
  };
  const wkDate = w => {
    const d = new Date(2025, 11, 29 + (w - 1) * 7);
    return new Intl.DateTimeFormat(S.lang === 'ar' ? 'ar' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      numberingSystem: 'latn'
    }).format(d);
  };
  const bld = () => BLD.find(b => b.id === V.bld);
  function vis(it) {
    const r = ROLES[V.role];
    if (r.co && it.co !== r.co) return false;
    if (V.tr.size && !V.tr.has(it.tr)) return false;
    if (V.ty.size && !V.ty.has(it.type)) return false;
    if (V.co.size && !V.co.has(it.co)) return false;
    if (V.stage && it.stage !== V.stage) return false;
    return it.wk <= V.wk;
  }
  function spSt(items) {
    if (items.some(i => i.type === 'snag' && i.res === 'open' || i.type === 'insp' && i.res === 'failed')) return 'iss';
    if (items.some(i => i.res === 'open')) return 'prog';
    if (items.some(i => i.type === 'insp' && i.res === 'passed')) return 'done';
    return 'pend';
  }
  function model() {
    const empty = bld().empty;
    return FL.map(f => {
      const spaces = f.spaces.map(s => {
        const items = empty ? [] : s.items.filter(vis);
        return {
          k: s.k,
          items,
          st: spSt(items)
        };
      });
      const c = {
        done: 0,
        prog: 0,
        iss: 0,
        pend: 0
      };
      spaces.forEach(s => c[s.st]++);
      return {
        f,
        spaces,
        c
      };
    });
  }
  const fname = f => L(f.en, f.ar);
  const worst = c => c.iss ? 'iss' : c.prog ? 'prog' : c.done ? 'done' : 'pend';
  const chipS = s => `<span class="zs" style="background:${ST[s].t};color:${ST[s].f}"><i class="ti ${ST[s].ic}"></i>${L(ST[s].en, ST[s].ar)}</span>`;
  const tile = (s, mute) => `<span class="tile ${s.st}${mute ? ' mute' : ''}" style="${s.st === 'pend' ? '' : `background:${ST[s.st].c}`}"><i class="ti ${ST[s.st].ic}"></i><span class="tt">${L(SP[s.k][0], SP[s.k][1])} · ${L(ST[s.st].en, ST[s.st].ar)}</span></span>`;
  const cnts = (c, lb) => `<span class="cnts">${ORDER.map(k => `<span class="cnt${c[k] ? '' : ' z'}" style="background:${ST[k].t};color:${ST[k].f}" title="${L(ST[k].en, ST[k].ar)}"><i class="ti ${ST[k].ic}"></i>${c[k]}${lb ? `<span class="lb" style="font-weight:600;font-family:var(--font-ui)"> ${L(ST[k].en, ST[k].ar)}</span>` : ''}</span>`).join('')}</span>`;
  /* ---- toolbar ---- */
  function toolbar() {
    const b = bld(),
      r = ROLES[V.role];
    const segs = [['floor', 'ti-stairs', L('Floor', 'الطوابق')], ['map', 'ti-map', L('Map', 'الخريطة')], ['plan', 'ti-vector', L('Plan', 'المخطط')]];
    const nf = V.tr.size + V.ty.size + V.co.size + (V.stage ? 1 : 0);
    return `<div class="fv-bar"><span class="segv">${segs.map(s => `<button class="${(V.drill ? 'plan' : 'floor') === s[0] ? 'on' : ''}" data-view="${s[0]}"><i class="ti ${s[1]}"></i>${s[2]}</button>`).join('')}</span>
 <nav class="bc"><span>${L('Dubai Marina Tower – Phase 2', 'برج دبي مارينا – المرحلة ٢')}</span><i class="ti ti-chevron-right"></i><span>${L(ZN[b.z][0], ZN[b.z][1])}</span><i class="ti ti-chevron-right"></i><span class="rel" style="padding:0"><button class="bsw" data-menu="bld"><i class="ti ti-building-skyscraper"></i>${L(b.en, b.ar)}<i class="ti ti-chevron-down"></i></button>${V.menu === 'bld' ? `<div class="pop" data-stop style="min-width:240px">${Object.keys(ZN).map(z => `<h6>${L(ZN[z][0], ZN[z][1])}</h6>${BLD.filter(x => x.z === z).map(x => `<button class="mi${x.id === V.bld ? ' on' : ''}" ${x.off ? 'disabled style="opacity:.5;cursor:default"' : `data-bld="${x.id}"`}><i class="ti ti-building-skyscraper"></i>${L(x.en, x.ar)}${x.off ? `<small>${L('Not set up', 'غير مُعدّ')}</small>` : x.empty ? `<small>${L('No work items', 'لا توجد عناصر')}</small>` : ''}${x.id === V.bld ? '<i class="ti ti-check ck"></i>' : ''}</button>`).join('')}`).join('')}</div>` : ''}</span><i class="ti ti-chevron-right"></i>${V.drill ? `<button class="cb ter sm" data-act="undrill">${L('All Floors', 'جميع الطوابق')}</button><i class="ti ti-chevron-right"></i><span class="cur">${fname(FL.find(f => f.id === V.drill))}</span>` : `<span class="cur">${L('All Floors', 'جميع الطوابق')}</span>`}</nav>
 <span class="sp"></span>
 ${V.drill ? '' : `<button class="cb tbl-only${nf ? ' on' : ''}" data-act="ff"><i class="ti ti-filter"></i>${L('Filters', 'التصفية')}${nf ? `<span class="cnt" style="height:18px;min-width:18px;padding:0 5px;background:var(--btn-pri);color:#fff;font-size:10.5px">${nf}</span>` : ''}</button>
 <span class="segv" title="${L('View data', 'عرض البيانات')}"><button class="${V.mode === 'status' ? 'on' : ''}" data-mode2="status">${L('Status', 'الحالة')}</button><button class="${V.mode === 'issues' ? 'on' : ''}" data-mode2="issues"><i class="ti ti-alert-triangle"></i>${L('Issues only', 'المشكلات فقط')}</button></span>
 <span class="segv"><button class="${V.layout === 'stack' ? 'on' : ''}" data-layout="stack" title="${L('Stack', 'مكدّس')}"><i class="ti ti-building-skyscraper"></i>${L('Stack', 'مكدّس')}</button><button class="${V.layout === 'list' ? 'on' : ''}" data-layout="list" title="${L('List', 'قائمة')}"><i class="ti ti-layout-grid"></i>${L('List', 'قائمة')}</button></span>`}
 <span class="rel"><button class="vis" data-menu="role"><i class="ti ti-eye"></i>${L(r.en, r.ar)}<i class="ti ti-chevron-down"></i></button>${V.menu === 'role' ? `<div class="pop end" data-stop style="min-width:280px"><h6>${L('Demo · view as', 'عرض توضيحي · العرض بصفة')}</h6>${Object.entries(ROLES).map(([k, x]) => `<button class="mi${V.role === k ? ' on' : ''}" data-role="${k}" style="white-space:normal"><i class="ti ${k === 'admin' ? 'ti-shield' : 'ti-user-circle'}"></i><span><b style="display:block;font-weight:600">${L(x.en, x.ar)}</b><span style="font-size:11.5px;color:var(--ui-muted)">${L(x.sub[0], x.sub[1])}</span></span></button>`).join('')}</div>` : ''}</span>
 <span class="rel"><button class="cb ic" data-menu="demo"><i class="ti ti-dots"></i></button>${V.menu === 'demo' ? `<div class="pop end" data-stop><h6>${L('Demo states', 'حالات العرض')}</h6><button class="mi" data-act="elec"><i class="ti ti-filter"></i>${L('Filter: Electrical only', 'تصفية: الكهرباء فقط')}</button><button class="mi" data-bld="t2"><i class="ti ti-building-skyscraper"></i>${L('Empty building (Tower 2)', 'مبنى فارغ (البرج ٢)')}</button><button class="mi${V.tablet ? ' on' : ''}" data-act="tablet"><i class="ti ti-device-tablet"></i>${L('Tablet preview (1024px)', 'معاينة الجهاز اللوحي')}${V.tablet ? '<i class="ti ti-check ck"></i>' : ''}</button></div>` : ''}</span></div>`;
  }
  /* ---- filters ---- */
  function filters() {
    const r = ROLES[V.role];
    const cos = Object.keys(CO).filter(k => !r.co || k === r.co);
    const ck = (set, k, label, pre) => `<button class="ck2${V[set].has(k) ? ' on' : ''}" data-ck="${set}:${k}"><span class="bx">${V[set].has(k) ? '<i class="ti ti-check"></i>' : ''}</span>${pre || ''}${label}</button>`;
    const nf = V.tr.size + V.ty.size + V.co.size + (V.stage ? 1 : 0);
    return `<aside class="fv-card fv-filters${V.ff ? '' : ' shut'}"><div class="ff-hd"><i class="ti ti-filter"></i>${L('Filters', 'التصفية')}${nf ? `<button class="cb ter sm" data-act="clearf">${L('Reset', 'إعادة ضبط')}</button>` : ''}<button class="cb ter sm ic tbl-only" data-act="ff" style="${nf ? '' : 'margin-inline-start:auto'}"><i class="ti ti-x"></i></button></div><div class="ff-bd">
 <div class="fg"><h6>${L('Week', 'الأسبوع')}</h6><div class="wk"><button class="cb ter ic" data-wk="-1"${V.wk <= 26 ? ' disabled' : ''}><i class="ti ti-chevron-left"></i></button><span>${L('Week', 'الأسبوع')} ${V.wk}<small>${wkDate(V.wk)}</small></span><button class="cb ter ic" data-wk="1"${V.wk >= 39 ? ' disabled' : ''}><i class="ti ti-chevron-right"></i></button></div></div>
 <div class="fg"><h6>${L('Trade', 'التخصص')}</h6>${Object.keys(TR).map(k => ck('tr', k, L(TR[k][0], TR[k][1]), `<span class="d" style="background:var(--tone-${TR[k][2]}-solid)"></span>`)).join('')}</div>
 <div class="fg"><h6>${L('Work Item Type', 'نوع العنصر')}</h6>${Object.keys(TY).map(k => ck('ty', k, L(TY[k][0], TY[k][1]))).join('')}</div>
 <div class="fg"><h6>${L('Company', 'الشركة')}${r.co ? `<small>${L('Only your company', 'شركتك فقط')}</small>` : ''}</h6>${cos.map(k => ck('co', k, L(CO[k][0], CO[k][1]), `<span class="av" style="background:${CO[k][2]}">${RS.ini(CO[k][0])}</span>`)).join('')}</div>
 <div class="fg"><h6>${L('Stage', 'المرحلة')}</h6><div class="stg">${[['', L('All stages', 'جميع المراحل')], ...Object.keys(STAGE).map(k => [k, L(STAGE[k][0], STAGE[k][1])])].map(s => `<button class="ck2${V.stage === s[0] ? ' on' : ''}" data-stage="${s[0]}"><span class="bx" style="border-radius:50%;${V.stage === s[0] ? 'background:var(--fld-bg);box-shadow:inset 0 0 0 5px var(--ctl-on)' : ''}"></span>${s[1]}</button>`).join('')}</div></div>
 </div></aside>${V.ff ? '<div class="scrim2" data-act="ff"></div>' : ''}`;
  }
  /* ---- building ---- */
  function stack(M) {
    const hotMode = V.mode === 'issues';
    const row = m => {
      const f = m.f,
        hot = m.c.iss > 0;
      const cls = [f.id === 'rf' ? 'roof' : '', f.id === 'gf' ? 'gf' : '', f.below ? 'below' : '', V.sel === f.id ? 'sel' : '', hotMode ? hot ? 'hot' : 'dim' : ''].join(' ');
      return `<div class="fl ${cls}" data-fl="${f.id}"><span class="nm"><b>${fname(f)}</b><small>${f.lv}</small></span><span class="tiles2">${m.spaces.map(s => tile(s, hotMode && s.st !== 'iss')).join('')}</span>${cnts(m.c, 0)}<button class="go" data-drill="${f.id}" title="${L('Open Plan View', 'فتح عرض المخطط')}"><i class="ti ti-chevron-right"></i></button></div>${f.id === 'gf' ? `<div class="grd"><span>${L('Ground level', 'منسوب الأرض')}</span></div>` : ''}`;
    };
    return `<div class="bld" style="--z:${V.z}"><div class="bld-sky"></div>${M.map(row).join('')}<div class="fl-last"></div></div>`;
  }
  function list(M) {
    const hotMode = V.mode === 'issues';
    return `<div class="fl-grid" style="zoom:${V.z}">${M.map(m => {
      const f = m.f,
        hot = m.c.iss > 0;
      return `<div class="fcard${V.sel === f.id ? ' sel' : ''}${hotMode ? hot ? ' hot' : ' dim' : ''}" data-fl="${f.id}"><div class="h"><span class="lv">${f.lv}</span><div><b>${fname(f)}</b><small>${m.spaces.length} ${L('spaces', 'مساحات')}</small></div>${chipS(worst(m.c))}</div><span class="tiles2" style="--z:.9">${m.spaces.map(s => tile(s, hotMode && s.st !== 'iss')).join('')}</span>${cnts(m.c, 0)}<div class="ft"><span>${L('Tap for trades', 'انقر لعرض التخصصات')}</span><span class="lnk" data-drill="${f.id}">${L('Plan View', 'عرض المخطط')}<i class="ti ti-chevron-right"></i></span></div></div>`;
    }).join('')}</div>`;
  }
  function legend() {
    return `<div class="legend" data-stop><h6>${L('Location status', 'حالة الموقع')}</h6>${['done', 'prog', 'iss', 'pend'].map(k => `<div class="lgr"><span class="tile ${k}" style="${k === 'pend' ? '' : `background:${ST[k].c}`}"><i class="ti ${ST[k].ic}"></i></span><div><b>${L(ST[k].en, ST[k].ar)}</b><span>${L(ST[k].den, ST[k].dar)}</span></div></div>`).join('')}<div class="note"><i class="ti ti-eye"></i>${L('Counts include only work your company can see.', 'تشمل الأرقام فقط الأعمال المرئية لشركتك.')}</div></div>`;
  }
  function canvas(M) {
    const empty = bld().empty;
    return `<section class="fv-card fv-canvas"><div class="fv-scroll" id="fvs">${V.layout === 'stack' ? stack(M) : list(M)}</div>
 ${empty ? `<div class="fv-empty"><div class="emp"><span class="ic"><i class="ti ti-building-skyscraper"></i></span><h2>${L('No Work Items on Tower 2 yet', 'لا توجد عناصر عمل في البرج ٢ بعد')}</h2><p>${L('Floors light up here as soon as inspections, snags or submittals are tagged with a Location in this building.', 'تظهر حالة الطوابق هنا فور وسم الفحوصات أو الملاحظات أو التقديمات بموقع في هذا المبنى.')}</p><div class="row"><a class="cb pri" href="submittals-list.html"><i class="ti ti-plus"></i>${L('Add Submittal', 'إضافة تقديم')}</a><button class="cb" data-bld="t1">${L('Back to Tower 1', 'العودة إلى البرج ١')}</button></div></div></div>` : ''}
 ${V.legend ? legend() : ''}
 <div class="fv-ctl"><div class="grp"><button class="${V.legend ? 'on' : ''}" data-act="legend"><i class="ti ti-info-circle"></i>${L('Legend', 'المفتاح')}</button></div><div class="grp"><button data-zoom="-1" title="${L('Zoom out', 'تصغير')}"><i class="ti ti-zoom-out"></i></button><button class="zl" data-zoom="0">${Math.round(V.z * 100)}%</button><button data-zoom="1" title="${L('Zoom in', 'تكبير')}"><i class="ti ti-zoom-in"></i></button></div></div></section>`;
  }
  /* ---- spotlights ---- */
  const PR = {
    high: ['High', 'عالية', 'red'],
    med: ['Medium', 'متوسطة', 'orange'],
    low: ['Low', 'منخفضة', 'gray']
  };
  function issues() {
    const out = {
      open: [],
      res: []
    };
    if (bld().empty) return out;
    FL.forEach(f => f.spaces.forEach(s => s.items.forEach(it => {
      if (!it.is || !vis(it)) return;
      const x = {
        it,
        f,
        s,
        d: IS[it.is],
        id: f.id + s.k + it.is
      };
      if (it.res === 'closed') out.res.push(x);else out.open.push(x);
    })));
    const po = {
      high: 0,
      med: 1,
      low: 2
    };
    const srt = a => a.sort((a, b) => po[a.d.p] - po[b.d.p] || b.it.age - a.it.age);
    srt(out.open);
    srt(out.res);
    return out;
  }
  function spot() {
    const I = issues();
    let ls = I[V.tab];
    if (V.sel) ls = ls.filter(x => x.f.id === V.sel);
    const b = bld();
    return `<aside class="fv-card fv-spot"><div class="ff-hd"><i class="ti ti-flag"></i>${L('Spotlights', 'أبرز المشكلات')}<span style="margin-inline-start:auto;font:500 12px var(--font-ui);color:var(--ui-muted)">${L(b.en, b.ar)}</span></div>
 <div class="sl-tabs"><button class="${V.tab === 'open' ? 'on' : ''}" data-tab2="open">${L('Open', 'مفتوحة')}<span class="n">${I.open.length}</span></button><button class="${V.tab === 'res' ? 'on' : ''}" data-tab2="res">${L('Resolved', 'محلولة')}<span class="n">${I.res.length}</span></button></div>
 ${V.sel ? `<span class="fchip"><i class="ti ti-stairs"></i>${fname(FL.find(f => f.id === V.sel))}<button data-act="desel"><i class="ti ti-x"></i></button></span>` : ''}
 <div class="sl-ls">${ls.length ? ls.map(x => {
      const t = TR[x.it.tr],
        p = PR[x.d.p],
        o = V.open === x.id,
        fail = x.it.type === 'insp';
      return `<div class="sl${o ? ' open' : ''}" data-sl="${x.id}"><div class="h"><span class="pr" style="background:var(--tone-${p[2]}-solid)"></span><b>${esc(L(x.d.t[0], x.d.t[1]))}</b><i class="ti ti-chevron-down"></i></div><p>${esc(L(x.d.d[0], x.d.d[1]))}</p>
  <div class="chips2"><span class="lc"><i class="ti ti-map-pin"></i>${L('Zone A', 'المنطقة أ')}</span><span class="lc"><i class="ti ti-building-skyscraper"></i>${L(b.en, b.ar)}</span><span class="lc"><i class="ti ti-stairs"></i>${fname(x.f)}</span><span class="lc">${L(SP[x.s.k][0], SP[x.s.k][1])}</span></div>
  <div class="mt"><span class="chip" style="height:20px;font-size:11px;background:var(--tone-${t[2]}-tint);color:var(--tone-${t[2]}-fg)">${L(t[0], t[1])}</span><span class="co"><span class="av" style="background:${CO[x.it.co][2]}">${RS.ini(CO[x.it.co][0])}</span>${L(CO[x.it.co][0], CO[x.it.co][1])}</span><span class="prl pl" style="background:var(--tone-${p[2]}-tint);color:var(--tone-${p[2]}-fg)">${L(p[0], p[1])}</span></div>
  <div class="more"><div class="kv"><span>${L('Type', 'النوع')}</span><b>${fail ? L('Failed inspection', 'فحص راسب') : L('Snag', 'ملاحظة')}</b><span>${L('Assigned to', 'مسند إلى')}</span><b>${L(CO[x.it.co][0], CO[x.it.co][1])}</b><span>${x.it.res === 'closed' ? L('Resolved', 'حُلّت') : L('Open for', 'مفتوحة منذ')}</span><b>${x.it.res === 'closed' ? L('Week ', 'الأسبوع ') + x.it.wk : x.it.age + L(' days', ' يومًا')}</b></div><div class="acts"><button class="cb sm" data-fl="${x.f.id}" data-focus="1"><i class="ti ti-stairs"></i>${L('Show floor', 'عرض الطابق')}</button><button class="cb sm pri" data-drill="${x.f.id}"><i class="ti ti-vector"></i>${L('Plan View', 'عرض المخطط')}</button></div></div></div>`;
    }).join('') : `<div class="none">${V.tab === 'open' ? L('No open issues you can see on this building.', 'لا توجد مشكلات مفتوحة مرئية لك في هذا المبنى.') : L('Nothing resolved yet.', 'لا شيء محلول بعد.')}</div>`}</div>
 <div class="sl-ft"><span class="rel" style="flex:1;display:flex"><button class="cb" style="flex:1" data-menu="exp"><i class="ti ti-file-download"></i>${L('Export', 'تصدير')}<i class="ti ti-chevron-down"></i></button>${V.menu === 'exp' ? `<div class="pop" data-stop style="top:auto;bottom:calc(100% + 6px)"><button class="mi" data-exp="pdf"><i class="ti ti-file-text"></i>${L('Download PDF', 'تنزيل PDF')}</button><button class="mi" data-exp="mail"><i class="ti ti-send"></i>${L('Email to me', 'إرسال إلى بريدي')}</button></div>` : ''}</span></div></aside>`;
  }
  /* ---- popover ---- */
  function pop(m, pin) {
    const byT = {};
    m.spaces.forEach(s => s.items.forEach(it => {
      const r = byT[it.tr] = byT[it.tr] || {
        done: 0,
        prog: 0,
        iss: 0
      };
      if (it.res === 'closed') return;
      if (it.type === 'snag' && it.res === 'open' || it.res === 'failed') r.iss++;else if (it.res === 'open') r.prog++;else if (it.res === 'passed') r.done++;
    }));
    const rows = Object.entries(byT);
    return `<div class="h"><b>${fname(m.f)}</b>${chipS(worst(m.c))}<small>${m.f.lv}</small></div>${rows.length ? `<table><thead><tr><th>${L('Trade', 'التخصص')}</th>${['done', 'prog', 'iss'].map(k => `<th style="color:${ST[k].f}"><i class="ti ${ST[k].ic}"></i></th>`).join('')}</tr></thead><tbody>${rows.map(([k, r]) => `<tr><td><span class="d" style="background:var(--tone-${TR[k][2]}-solid)"></span>${L(TR[k][0], TR[k][1])}</td>${['done', 'prog', 'iss'].map(s => `<td class="${r[s] ? '' : 'z'}">${r[s]}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<div class="none" style="padding:12px">${L('No work items you can see on this floor.', 'لا توجد عناصر عمل مرئية لك في هذا الطابق.')}</div>`}${pin ? `<div class="ft"><button class="cb sm" data-act="desel">${L('Close', 'إغلاق')}</button><button class="cb sm pri" data-drill="${m.f.id}"><i class="ti ti-vector"></i>${L('Open Plan View', 'فتح عرض المخطط')}</button></div>` : ''}`;
  }
  function drill() {
    const f = FL.find(x => x.id === V.drill);
    return `<div class="drill"><div class="emp"><span class="ic"><i class="ti ti-vector"></i></span><h2>${L('Plan View', 'عرض المخطط')} · ${fname(f)}</h2><p>${L(`Clicking a floor drills into its plan drawing: spaces and components of ${f.en} with Work Items pinned where they are. Plan View is designed next.`, `النقر على الطابق ينقلك إلى مخططه: مساحات ومكونات ${f.ar} مع عناصر العمل مثبتة في أماكنها. عرض المخطط هو التالي في التصميم.`)}</p><div class="row"><button class="cb pri" data-act="undrill"><i class="ti ti-arrow-left"></i>${L('Back to Floor View', 'العودة إلى عرض الطوابق')}</button></div></div></div>`;
  }
  function view() {
    const M = model();
    const t = V.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>` : '';
    if (V.drill) return toolbar() + drill() + t;
    const sm = V.sel && M.find(m => m.f.id === V.sel);
    return `${toolbar()}<div class="fv-body">${filters()}${canvas(M)}${spot()}</div>${sm ? `<div class="fpop pin" id="fpin" data-stop>${pop(sm, 1)}</div>` : ''}<div class="fpop" id="fhov" style="display:none"></div>${t}`;
  }
  function place(el, row) {
    if (!el || !row) return;
    const r = row.getBoundingClientRect(),
      w = 300,
      rtl = document.documentElement.dir === 'rtl';
    const h = el.offsetHeight;
    let top = Math.min(Math.max(8, r.top), innerHeight - h - 8);
    const tiles = row.querySelector('.tiles2');
    const tr = (tiles || row).getBoundingClientRect();
    let x = rtl ? tr.left - w - 12 : tr.right + 12;
    if (!rtl && x + w > innerWidth - 8) x = Math.max(8, tr.left);
    if (rtl && x < 8) x = tr.right - w;
    if (V.layout === 'list') {
      x = rtl ? r.left - w - 10 : r.right + 10;
      if (x + w > innerWidth - 8 || x < 8) x = Math.min(innerWidth - w - 8, Math.max(8, r.left));
      top = Math.min(r.bottom + 6, innerHeight - h - 8);
    }
    el.style.top = top + 'px';
    el.style.left = x + 'px';
  }
  function after() {
    if (V.sel) place(document.getElementById('fpin'), document.querySelector(`[data-fl="${V.sel}"]`));
  }
  function bind(root, R) {
    let tt;
    const flash = m => {
      V.toast = m;
      R.inner();
      clearTimeout(tt);
      tt = setTimeout(() => {
        V.toast = null;
        R.inner();
      }, 2200);
    };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-menu],[data-bld],[data-role],[data-act],[data-view],[data-mode2],[data-layout],[data-ck],[data-stage],[data-wk],[data-zoom],[data-tab2],[data-drill],[data-sl],[data-fl],[data-exp]');
      if (!b) {
        if (V.menu || V.legend) {
          V.menu = null;
          V.legend = false;
          R.inner();
        }
        return;
      }
      if (b.closest('.hd,.tabs,.sb')) return;
      const d = b.dataset;
      if (d.menu) {
        V.menu = V.menu === d.menu ? null : d.menu;
        return R.inner();
      }
      if (d.drill) {
        e.stopPropagation();
        location.href = 'plan-view.html?fl=' + (['rf', 'gf', '01', '02', '03'].includes(d.drill) ? d.drill : '02');
        return;
      }
      if (d.bld) {
        V.bld = d.bld;
        V.menu = null;
        V.sel = null;
        return R.inner();
      }
      if (d.role) {
        V.role = d.role;
        V.menu = null;
        V.co = new Set();
        V.sel = null;
        return R.inner();
      }
      if (d.view) {
        if (d.view === 'map') {
          location.href = 'map-view.html';
          return;
        }
        if (d.view === 'plan') {
          location.href = 'plan-view.html' + (V.sel && ['rf', 'gf', '01', '02', '03'].includes(V.sel) ? '?fl=' + V.sel : '');
          return;
        }
        V.drill = null;
        S.mv = 'floor';
        return R.full();
      }
      if (d.mode2) {
        V.mode = d.mode2;
        return R.inner();
      }
      if (d.layout) {
        V.layout = d.layout;
        return R.inner();
      }
      if (d.ck) {
        const [s, k] = d.ck.split(':');
        V[s].has(k) ? V[s].delete(k) : V[s].add(k);
        return R.inner();
      }
      if (d.stage !== undefined) {
        V.stage = d.stage;
        return R.inner();
      }
      if (d.wk) {
        V.wk = Math.max(26, Math.min(39, V.wk + +d.wk));
        return R.inner();
      }
      if (d.zoom !== undefined) {
        const z = +d.zoom;
        V.z = z === 0 ? 1 : Math.max(.75, Math.min(1.5, Math.round((V.z + z * .125) * 1000) / 1000));
        return R.inner();
      }
      if (d.tab2) {
        V.tab = d.tab2;
        V.open = null;
        return R.inner();
      }
      if (d.exp) {
        V.menu = null;
        return flash(d.exp === 'pdf' ? L('Spotlights exported to PDF', 'تم تصدير أبرز المشكلات إلى PDF') : L('Spotlights emailed to mohamed@alfuttaim.ae', 'تم إرسال أبرز المشكلات إلى بريدك'));
      }
      if (d.fl && !b.closest('.sl') && !b.classList.contains('sl')) {
        V.sel = V.sel === d.fl ? null : d.fl;
        V.open = null;
        return R.inner();
      }
      if (d.fl && d.focus) {
        V.sel = d.fl;
        R.inner();
        const row = document.querySelector(`[data-fl="${d.fl}"]`);
        const sc = document.getElementById('fvs');
        if (row && sc) sc.scrollTop = row.offsetTop - 80;
        after();
        return;
      }
      if (d.sl) {
        V.open = V.open === d.sl ? null : d.sl;
        return R.inner();
      }
      const a = d.act;
      if (a === 'undrill') {
        V.drill = null;
        S.mv = 'floor';
        return R.full();
      }
      if (a === 'legend') {
        V.legend = !V.legend;
        return R.inner();
      }
      if (a === 'desel') {
        V.sel = null;
        return R.inner();
      }
      if (a === 'clearf') {
        V.tr = new Set();
        V.ty = new Set();
        V.co = new Set();
        V.stage = '';
        return R.inner();
      }
      if (a === 'ff') {
        V.ff = !V.ff;
        return R.inner();
      }
      if (a === 'elec') {
        V.menu = null;
        V.tr = new Set(['EL']);
        return R.inner();
      }
      if (a === 'tablet') {
        V.tablet = !V.tablet;
        V.menu = null;
        return R.full();
      }
    });
    root.addEventListener('mouseover', e => {
      const row = e.target.closest('[data-fl]');
      const hv = document.getElementById('fhov');
      if (!hv) return;
      if (!row || row.closest('.sl') || row.dataset.fl === V.sel || e.target.closest('.fpop')) {
        hv.style.display = 'none';
        return;
      }
      const m = model().find(x => x.f.id === row.dataset.fl);
      hv.innerHTML = pop(m, 0);
      hv.style.display = 'block';
      place(hv, row);
    });
    root.addEventListener('mouseleave', () => {
      const hv = document.getElementById('fhov');
      hv && (hv.style.display = 'none');
    }, true);
    root.addEventListener('scroll', () => {
      const hv = document.getElementById('fhov');
      hv && (hv.style.display = 'none');
      after();
    }, true);
    addEventListener('resize', after);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        V.sel = null;
        V.menu = null;
        V.legend = false;
        V.ff = false;
        R.inner();
      }
    });
  }
  window.FV = {
    V,
    view,
    bind,
    after
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/floor/floor.js", error: String((e && e.message) || e) }); }

// ui_kits/app/list/filter-panel.js
try { (() => {
// Rabaed — filter panel (Basic/Advanced, saved filters, field list + values). mountFilter(el, {fields, saved, preset, extra, sel, L, onChange, onDone})
(function () {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const dotsHtml = p => '<span class="fdots">' + p.split('').map(c => '<i class="' + (c === '_' ? '' : c) + '"></i>').join('') + '</span>';
  window.mountFilter = function (root, o) {
    o = o || {};
    const L = o.L || (e => e);
    const S = {
      tab: 'basic',
      field: o.fields.find(f => !f.sep).k,
      sel: o.sel || {},
      q: '',
      saved: false,
      sq: '',
      active: null,
      fields: o.fields.slice(),
      addOpen: false
    };
    const count = () => Object.values(S.sel).filter(v => v && v.length).length;
    const lab = op => op.l || op[0];
    function optMark(f, op) {
      const x = op[1];
      if (f.mark === 'dot') return '<span class="fsd" style="background:' + x + '"></span>';
      if (f.mark === 'chip') return '<span class="chip" style="height:20px;font-size:11px;background:var(--tone-' + x + '-tint);color:var(--tone-' + x + '-fg)">' + esc(op[2] || '') + '</span>';
      if (f.mark === 'av') return '<span class="fav" style="background:' + x + '">' + (op.av || op[3] || op[0]).split(' ').slice(0, 2).map(w => w[0]).join('') + '</span>';
      if (f.mark === 'days') return dotsHtml(x);
      if (f.mark === 'ic') return '<i class="ti ' + x + '"></i>';
      return '<i class="ti ' + (f.icon || 'ti-file-text') + '"></i>';
    }
    function render() {
      const f = S.fields.find(x => x.k === S.field) || S.fields.find(x => !x.sep),
        sel = S.sel[f.k] || [];
      const opts = f.opts.filter(op => (op[3] || op[0]).toLowerCase().includes(S.q.toLowerCase()));
      const savedList = arr => arr.filter(n => n.toLowerCase().includes(S.sq.toLowerCase())).map(n => '<button class="fp-sv' + (S.active === n ? ' on' : '') + '" data-sv="' + esc(n) + '">' + esc(n) + (S.active === n ? '<i class="ti ti-check"></i>' : '') + '</button>').join('');
      const n = count();
      root.innerHTML = '<div class="fp">' + '<div class="fp-hd">' + '<div class="fp-tabs"><button data-tab="basic" class="' + (S.tab === 'basic' ? 'on' : '') + '">' + L('Basic', 'أساسي') + '</button><button data-tab="adv" class="' + (S.tab === 'adv' ? 'on' : '') + '">' + L('Advanced', 'متقدم') + '</button></div>' + '<div class="fp-act"><div class="fp-svw"><button class="fp-svb' + (S.saved ? ' on' : '') + '" data-a="saved">' + (S.active ? esc(S.active) : L('Saved filters', 'الفلاتر المحفوظة')) + '<i class="ti ti-chevron-down"></i></button>' + (S.saved ? '<div class="fp-svm"><label class="fp-srch"><i class="ti ti-search"></i><input data-i="sq" placeholder="' + L('Search filters', 'ابحث في الفلاتر') + '" value="' + esc(S.sq) + '"></label><div class="fp-svl"><div class="fp-gh"><i class="ti ti-star"></i>' + L('Starred filters', 'الفلاتر المميزة') + '</div>' + savedList(o.saved.starred) + '<div class="fp-gh"><i class="ti ti-user"></i>' + L('My filters', 'فلاتري') + '</div>' + savedList(o.saved.mine) + '</div><button class="fp-all" data-a="all"><i class="ti ti-list"></i>' + L('View all saved filters', 'عرض كل الفلاتر المحفوظة') + '<i class="ti ti-arrow-right"></i></button></div>' : '') + '</div><button class="fp-save" data-a="save"' + (n ? '' : ' disabled') + '><i class="ti ti-star"></i>' + L('Save', 'حفظ') + '</button></div>' + '</div>' + (S.tab === 'basic' ? '<div class="fp-bd"><div class="fp-fields">' + S.fields.map(x => x.sep ? '<div class="fp-sep"></div>' : '<button class="fp-f' + (x.k === f.k ? ' on' : '') + '" data-f="' + x.k + '"><span>' + x.n + '<small>' + x.a + '</small></span>' + ((S.sel[x.k] || []).length ? '<b>' + S.sel[x.k].length + '</b>' : '') + '</button>').join('') + ((o.extra || []).some(e => !S.fields.some(x => x.k === e.k)) ? '<div class="fp-addw"><button class="fp-add" data-a="add"><i class="ti ti-plus"></i>' + L('Add field', 'إضافة حقل') + '</button>' + (S.addOpen ? '<div class="fp-addm">' + o.extra.filter(e => !S.fields.some(x => x.k === e.k)).map(e => '<button data-ad="' + e.k + '">' + e.n + '<small>' + e.a + '</small></button>').join('') + '</div>' : '') + '</div>' : '') + '<button class="fp-clear" data-a="clear"' + (n ? '' : ' disabled') + '>' + L('Clear all', 'مسح الكل') + '</button>' + '</div><div class="fp-opts">' + '<div class="fp-oh">' + f.n + '<small>' + f.a + '</small>' + (sel.length ? '<button data-a="clrf">' + L('Clear', 'مسح') + '</button>' : '') + '</div>' + (f.opts.length > 5 ? '<label class="fp-srch sm"><i class="ti ti-search"></i><input data-i="q" placeholder="' + L('Search', 'بحث') + '" value="' + esc(S.q) + '"></label>' : '') + '<div class="fp-ol">' + opts.map(op => {
        const on = sel.includes(op[0]);
        return '<button class="fp-o' + (on ? ' on' : '') + '" data-o="' + esc(op[0]) + '"><span class="fck' + (f.single ? ' rd' : '') + '">' + (on ? '<i class="ti ti-check"></i>' : '') + '</span>' + optMark(f, op) + '<span class="fpl">' + esc(op[3] || op[0]) + '</span></button>';
      }).join('') + (opts.length ? '' : '<div class="fp-none">' + L('No matches', 'لا نتائج') + '</div>') + '</div>' + '</div></div>' : '<div class="fp-adv">' + (Object.entries(S.sel).filter(([k, v]) => v && v.length).map(([k, v], i) => {
        const f2 = S.fields.find(x => x.k === k) || {
          n: k
        };
        return '<div class="fp-rule"><span class="w' + (i ? ' and' : '') + '">' + (i ? L('AND', 'و') : L('Where', 'حيث')) + '</span><span class="pill">' + f2.n + '</span><span class="op">' + (v.length > 1 ? L('is any of', 'أي من') : L('is', 'يساوي')) + '</span><span class="pill v">' + esc(v.map(x => {
          const op = (f2.opts || []).find(p => p[0] === x);
          return op && op[3] || x;
        }).join(', ')) + '</span></div>';
      }).join('') || '<div class="fp-none">' + L('No rules yet — pick values in Basic, or add a rule.', 'لا قواعد بعد') + '</div>') + '<button class="fp-add"><i class="ti ti-plus"></i>' + L('Add rule', 'إضافة قاعدة') + '</button></div>') + '<div class="fp-ft"><span>' + (n ? n + ' ' + L(n > 1 ? 'filters applied' : 'filter applied', 'فلاتر مطبقة') : L('No filters applied', 'لا فلاتر مطبقة')) + '</span><button class="fp-done" data-a="done">' + L('Done', 'تم') + '</button></div>' + '</div>';
    }
    const emit = () => o.onChange && o.onChange(S.sel, count());
    root.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      e.stopPropagation();
      if (b.dataset.tab) {
        S.tab = b.dataset.tab;
      } else if (b.dataset.f) {
        S.field = b.dataset.f;
        S.q = '';
      } else if (b.dataset.o) {
        const f = S.fields.find(x => x.k === S.field),
          cur = S.sel[f.k] || [],
          v = b.dataset.o;
        S.sel[f.k] = f.single ? cur[0] === v ? [] : [v] : cur.includes(v) ? cur.filter(x => x !== v) : cur.concat(v);
        S.active = null;
        emit();
      } else if (b.dataset.sv) {
        S.active = b.dataset.sv;
        S.sel = JSON.parse(JSON.stringify((o.preset || {})[S.active] || {}));
        S.saved = false;
        emit();
      } else if (b.dataset.ad) {
        const e2 = o.extra.find(x => x.k === b.dataset.ad);
        S.fields.push(e2);
        S.field = e2.k;
        S.addOpen = false;
      } else {
        const a = b.dataset.a;
        if (a === 'saved') {
          S.saved = !S.saved;
          S.sq = '';
        }
        if (a === 'add') S.addOpen = !S.addOpen;
        if (a === 'clear') {
          S.sel = {};
          S.active = null;
          emit();
        }
        if (a === 'clrf') {
          S.sel[S.field] = [];
          S.active = null;
          emit();
        }
        if (a === 'save') {
          b.innerHTML = '<i class="ti ti-check"></i>' + L('Saved', 'تم الحفظ');
          return;
        }
        if (a === 'done') {
          o.onDone && o.onDone();
          return;
        }
        if (a === 'all') {
          S.saved = false;
        }
      }
      render();
    });
    root.addEventListener('input', e => {
      const i = e.target.dataset.i;
      if (!i) return;
      S[i] = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const n = root.querySelector('[data-i="' + i + '"]');
      if (n) {
        n.focus();
        n.setSelectionRange(pos, pos);
      }
    });
    render();
    return {
      S,
      count,
      render,
      set(sel) {
        S.sel = sel;
        render();
      }
    };
  };
  // popover helper: toggles a single floating panel under a button
  window.FPop = {
    el: null,
    api: null,
    btn: null,
    open(btn, opts) {
      this.close();
      const el = document.createElement('div');
      el.className = 'fpop';
      document.body.appendChild(el);
      this.el = el;
      this.btn = btn;
      const scope = btn.closest('.rs');
      if (scope) {
        el.className = 'fpop ' + [...scope.classList].filter(c => c === 'theme-dark').join(' ');
        el.dir = scope.getAttribute('dir') || 'ltr';
        el.setAttribute('lang', scope.getAttribute('lang') || 'en');
        ['--t', '--ink', '--ink2', '--mut', '--faint', '--line', '--line2'].forEach(v => el.style.setProperty(v, getComputedStyle(scope).getPropertyValue(v)));
      }
      const done = opts.onDone;
      opts.onDone = () => {
        this.close();
        done && done();
      };
      this.api = mountFilter(el, opts);
      this.place();
      return this.api;
    },
    place() {
      if (!this.el || !this.btn || !document.body.contains(this.btn)) return;
      const r = this.btn.getBoundingClientRect(),
        w = Math.min(600, innerWidth - 16);
      const rtl = this.el.dir === 'rtl';
      let x = rtl ? r.right - w : r.left;
      x = Math.max(8, Math.min(x, innerWidth - w - 8));
      this.el.style.left = x + 'px';
      this.el.style.top = Math.min(r.bottom + 8, innerHeight - 200) + 'px';
      this.el.style.maxHeight = innerHeight - r.bottom - 16 + 'px';
    },
    close() {
      if (this.el) {
        this.el.remove();
        this.el = null;
        this.api = null;
      }
    },
    isOpen() {
      return !!this.el;
    }
  };
  addEventListener('resize', () => FPop.place());
  document.addEventListener('mousedown', e => {
    if (FPop.el && !FPop.el.contains(e.target) && !(e.target.closest && e.target.closest('[data-fpop]'))) FPop.close();
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/list/filter-panel.js", error: String((e && e.message) || e) }); }

// ui_kits/app/list/kanban.js
try { (() => {
// Submittals — Kanban view, sharing data/toolbar with list.js
(function () {
  const LV = window.LV,
    V = LV.V,
    S = RS.S;
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  LV.mode = 'kanban';
  const COLS = ['draft', 'internal', 'resub', 'pending', 'approved', 'rejected'];
  const ROLE = {
    ce: ['Contractor Engineer', 'مهندس المقاول', 'blue'],
    cpm: ['Contractor PM', 'مدير مشروع المقاول', 'violet'],
    cons: ['Consultant', 'الاستشاري', 'green'],
    coe: ['Consultant Engineer', 'مهندس الاستشاري', 'green'],
    copm: ['Consultant PM', 'مدير مشروع الاستشاري', 'cyan']
  };
  const STROLES = {
    draft: [],
    internal: ['ce', 'cpm'],
    resub: ['ce', 'cpm'],
    pending: ['coe', 'copm'],
    approved: [],
    rejected: ['coe', 'copm']
  };
  {
    const cnt = {};
    LV.rows.forEach(r => {
      const rl = STROLES[r.st];
      cnt[r.st] = (cnt[r.st] || 0) + 1;
      r.role = rl.length ? rl[cnt[r.st] % rl.length] : null;
    });
  }
  V.kopen = V.kopen || {};
  function roleOf(r) {
    const rl = STROLES[r.st];
    return rl.includes(r.role) ? r.role : rl[0];
  }
  function card(r) {
    const d = LV.DISC[r.disc],
      c = r.code && LV.CODE[r.code];
    const p = LV.PEOPLE[r.owner];
    const end = c ? `<span class="chip" style="height:22px;background:var(--tone-${c[0]}-${c[1] ? 'solid' : 'tint'});color:${c[1] ? '#fff' : `var(--tone-${c[0]}-fg)`}"><span class="ti ${c[2]}"></span>Code ${r.code}</span>` : r.rev !== 'R0' ? `<span class="chip" style="height:22px;background:var(--rev-pill-bg);color:var(--rev-pill-fg);font-weight:700">${r.rev}</span>` : '';
    return `<div class="kc${r.st === 'approved' && r.code === 'A' ? ' ok' : ''}" draggable="true" data-card="${r.id}">
 <div class="r1"><i class="ti ti-file-text"></i>${r.id}<span class="end">${LV.cell(r, 'days').split('</span>')[0]}</span>${end}</span></div>
 <div class="tt">${esc(LV.val(r, 'title'))}</div>
 <div class="r2"><span class="chip" style="background:var(--tone-${d[2]}-tint);color:var(--tone-${d[2]}-fg)">${L(d[0], d[1])} (${r.disc})</span><span class="doc">${r.type}</span></div>
 <div class="loc"><span class="lt"><i class="ti ti-map"></i>${L('Zone', 'المنطقة')} ${r.zone}</span><span class="lt"><i class="ti ti-building"></i>${L('Building', 'المبنى')} ${r.bldg}</span><span class="lt"><i class="ti ti-stairs"></i>${L('Floor', 'الطابق')} ${r.floor}</span></div>
 <div class="r3"><span class="av" style="width:22px;height:22px;font-size:9px;background:${p[2]}">${RS.ini(p[0])}</span><span class="nm">${L(p[0], p[1])}</span><span class="dt"><i class="ti ti-calendar-event"></i>${LV.fmtD(r.created)}</span></div>
 </div>`;
  }
  function board() {
    const list = LV.filtered();
    const g = V.kgroup;
    return `<div class="kb">${COLS.map(st => {
      const s = LV.ST[st];
      const rs = list.filter(r => r.st === st);
      let inner = '';
      if (!rs.length) inner = `<div class="kempty">${L('No submittals', 'لا توجد تقديمات')}</div>`;else if (!STROLES[st].length) {
        if (g) {
          const grp = {};
          rs.forEach(r => {
            const k = LV.val(r, g);
            (grp[k] = grp[k] || []).push(r);
          });
          inner = Object.entries(grp).map(([k, b]) => `<div class="klane">${esc(k)}<span class="gcnt">${b.length}</span></div>${b.map(card).join('')}`).join('');
        } else inner = `<div class="krb">${rs.map(card).join('')}</div>`;
      } else inner = STROLES[st].map(rk => {
        const a = rs.filter(r => roleOf(r) === rk);
        if (!a.length) return '';
        const R = ROLE[rk],
          key = st + ':' + rk,
          open = V.kopen[key] !== false;
        let cards;
        if (g) {
          const grp = {};
          a.forEach(r => {
            const k = LV.val(r, g);
            (grp[k] = grp[k] || []).push(r);
          });
          cards = Object.entries(grp).map(([k, b]) => `<div class="klane">${esc(k)}<span class="gcnt">${b.length}</span></div>${b.map(card).join('')}`).join('');
        } else cards = a.map(card).join('');
        return `<div class="krole${open ? ' open' : ''}"><button class="krh" data-krole="${key}" aria-expanded="${open}"><span class="rd" style="background:var(--tone-${R[2]}-solid)"></span>${L(R[0], R[1])}<span class="rc">${a.length}</span><i class="ti ti-chevron-down"></i></button>${open ? `<div class="krb">${cards}</div>` : ''}</div>`;
      }).join('');
      return `<section class="kcol" data-colst="${st}"><div class="kch"><span class="d" style="background:var(--status-${s[2]}-dot)"></span>${L(s[0], s[1])}<span class="n">${rs.length}</span><button class="cb ter sm ic" title="${L('Add', 'إضافة')}"><i class="ti ti-plus"></i></button></div><div class="klist">${inner}</div></section>`;
    }).join('')}</div>`;
  }
  LV.kview = () => `${LV.toolbar('kanban')}${board()}${V.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>` : ''}`;
  LV.kbind = root => {
    let drag = null;
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-krole]');
      if (!b) return;
      e.stopPropagation();
      const k = b.dataset.krole;
      V.kopen[k] = V.kopen[k] === false;
      LV.render();
    }, true);
    root.addEventListener('dragstart', e => {
      const c = e.target.closest('.kc');
      if (!c) return;
      drag = c.dataset.card;
      c.classList.add('drag');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', drag);
    });
    root.addEventListener('dragover', e => {
      if (!drag) return;
      const col = e.target.closest('.kcol');
      if (!col) return;
      e.preventDefault();
      root.querySelectorAll('.kcol.over').forEach(x => x !== col && x.classList.remove('over'));
      col.classList.add('over');
    });
    root.addEventListener('drop', e => {
      if (!drag) return;
      const col = e.target.closest('.kcol');
      if (!col) return;
      e.preventDefault();
      const r = LV.rows.find(x => x.id === drag);
      const to = col.dataset.colst;
      if (r && r.st !== to) {
        r.st = to;
        r.role = STROLES[to][0] || null;
        if (to !== 'approved' && to !== 'rejected') r.code = '';else if (!r.code) r.code = to === 'approved' ? 'A' : 'D';
        r.days = 1;
        drag = null;
        LV.flash(L(`${r.id} moved to ${LV.ST[to][0]}`, `تم نقل ${r.id} إلى ${LV.ST[to][1]}`));
        return;
      }
      drag = null;
      LV.render();
    });
    root.addEventListener('dragend', () => {
      drag = null;
      root.querySelectorAll('.drag,.over').forEach(x => x.classList.remove('drag', 'over'));
    });
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/list/kanban.js", error: String((e && e.message) || e) }); }

// ui_kits/app/list/list.js
try { (() => {
// Submittals — List view. Uses RS (shell.js) for sidebar/header/tabs.
(function () {
  const S = RS.S;
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  const KEY = 'rb-list-v1',
    DEF = 'rb-list-default-v1';
  const COLS = [{
    id: 'no',
    en: 'Submittal No.',
    ar: 'رقم التقديم',
    lock: 1,
    w: 130
  }, {
    id: 'title',
    en: 'Title',
    ar: 'العنوان',
    lock: 1,
    w: 260
  }, {
    id: 'rev',
    en: 'Rev',
    ar: 'المراجعة',
    w: 70
  }, {
    id: 'disc',
    en: 'Discipline',
    ar: 'التخصص',
    w: 190
  }, {
    id: 'type',
    en: 'Type',
    ar: 'النوع',
    w: 80
  }, {
    id: 'status',
    en: 'Status',
    ar: 'الحالة',
    w: 190
  }, {
    id: 'code',
    en: 'Code',
    ar: 'الرمز',
    w: 100
  }, {
    id: 'zone',
    en: 'Zone',
    ar: 'المنطقة',
    w: 90
  }, {
    id: 'bldg',
    en: 'Building',
    ar: 'المبنى',
    w: 100
  }, {
    id: 'floor',
    en: 'Floor',
    ar: 'الطابق',
    w: 80
  }, {
    id: 'owner',
    en: 'Current owner',
    ar: 'المسؤول الحالي',
    w: 200
  }, {
    id: 'contractor',
    en: 'Contractor',
    ar: 'المقاول',
    w: 220,
    off: 1
  }, {
    id: 'created',
    en: 'Created',
    ar: 'تاريخ الإنشاء',
    w: 120
  }, {
    id: 'due',
    en: 'Due date',
    ar: 'تاريخ الاستحقاق',
    w: 120
  }, {
    id: 'days',
    en: 'Days in column',
    ar: 'الأيام في العمود',
    w: 130,
    off: 1
  }];
  const GROUPS = ['status', 'disc', 'type', 'owner', 'zone', 'code'];
  const ST = {
    draft: ['Draft', 'مسودة', 'draft'],
    internal: ['Internal Review', 'مراجعة داخلية', 'internal'],
    resub: ['Revised & Resubmitted', 'معاد تقديمها', 'resubmitted'],
    pending: ['Pending Approval', 'بانتظار الاعتماد', 'pending'],
    approved: ['Approved', 'معتمدة', 'approved'],
    rejected: ['Rejected', 'مرفوضة', 'rejected']
  };
  const DISC = {
    CV: ['Civil Works', 'أعمال مدنية', 'amber'],
    AR: ['Architecture', 'أعمال معمارية', 'violet'],
    EL: ['Electrical Works', 'أعمال كهربائية', 'cyan'],
    ME: ['Mechanical Works', 'أعمال ميكانيكية', 'green'],
    SU: ['Surveying', 'أعمال المساحة', 'orange']
  };
  const CODE = {
    A: ['green', 1, 'ti-circle-check'],
    B: ['green', 0, 'ti-circle-check'],
    C: ['amber', 0, 'ti-refresh'],
    D: ['red', 1, 'ti-circle-x']
  };
  const PEOPLE = [['Ahmed bin Said', 'أحمد بن سعيد', '#3d6db5'], ['Nasser Al Kaabi', 'ناصر الكعبي', '#e98b45'], ['Abdullah Al Saadi', 'عبدالله السعدي', '#7a5c3a'], ['Mohammed Al Shamsi', 'محمد الشامسي', '#1fae66'], ['Sarah Al Mansoori', 'سارة المنصوري', '#b5455a'], ['Khalid Al Dhaheri', 'خالد الظاهري', '#6b5ad8']];
  const CONTR = [['Al Futtaim Construction Co.', 'شركة الفطيم للمقاولات'], ['Arabtec', 'أرابتك'], ['ALEC Engineering', 'ألك للهندسة']];
  const TITLES = [['Fire Suppression System', 'نظام إطفاء الحريق', 'EL'], ['HVAC Ducting — Level 3', 'مجاري التكييف — الطابق ٣', 'ME'], ['Drainage System', 'نظام الصرف', 'CV'], ['Basement Waterproofing', 'العزل المائي للقبو', 'CV'], ['Concrete Mix Design C40', 'تصميم خلطة الخرسانة C40', 'CV'], ['Public Lighting Fixtures', 'وحدات الإنارة العامة', 'EL'], ['Curtain Wall System', 'نظام الواجهات الزجاجية', 'AR'], ['Chilled Water Pipes', 'أنابيب المياه المبردة', 'ME'], ['Façade Cladding Panels', 'ألواح تكسية الواجهة', 'AR'], ['Setting-out Survey — Tower', 'مسح التوقيع — البرج', 'SU'], ['Low Current Systems', 'أنظمة التيار المنخفض', 'EL'], ['Structural Steel Beams', 'الكمرات الفولاذية', 'CV'], ['Lift Installation', 'تركيب المصاعد', 'ME'], ['Ceramic Floor Tiles', 'بلاط الأرضيات السيراميك', 'AR']];
  const STK = Object.keys(ST);
  const rows = [];
  for (let i = 0; i < 42; i++) {
    const t = TITLES[i % TITLES.length];
    const st = STK[(i * 7 + 3) % 6];
    const rev = st === 'resub' ? 'R' + (1 + i % 3) : i % 5 === 0 ? 'R1' : 'R0';
    const code = st === 'approved' ? i % 2 ? 'A' : 'B' : st === 'rejected' ? i % 3 ? 'D' : 'C' : '';
    const d = new Date(2026, 7, 1 + i * 5 % 55);
    const due = new Date(d.getTime() + (10 + i % 12) * 864e5);
    rows.push({
      id: 'SUB-' + String(1280 + i).padStart(4, '0'),
      t,
      disc: t[2],
      type: ['MAR', 'SAR', 'DAR', 'DAS'][i % 4],
      st,
      rev,
      code,
      zone: 'ABC'[i % 3],
      bldg: String(1 + i % 3),
      floor: ['B2', 'B1', 'G', '1', '2', '3', '4', '5', 'R'][i % 9],
      owner: i % 6,
      ctr: i % 3,
      created: d,
      due,
      days: [1, 2, 3, 5, 8, 12, 20, 4, 6][i % 9]
    });
  }
  function initCols() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || JSON.parse(localStorage.getItem(DEF));
    } catch (e) {}
    return null;
  }
  const V = {
    fsel: {},
    kgroup: null,
    cols: initCols() || COLS.map(c => ({
      id: c.id,
      on: !c.off
    })),
    sort: {
      id: 'no',
      dir: 1
    },
    group: null,
    open: {},
    q: '',
    mine: false,
    page: 1,
    per: 25,
    sel: new Set(),
    menu: null,
    settings: false,
    toast: null
  };
  const colDef = id => COLS.find(c => c.id === id);
  const fmtD = d => new Intl.DateTimeFormat(S.lang === 'ar' ? 'ar' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    numberingSystem: 'latn'
  }).format(d);
  const dots = n => n >= 20 ? 'rrrr' : n >= 12 ? 'rrr_' : n >= 8 ? 'rr__' : n >= 5 ? 'r___' : n >= 3 ? 'y___' : n >= 2 ? 'g___' : '____';
  function val(r, id) {
    switch (id) {
      case 'no':
        return r.id;
      case 'title':
        return L(r.t[0], r.t[1]);
      case 'rev':
        return r.rev;
      case 'disc':
        return L(DISC[r.disc][0], DISC[r.disc][1]);
      case 'type':
        return r.type;
      case 'status':
        return L(ST[r.st][0], ST[r.st][1]);
      case 'code':
        return r.code ? 'Code ' + r.code : '—';
      case 'zone':
        return L('Zone ', 'المنطقة ') + r.zone;
      case 'bldg':
        return L('Building ', 'المبنى ') + r.bldg;
      case 'floor':
        return r.floor;
      case 'owner':
        return L(PEOPLE[r.owner][0], PEOPLE[r.owner][1]);
      case 'contractor':
        return L(CONTR[r.ctr][0], CONTR[r.ctr][1]);
      case 'created':
        return fmtD(r.created);
      case 'due':
        return fmtD(r.due);
      case 'days':
        return r.days;
    }
  }
  function sortKey(r, id) {
    return id === 'created' ? r.created : id === 'due' ? r.due : id === 'days' ? r.days : String(val(r, id));
  }
  function cell(r, id) {
    switch (id) {
      case 'no':
        return `<span class="num mut">${r.id}</span>`;
      case 'title':
        return `<span class="ttl" title="${esc(val(r, 'title'))}">${esc(val(r, 'title'))}</span>`;
      case 'rev':
        return r.rev === 'R0' ? '<span class="mut num">R0</span>' : `<span class="chip" style="background:var(--rev-pill-bg);color:var(--rev-pill-fg);font-weight:700">${r.rev}</span>`;
      case 'disc':
        {
          const d = DISC[r.disc];
          return `<span class="chip" style="background:var(--tone-${d[2]}-tint);color:var(--tone-${d[2]}-fg)">${L(d[0], d[1])} (${r.disc})</span>`;
        }
      case 'type':
        return `<span class="doc">${r.type}</span>`;
      case 'status':
        {
          const s = ST[r.st];
          return `<span class="chip" style="background:var(--status-${s[2]}-bg);color:var(--status-${s[2]}-fg)"><i style="background:var(--status-${s[2]}-dot)"></i>${L(s[0], s[1])}</span>`;
        }
      case 'code':
        {
          if (!r.code) return '<span class="mut">—</span>';
          const c = CODE[r.code];
          return `<span class="chip" style="background:var(--tone-${c[0]}-${c[1] ? 'solid' : 'tint'});color:${c[1] ? '#fff' : `var(--tone-${c[0]}-fg)`}"><span class="ti ${c[2]}"></span>Code ${r.code}</span>`;
        }
      case 'owner':
        {
          const p = PEOPLE[r.owner];
          return `<span class="who"><span class="av" style="width:24px;height:24px;font-size:10px;background:${p[2]}">${RS.ini(p[0])}</span>${L(p[0], p[1])}</span>`;
        }
      case 'created':
      case 'due':
        {
          const late = id === 'due' && r.due < new Date(2026, 8, 26) && !['approved', 'rejected'].includes(r.st);
          return `<span class="num${late ? '' : ' mut'}" style="${late ? 'color:var(--tone-red-fg);font-weight:600' : ''}">${fmtD(id === 'due' ? r.due : r.created)}</span>`;
        }
      case 'days':
        return `<span class="dots" title="${r.days}">${dots(r.days).split('').map(c => `<i class="${c === '_' ? '' : c}"></i>`).join('')}</span> <span class="num mut" style="margin-inline-start:6px">${r.days}${L('d', 'ي')}</span>`;
      default:
        return esc(val(r, id));
    }
  }
  function fmatch(r) {
    const F = V.fsel,
      has = (k, v) => !F[k] || !F[k].length || F[k].includes(String(v));
    if (!has('status', r.st) || !has('trade', r.disc) || !has('type', r.type) || !has('owner', r.owner) || !has('zone', r.zone) || !has('bldg', r.bldg) || !has('floor', r.floor) || !has('code', r.code || 'none') || !has('rev', r.rev)) return false;
    if (F.days && F.days.length && r.days < +F.days[0]) return false;
    if (F.created && F.created.length) {
      const ago = (new Date(2026, 8, 26) - r.created) / 864e5;
      if (ago > +F.created[0]) return false;
    }
    return true;
  }
  function fieldsDef() {
    const Lx = (e, a) => S.lang === 'ar' ? a : e;
    return [{
      k: 'status',
      n: Lx('Status', 'الحالة'),
      a: Lx('الحالة', 'Status'),
      mark: 'dot',
      opts: Object.keys(ST).map(k => [k, `var(--status-${ST[k][2]}-dot)`, 0, Lx(ST[k][0], ST[k][1])])
    }, {
      k: 'trade',
      n: Lx('Trade', 'التخصص'),
      a: Lx('التخصص', 'Trade'),
      mark: 'chip',
      opts: Object.keys(DISC).map(k => [k, DISC[k][2], k, Lx(DISC[k][0], DISC[k][1])])
    }, {
      k: 'type',
      n: Lx('Document type', 'نوع المستند'),
      a: Lx('نوع المستند', 'Type'),
      opts: ['MAR', 'SAR', 'DAR', 'DAS'].map(k => [k])
    }, {
      k: 'owner',
      n: Lx('Owner', 'المسؤول'),
      a: Lx('المسؤول', 'Owner'),
      mark: 'av',
      opts: PEOPLE.map((p, i) => [String(i), p[2], 0, Lx(p[0], p[1])]).map(o => {
        o[0] = o[0];
        return o;
      }).map((o, i) => {
        const r = [String(i), PEOPLE[i][2], 0, Lx(PEOPLE[i][0], PEOPLE[i][1])];
        r.av = PEOPLE[i][0];
        return r;
      })
    }, {
      sep: 1
    }, {
      k: 'zone',
      n: Lx('Zone', 'المنطقة'),
      a: Lx('المنطقة', 'Zone'),
      mark: 'ic',
      opts: ['A', 'B', 'C'].map(z => [z, 'ti-map', 0, Lx('Zone ', 'المنطقة ') + z])
    }, {
      k: 'bldg',
      n: Lx('Building', 'المبنى'),
      a: Lx('المبنى', 'Building'),
      mark: 'ic',
      opts: ['1', '2', '3'].map(b => [b, 'ti-building', 0, Lx('Building ', 'المبنى ') + b])
    }, {
      k: 'floor',
      n: Lx('Floor', 'الطابق'),
      a: Lx('الطابق', 'Floor'),
      mark: 'ic',
      opts: ['B2', 'B1', 'G', '1', '2', '3', '4', '5', 'R'].map(f => [f, 'ti-stairs'])
    }, {
      sep: 1
    }, {
      k: 'created',
      n: Lx('Created date', 'تاريخ الإنشاء'),
      a: Lx('تاريخ الإنشاء', 'Created'),
      single: 1,
      mark: 'ic',
      opts: [['7', 'ti-calendar-event', 0, Lx('Last 7 days', 'آخر 7 أيام')], ['30', 'ti-calendar-event', 0, Lx('Last 30 days', 'آخر 30 يومًا')], ['60', 'ti-calendar-event', 0, Lx('Last 60 days', 'آخر 60 يومًا')]]
    }, {
      k: 'days',
      n: Lx('Days in column', 'الأيام في العمود'),
      a: Lx('الأيام في العمود', 'Days'),
      single: 1,
      mark: 'days',
      opts: [['2', 'g___', 0, Lx('2+ days', '2+ أيام')], ['3', 'y___', 0, Lx('3+ days', '3+ أيام')], ['5', 'r___', 0, Lx('5+ days', '5+ أيام')], ['8', 'rr__', 0, Lx('8+ days', '8+ أيام')], ['12', 'rrr_', 0, Lx('12+ days', '12+ يومًا')], ['20', 'rrrr', 0, Lx('20+ days', '20+ يومًا')]]
    }];
  }
  const FEXTRA = () => {
    const Lx = (e, a) => S.lang === 'ar' ? a : e;
    return [{
      k: 'code',
      n: Lx('Approval code', 'رمز الاعتماد'),
      a: Lx('رمز الاعتماد', 'Code'),
      opts: [['A', 0, 0, 'Code A'], ['B', 0, 0, 'Code B'], ['C', 0, 0, 'Code C'], ['D', 0, 0, 'Code D'], ['none', 0, 0, Lx('No code yet', 'بدون رمز')]]
    }, {
      k: 'rev',
      n: Lx('Revision', 'رقم المراجعة'),
      a: Lx('رقم المراجعة', 'Rev'),
      opts: ['R0', 'R1', 'R2', 'R3'].map(r => [r])
    }];
  };
  const FSAVED = {
    starred: ['All Electrical MAR', 'Stuck 8+ days'],
    mine: ['Rejected — this month', 'Zone A · Building 1', 'Pending approval · Civil']
  };
  const FPRESET = {
    'All Electrical MAR': {
      trade: ['EL'],
      type: ['MAR']
    },
    'Stuck 8+ days': {
      days: ['8']
    },
    'Rejected — this month': {
      status: ['rejected'],
      created: ['30']
    },
    'Zone A · Building 1': {
      zone: ['A'],
      bldg: ['1']
    },
    'Pending approval · Civil': {
      status: ['pending'],
      trade: ['CV']
    }
  };
  const fcount = () => Object.values(V.fsel).filter(v => v && v.length).length;
  function filtered() {
    const q = V.q.trim().toLowerCase();
    let list = rows.filter(r => fmatch(r) && (!V.mine || r.owner === 2) && (!q || [r.id, r.t[0], r.t[1], PEOPLE[r.owner][0], r.type, r.disc].join(' ').toLowerCase().includes(q)));
    const {
      id,
      dir
    } = V.sort;
    list.sort((a, b) => {
      const x = sortKey(a, id),
        y = sortKey(b, id);
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
    return list;
  }
  const vis = () => V.cols.filter(c => c.on).map(c => c.id);
  function head() {
    const cs = vis();
    return `<tr><th class="c-chk"><span class="ck${V.sel.size && V.sel.size === filtered().length ? ' on' : ''}" data-act="selall">${V.sel.size ? '<i class="ti ti-' + (V.sel.size === filtered().length ? 'check' : 'minus') + '"></i>' : ''}</span></th>${cs.map(id => {
      const c = colDef(id);
      const on = V.sort.id === id;
      return `<th draggable="true" data-col="${id}" style="min-width:${c.w}px"><span class="hc"><i class="ti ti-grid-dots grip"></i>${L(c.en, c.ar)}<button class="srt${on ? ' on' : ''}" data-sort="${id}" title="${L('Sort', 'ترتيب')}"><i class="ti ${on ? V.sort.dir > 0 ? 'ti-sort-ascending' : 'ti-sort-descending' : 'ti-arrows-sort'}"></i></button></span></th>`;
    }).join('')}<th class="c-act"><button class="cb ter sm ic${V.settings ? ' on' : ''}" data-act="settings" title="${L('Table settings', 'إعدادات الجدول')}"><i class="ti ti-settings"></i></button></th></tr>`;
  }
  function rowHtml(r) {
    const on = V.sel.has(r.id);
    return `<tr class="${on ? 'sel' : ''}"><td class="c-chk"><span class="ck${on ? ' on' : ''}" data-sel="${r.id}">${on ? '<i class="ti ti-check"></i>' : ''}</span></td>${vis().map(id => `<td>${cell(r, id)}</td>`).join('')}<td class="c-act"><button class="cb ter sm ic${V.menu === 'row:' + r.id ? ' on' : ''}" data-rowmenu="${r.id}"><i class="ti ti-dots"></i></button></td></tr>`;
  }
  function rowMenu() {
    return `<div class="pop fixpop" id="rowpop" data-stop>${[['ti-eye', 'Open', 'فتح'], ['ti-edit', 'Edit', 'تعديل'], ['ti-copy', 'Duplicate', 'تكرار'], ['ti-refresh', 'Resubmit', 'إعادة تقديم'], ['ti-download', 'Download', 'تنزيل']].map(m => `<button class="mi" data-act="noop"><i class="ti ${m[0]}"></i>${L(m[1], m[2])}</button>`).join('')}<div class="sep"></div><button class="mi" data-act="noop" style="color:var(--tone-red-fg)"><i class="ti ti-trash" style="color:inherit"></i>${L('Delete', 'حذف')}</button></div>`;
  }
  function body() {
    const list = filtered();
    const n = vis().length + 2;
    if (!list.length) return `<tr class="empty-row"><td colspan="${n}">${L('No submittals match your search.', 'لا توجد تقديمات مطابقة.')}</td></tr>`;
    if (V.group) {
      const g = {};
      list.forEach(r => {
        const k = V.group === 'code' ? r.code ? 'Code ' + r.code : L('No code', 'بدون رمز') : val(r, V.group);
        (g[k] = g[k] || []).push(r);
      });
      return Object.entries(g).map(([k, rs]) => {
        const open = V.open[k] !== false;
        return `<tr class="grp${open ? ' open' : ''}" data-grp="${esc(k)}"><td colspan="${n}"><span class="gh"><i class="ti ti-chevron-right"></i><span class="doc" style="height:22px;font-size:11.5px">${esc(k)}</span><span class="gcnt">${rs.length} ${L('items', 'عنصر')}</span></span></td></tr>${open ? rs.map(rowHtml).join('') : ''}`;
      }).join('');
    }
    const pages = Math.max(1, Math.ceil(list.length / V.per));
    V.page = Math.min(V.page, pages);
    return list.slice((V.page - 1) * V.per, V.page * V.per).map(rowHtml).join('');
  }
  function settings() {
    if (!V.settings) return '';
    return `<div class="colset" id="colset" data-stop><div class="hd"><i class="ti ti-settings"></i>${L('Columns', 'الأعمدة')}<small>${vis().length} / ${COLS.length} ${L('shown', 'معروض')}</small></div><div class="ls">${V.cols.map((c, i) => {
      const d = colDef(c.id);
      return `<div class="it${d.lock ? ' lock' : ''}" draggable="true" data-ci="${i}"><i class="ti ti-grid-dots grip"></i>${L(d.en, d.ar)}${d.lock ? '<i class="ti ti-lock"></i>' : `<span class="swc${c.on ? ' on' : ''}" data-toggle="${c.id}"></span>`}</div>`;
    }).join('')}</div><div class="ft"><button class="cb sm" data-act="reset">${L('Reset', 'إعادة ضبط')}</button><button class="cb pri sm" data-act="savedef"><i class="ti ti-check"></i>${L('Save as my default', 'حفظ كافتراضي')}</button></div></div>`;
  }
  function pager() {
    if (V.group) return `<div class="pg"><span>${filtered().length} ${L('submittals', 'تقديم')} · ${L('grouped by', 'مجمعة حسب')} <b>${L(colDef(V.group).en, colDef(V.group).ar)}</b></span></div>`;
    const total = filtered().length,
      pages = Math.max(1, Math.ceil(total / V.per));
    const nums = [];
    for (let p = 1; p <= pages; p++) nums.push(p);
    const ch = S.lang === 'ar' ? ['ti-chevrons-right', 'ti-chevron-right', 'ti-chevron-left', 'ti-chevrons-right flipx'] : ['ti-chevrons-right flipx', 'ti-chevron-left', 'ti-chevron-right', 'ti-chevrons-right'];
    return `<div class="pg"><span>${L('Rows per page', 'صفوف في الصفحة')}</span><select data-per>${[10, 25, 50].map(n => `<option${n === V.per ? ' selected' : ''}>${n}</option>`).join('')}</select><span class="mid">${L(`Page ${V.page} of ${pages}`, `صفحة ${V.page} من ${pages}`)} · <span class="mut">${total} ${L('submittals', 'تقديم')}</span></span><span class="nav"><button class="cb sm" data-page="1"${V.page === 1 ? ' disabled' : ''}><i class="ti ${ch[0]}"></i></button><button class="cb sm" data-page="${V.page - 1}"${V.page === 1 ? ' disabled' : ''}><i class="ti ${ch[1]}"></i></button>${nums.map(p => `<button class="cb sm${p === V.page ? ' cur' : ''}" data-page="${p}">${p}</button>`).join('')}<button class="cb sm" data-page="${V.page + 1}"${V.page === pages ? ' disabled' : ''}><i class="ti ${ch[2]}"></i></button><button class="cb sm" data-page="${pages}"${V.page === pages ? ' disabled' : ''}><i class="ti ${ch[3]}"></i></button></span></div>`;
  }
  function toolbar(mode) {
    mode = mode || 'list';
    const g = mode === 'kanban' ? V.kgroup : V.group;
    const GL = mode === 'kanban' ? ['disc', 'owner', 'zone', 'type'] : GROUPS;
    return `<div class="lv-bar">
 <button class="cb pri"><i class="ti ti-plus"></i>${L('Add Submittal', 'إضافة تقديم')}</button>
 <label class="fsrch"><i class="ti ti-search"></i><input id="lvq" placeholder="${L('Search this list', 'ابحث في القائمة')}" value="${esc(V.q)}"><kbd>/</kbd></label>
 <button class="cb${fcount() ? ' on' : ''}" data-fpop="lv"><i class="ti ti-filter"></i>${L('Filter', 'تصفية')}${fcount() ? `<span class="fcnt">${fcount()}</span>` : ''}<i class="ti ti-chevron-down"></i></button>
 <span class="tgl" data-act="mine"><span class="swc${V.mine ? ' on' : ''}"></span>${L('Need my action', 'بحاجة لإجرائي')}</span>
 <span class="sp"></span>
 <span class="rel"><button class="cb${g ? ' on' : ''}" data-menu="group"><i class="ti ti-category"></i>${g ? L('Group: ', 'تجميع: ') + L(colDef(g).en, colDef(g).ar) : L('Group', 'تجميع')}<i class="ti ti-chevron-down"></i></button>${V.menu === 'group' ? `<div class="pop end" data-stop><h6>${L('Group by', 'تجميع حسب')}</h6>${GL.map(id => `<button class="mi${g === id ? ' on' : ''}" data-group="${id}">${L(colDef(id).en, colDef(id).ar)}${g === id ? '<i class="ti ti-check ck"></i>' : ''}</button>`).join('')}${g ? `<div class="sep"></div><button class="mi" data-group="">${L('Clear selection', 'مسح التحديد')}</button>` : ''}</div>` : ''}</span>
 <span class="split rel"><button class="cb" data-export="csv"><i class="ti ti-file-download"></i>${L('Export', 'تصدير')}</button><button class="cb" data-menu="export" aria-label="Export options"><i class="ti ti-chevron-down"></i></button>${V.menu === 'export' ? `<div class="pop end" data-stop><button class="mi" data-export="csv"><i class="ti ti-file-text"></i>CSV<small>.csv</small></button><button class="mi" data-export="xlsx"><i class="ti ti-table"></i>XLSX<small>Excel</small></button></div>` : ''}</span>
 <span class="segv"><a href="submittals-kanban.html"><button class="${mode === 'kanban' ? 'on' : ''}"><i class="ti ti-layout-grid"></i>${L('Kanban', 'كانبان')}</button></a><a href="submittals-list.html"><button class="${mode === 'list' ? 'on' : ''}"><i class="ti ti-list"></i>${L('List', 'قائمة')}</button></a></span>
 </div>`;
  }
  function view() {
    return `${toolbar()}<div class="tw rel">${V.sel.size ? `<div class="bulk">${V.sel.size} ${L('selected', 'محدد')}<span class="sp"></span><button class="cb sm" data-export="csv"><i class="ti ti-file-download"></i>${L('Export selected', 'تصدير المحدد')}</button><button class="cb sm ter" data-act="clearsel">${L('Clear', 'مسح')}</button></div>` : ''}<div class="ts"><table class="lv"><thead>${head()}</thead><tbody>${body()}</tbody></table></div>${pager()}</div>${settings()}${V.menu && V.menu.startsWith('row:') ? rowMenu() : ''}${V.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>` : ''}`;
  }
  function exportData(kind) {
    const cs = vis();
    const list = V.sel.size ? filtered().filter(r => V.sel.has(r.id)) : filtered();
    const hdr = cs.map(id => L(colDef(id).en, colDef(id).ar));
    const data = list.map(r => cs.map(id => String(val(r, id))));
    let blob, name;
    if (kind === 'csv') {
      const q = s => '"' + s.replace(/"/g, '""') + '"';
      blob = new Blob(['\ufeff' + [hdr, ...data].map(r => r.map(q).join(',')).join('\n')], {
        type: 'text/csv'
      });
      name = 'rabaed-submittals.csv';
    } else {
      const x = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Submittals"><Table>${[hdr, ...data].map(r => `<Row>${r.map(c => `<Cell><Data ss:Type="String">${x(c)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`;
      blob = new Blob([xml], {
        type: 'application/vnd.ms-excel'
      });
      name = 'rabaed-submittals.xls';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    flash(L(`Exported ${list.length} submittals (${kind.toUpperCase()})`, `تم تصدير ${list.length} تقديم (${kind.toUpperCase()})`));
  }
  let tt;
  function flash(m) {
    V.toast = m;
    window.LV.render();
    clearTimeout(tt);
    tt = setTimeout(() => {
      V.toast = null;
      window.LV.render();
    }, 2200);
  }
  const saveCols = () => localStorage.setItem(KEY, JSON.stringify(V.cols));
  function bind(root, render) {
    window.LV.render = render;
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-sort],[data-act],[data-menu],[data-group],[data-export],[data-toggle],[data-sel],[data-grp],[data-page],[data-rowmenu]');
      if (!b) {
        if ((V.menu || V.settings) && !e.target.closest('[data-stop]')) {
          V.menu = null;
          V.settings = false;
          render();
        }
        return;
      }
      const d = b.dataset;
      e.stopPropagation();
      if (d.sort) {
        V.sort = V.sort.id === d.sort ? {
          id: d.sort,
          dir: -V.sort.dir
        } : {
          id: d.sort,
          dir: 1
        };
        return render();
      }
      if (d.menu) {
        V.menu = V.menu === d.menu ? null : d.menu;
        V.settings = false;
        return render();
      }
      if (d.rowmenu) {
        V.menu = V.menu === 'row:' + d.rowmenu ? null : 'row:' + d.rowmenu;
        V.settings = false;
        return render();
      }
      if (d.group !== undefined) {
        if (window.LV.mode === 'kanban') V.kgroup = d.group || null;else V.group = d.group || null;
        V.menu = null;
        V.open = {};
        return render();
      }
      if (d.export) {
        V.menu = null;
        return exportData(d.export);
      }
      if (d.toggle) {
        const c = V.cols.find(c => c.id === d.toggle);
        c.on = !c.on;
        saveCols();
        return render();
      }
      if (d.sel) {
        V.sel.has(d.sel) ? V.sel.delete(d.sel) : V.sel.add(d.sel);
        return render();
      }
      if (d.grp !== undefined) {
        V.open[d.grp] = V.open[d.grp] === false;
        return render();
      }
      if (d.page) {
        V.page = +d.page;
        return render();
      }
      const a = d.act;
      if (a === 'settings') {
        V.settings = !V.settings;
        V.menu = null;
        return render();
      }
      if (a === 'mine') {
        V.mine = !V.mine;
        V.page = 1;
        return render();
      }
      if (a === 'selall') {
        const l = filtered();
        if (V.sel.size === l.length) V.sel.clear();else l.forEach(r => V.sel.add(r.id));
        return render();
      }
      if (a === 'clearsel') {
        V.sel.clear();
        return render();
      }
      if (a === 'savedef') {
        localStorage.setItem(DEF, JSON.stringify(V.cols));
        V.settings = false;
        return flash(L('Saved as your default columns', 'تم الحفظ كأعمدة افتراضية'));
      }
      if (a === 'reset') {
        V.cols = COLS.map(c => ({
          id: c.id,
          on: !c.off
        }));
        saveCols();
        return render();
      }
      if (a === 'noop') {
        V.menu = null;
        return render();
      }
    });
    root.addEventListener('input', e => {
      if (e.target.id === 'lvq') {
        V.q = e.target.value;
        V.page = 1;
        const p = e.target.selectionStart;
        render();
        const i = document.getElementById('lvq');
        i.focus();
        i.setSelectionRange(p, p);
      }
    });
    root.addEventListener('change', e => {
      if (e.target.matches('[data-per]')) {
        V.per = +e.target.value;
        V.page = 1;
        render();
      }
    });
    // drag & drop — table headers and settings list
    let drag = null;
    root.addEventListener('dragstart', e => {
      const th = e.target.closest('th[data-col]'),
        it = e.target.closest('.colset .it');
      if (th) {
        drag = {
          k: 'col',
          id: th.dataset.col
        };
        th.classList.add('drag');
      } else if (it) {
        drag = {
          k: 'set',
          i: +it.dataset.ci
        };
        it.classList.add('drag');
      } else return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'x');
    });
    root.addEventListener('dragover', e => {
      if (!drag) return;
      const t = drag.k === 'col' ? e.target.closest('th[data-col]') : e.target.closest('.colset .it');
      if (!t) return;
      e.preventDefault();
      root.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
      t.classList.add('over');
    });
    root.addEventListener('drop', e => {
      if (!drag) return;
      e.preventDefault();
      let from, to;
      if (drag.k === 'col') {
        const t = e.target.closest('th[data-col]');
        if (!t) return;
        from = V.cols.findIndex(c => c.id === drag.id);
        to = V.cols.findIndex(c => c.id === t.dataset.col);
      } else {
        const t = e.target.closest('.colset .it');
        if (!t) return;
        from = drag.i;
        to = +t.dataset.ci;
      }
      if (from !== to && from >= 0 && to >= 0) {
        const [m] = V.cols.splice(from, 1);
        V.cols.splice(to, 0, m);
        saveCols();
      }
      drag = null;
      render();
    });
    root.addEventListener('dragend', () => {
      drag = null;
      root.querySelectorAll('.drag,.over').forEach(x => x.classList.remove('drag', 'over'));
    });
    document.addEventListener('click', e => {
      if ((V.menu || V.settings) && !root.contains(e.target)) {
        V.menu = null;
        V.settings = false;
        render();
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        const i = document.getElementById('lvq');
        i && i.focus();
      }
      if (e.key === 'Escape' && (V.menu || V.settings)) {
        V.menu = null;
        V.settings = false;
        render();
      }
    });
  }
  function place() {
    const W = innerWidth,
      H = innerHeight,
      rtl = document.documentElement.dir === 'rtl';
    const cs = document.getElementById('colset'),
      g = document.querySelector('[data-act=settings]');
    if (cs && g) {
      const r = g.getBoundingClientRect();
      const top = Math.min(r.bottom + 6, H - 200);
      cs.style.top = top + 'px';
      cs.style.maxHeight = H - top - 8 + 'px';
      if (rtl) {
        cs.style.left = Math.max(8, r.left) + 'px';
        cs.style.right = 'auto';
      } else {
        cs.style.right = Math.max(8, W - r.right) + 'px';
        cs.style.left = 'auto';
      }
    }
    const rp = document.getElementById('rowpop');
    if (rp && V.menu) {
      const b = document.querySelector('[data-rowmenu="' + V.menu.slice(4) + '"]');
      if (b) {
        const r = b.getBoundingClientRect(),
          h = rp.offsetHeight;
        let top = r.bottom + 4;
        if (top + h > H - 8) top = Math.max(8, r.top - h - 4);
        rp.style.top = top + 'px';
        if (rtl) {
          rp.style.left = r.left + 'px';
          rp.style.right = 'auto';
        } else {
          rp.style.right = W - r.right + 'px';
          rp.style.left = 'auto';
        }
      }
    }
  }
  addEventListener('resize', place);
  addEventListener('scroll', () => {
    if (V.menu && V.menu.startsWith('row:')) {
      V.menu = null;
      window.LV.rerender && window.LV.rerender();
    } else place();
  }, true);
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-fpop="lv"]');
    if (!b) return;
    e.stopPropagation();
    if (FPop.isOpen()) {
      FPop.close();
      return;
    }
    const Lx = (en, ar) => S.lang === 'ar' ? ar : en;
    FPop.open(b, {
      L: Lx,
      fields: fieldsDef(),
      extra: FEXTRA(),
      saved: FSAVED,
      preset: FPRESET,
      sel: JSON.parse(JSON.stringify(V.fsel)),
      onChange: sel => {
        V.fsel = JSON.parse(JSON.stringify(sel));
        V.page = 1;
        window.LV.render && window.LV.render();
        const nb = document.querySelector('[data-fpop="lv"]');
        if (nb) {
          FPop.btn = nb;
          FPop.place();
        }
      }
    });
  }, true);
  window.LV = {
    V,
    view,
    bind,
    place,
    toolbar,
    rows,
    filtered,
    cell,
    val,
    ST,
    DISC,
    PEOPLE,
    CODE,
    dots,
    fmtD,
    exportData,
    flash,
    colDef,
    mode: 'list'
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/list/list.js", error: String((e && e.message) || e) }); }

// ui_kits/app/map/data.js
try { (() => {
// Map View — sample data for Al Nakheel Villas Compound. Exposes window.MD.
(function () {
  const ST = {
    ok: {
      en: 'On Track',
      ar: 'ضمن المسار',
      ic: 'ti-trending-up',
      c: 'var(--tone-blue-solid)',
      t: 'var(--tone-blue-tint)',
      f: 'var(--tone-blue-fg)',
      den: 'No open snags or failed inspections, and fewer than 3 submittals pending approval.',
      dar: 'لا توجد ملاحظات مفتوحة أو فحوصات راسبة، وأقل من 3 تقديمات بانتظار الاعتماد.'
    },
    att: {
      en: 'Needs Attention',
      ar: 'بحاجة لمتابعة',
      ic: 'ti-alert-circle',
      c: 'var(--tone-orange-solid)',
      t: 'var(--tone-orange-tint)',
      f: 'var(--tone-orange-fg)',
      den: '1–3 open snags, 1 failed inspection, or 3+ submittals pending approval.',
      dar: 'من 1 إلى 3 ملاحظات مفتوحة، أو فحص راسب واحد، أو 3 تقديمات أو أكثر بانتظار الاعتماد.'
    },
    iss: {
      en: 'Issues',
      ar: 'مشكلات',
      ic: 'ti-alert-triangle',
      c: 'var(--tone-red-solid)',
      t: 'var(--tone-red-tint)',
      f: 'var(--tone-red-fg)',
      den: '4+ open snags or 2+ failed inspections.',
      dar: '4 ملاحظات مفتوحة أو أكثر، أو فحصان راسبان أو أكثر.'
    },
    done: {
      en: 'Complete',
      ar: 'مكتمل',
      ic: 'ti-check',
      c: 'var(--tone-green-solid)',
      t: 'var(--tone-green-tint)',
      f: 'var(--tone-green-fg)',
      den: 'All inspections passed and nothing open. Zone handed over.',
      dar: 'اجتازت جميع الفحوصات ولا يوجد شيء مفتوح. تم تسليم المنطقة.'
    },
    ns: {
      en: 'Not Started',
      ar: 'لم يبدأ',
      ic: 'ti-hourglass-high',
      c: 'var(--tone-gray-solid)',
      t: 'var(--tone-gray-tint)',
      f: 'var(--tone-gray-fg)',
      den: 'No Work Items recorded in this zone yet.',
      dar: 'لا توجد عناصر عمل مسجلة في هذه المنطقة بعد.'
    }
  };
  const ORDER = ['iss', 'att', 'ok', 'done', 'ns'];
  const TRADES = {
    AR: ['Architecture', 'معماري', 'violet'],
    CV: ['Civil', 'مدني', 'amber'],
    EL: ['Electrical', 'كهربائي', 'cyan'],
    ME: ['Mechanical', 'ميكانيكي', 'green'],
    LS: ['Landscaping', 'تنسيق الحدائق', 'orange']
  };
  const COS = {
    afc: ['Al Futtaim Construction Co.', 'شركة الفطيم للمقاولات', '#f8552f'],
    arb: ['Arabtec', 'أرابتك', '#3d6db5'],
    alec: ['ALEC Engineering', 'ألك للهندسة', '#1fae66']
  };
  const TYPES = {
    snag: ['Snag', 'ملاحظة'],
    insp: ['Inspection', 'فحص'],
    sub: ['Submittal', 'تقديم']
  };
  const PHASES = {
    p1: ['Phase 01', 'المرحلة ٠١'],
    p2: ['Phase 02', 'المرحلة ٠٢'],
    p3: ['Phase 03', 'المرحلة ٠٣'],
    p4: ['Phase 04', 'المرحلة ٠٤'],
    am: ['Amenities', 'المرافق'],
    inf: ['Infrastructure', 'البنية التحتية']
  };
  // ROLES: what each viewer is allowed to see
  const ROLES = {
    admin: {
      en: 'Project Admin',
      ar: 'مسؤول المشروع',
      sub: ['Whole site · all trades', 'الموقع بالكامل · جميع التخصصات'],
      edit: 1
    },
    contractor: {
      en: 'Contractor · Al Futtaim',
      ar: 'المقاول · الفطيم',
      sub: ['Your company’s work only', 'أعمال شركتك فقط'],
      co: ['afc']
    },
    owner: {
      en: 'Owner Representative',
      ar: 'ممثل المالك',
      sub: ['Whole site · Civil, Architecture, Landscaping', 'الموقع بالكامل · مدني، معماري، تنسيق الحدائق'],
      tr: ['CV', 'AR', 'LS']
    }
  };
  const Z = [{
    id: 'p1',
    en: 'Phase 01 – North Villas',
    ar: 'المرحلة ٠١ – فلل الشمال',
    ph: 'p1',
    units: [28, 'villas', 'فيلا'],
    tr: ['AR', 'CV', 'EL', 'ME'],
    n: [0, 0, 0, 60],
    loc: 'l-p1',
    pts: [[70, 62], [300, 48], [468, 60], [468, 288], [84, 288]],
    m: [270, 172]
  }, {
    id: 'mosque',
    en: 'Mosque',
    ar: 'المسجد',
    ph: 'am',
    units: [1, 'building', 'مبنى'],
    tr: ['AR', 'CV'],
    n: [1, 0, 1, 12],
    loc: 'l-mos',
    pts: [[532, 60], [628, 60], [628, 168], [532, 168]],
    m: [580, 114]
  }, {
    id: 'land',
    en: 'Landscaping',
    ar: 'تنسيق الحدائق',
    ph: 'am',
    units: [3, 'parks', 'حدائق'],
    tr: ['LS', 'CV'],
    n: [5, 1, 0, 6],
    loc: 'l-land',
    pts: [[532, 180], [628, 180], [628, 288], [532, 288]],
    m: [580, 234]
  }, {
    id: 'p3',
    en: 'Phase 03 – East Villas',
    ar: 'المرحلة ٠٣ – فلل الشرق',
    ph: 'p3',
    units: [30, 'villas', 'فيلا'],
    tr: ['AR', 'CV', 'EL', 'ME'],
    n: [0, 0, 2, 38],
    loc: 'l-p3',
    pts: [[640, 62], [935, 82], [942, 288], [640, 288]],
    m: [790, 178]
  }, {
    id: 'road',
    en: 'Main Gate & Roads',
    ar: 'البوابة الرئيسية والطرق',
    ph: 'inf',
    units: [4.2, 'km of roads', 'كم من الطرق'],
    tr: ['CV', 'EL'],
    n: [4, 2, 1, 18],
    loc: 'l-road',
    pts: [[480, 50], [520, 50], [520, 300], [945, 300], [945, 338], [520, 338], [520, 610], [538, 610], [538, 632], [462, 632], [462, 610], [480, 610], [480, 338], [60, 338], [60, 300], [480, 300]],
    m: [500, 620]
  }, {
    id: 'p4',
    en: 'Phase 04 – South Villas',
    ar: 'المرحلة ٠٤ – فلل الجنوب',
    ph: 'p4',
    units: [31, 'villas', 'فيلا'],
    tr: ['AR', 'CV', 'EL', 'ME'],
    n: [0, 0, 0, 0],
    loc: 'l-p4',
    pts: [[70, 350], [318, 350], [318, 598], [88, 604], [70, 580]],
    m: [194, 474]
  }, {
    id: 'club',
    en: 'Clubhouse',
    ar: 'النادي',
    ph: 'am',
    units: [1, 'building', 'مبنى'],
    tr: ['AR', 'ME', 'EL'],
    n: [0, 0, 0, 24],
    done: 1,
    loc: 'l-club',
    pts: [[330, 350], [468, 350], [468, 598], [330, 598]],
    m: [399, 474]
  }, {
    id: 'p2',
    en: 'Phase 02 – Central Blocks',
    ar: 'المرحلة ٠٢ – البلوكات الوسطى',
    ph: 'p2',
    units: [24, 'villas · 6 blocks', 'فيلا · ٦ بلوكات'],
    tr: ['AR', 'CV', 'EL', 'ME'],
    n: [3, 1, 5, 42],
    loc: 'l-p2',
    pts: [[532, 350], [942, 350], [930, 592], [532, 600]],
    m: [734, 474]
  }];
  const ISSUE = {
    AR: [['Cracked plaster — Villa {v}', 'تشقق في اللياسة — فيلا {v}'], ['Misaligned door frame — Villa {v}', 'إطار باب غير مستقيم — فيلا {v}'], ['Paint defects on façade — Villa {v}', 'عيوب دهان في الواجهة — فيلا {v}']],
    CV: [['Honeycombing in slab — Block {b}', 'تعشيش في البلاطة — بلوك {b}'], ['Kerb level out of tolerance — Road R{r}', 'منسوب الرصيف خارج الحد — طريق R{r}'], ['Waterproofing lap failed — Villa {v}', 'فشل تراكب العزل — فيلا {v}']],
    EL: [['Earthing test failed — Block {b}', 'فشل اختبار التأريض — بلوك {b}'], ['Streetlight cable exposed — Road R{r}', 'كابل إنارة مكشوف — طريق R{r}'], ['DB labelling missing — Villa {v}', 'ملصقات لوحة التوزيع مفقودة — فيلا {v}']],
    ME: [['Chilled water pipe leak — Villa {v}', 'تسرب في أنبوب المياه المبردة — فيلا {v}'], ['Duct insulation damaged — Block {b}', 'تلف عزل مجرى الهواء — بلوك {b}']],
    LS: [['Irrigation line leak — Park {r}', 'تسرب خط الري — حديقة {r}'], ['Dead palms to replace — Boulevard {r}', 'نخيل تالف يلزم استبداله — الممشى {r}'], ['Paving settlement — Walkway {r}', 'هبوط في الرصف — الممر {r}']]
  };
  const COK = ['afc', 'arb', 'alec'];
  // expand counts → work items
  Z.forEach((z, zi) => {
    z.items = [];
    const kinds = ['snag', 'failed', 'pending', 'passed'];
    let k = 0;
    z.n.forEach((cnt, ki) => {
      for (let i = 0; i < cnt; i++, k++) {
        const tr = z.tr[(i + ki) % z.tr.length];
        const co = COK[(i + zi + ki) % 3];
        const it = {
          kind: kinds[ki],
          tr,
          co,
          type: ki === 0 ? 'snag' : ki === 2 ? 'sub' : 'insp'
        };
        if (ki < 2) {
          const pool = ISSUE[tr];
          const tpl = pool[(i + zi) % pool.length];
          const v = 100 + zi * 28 + (i * 7 + 3) % 28,
            b = 'ABCDEF'[(i + zi) % 6],
            r = i % 4 + 1;
          it.t = tpl.map(s => s.replace('{v}', v).replace('{b}', b).replace('{r}', r));
          it.age = 2 + (i * 5 + zi * 3) % 14;
        }
        z.items.push(it);
      }
    });
  });
  const LOCS = [{
    id: 'root',
    en: 'Al Nakheel Villas Compound',
    ar: 'مجمع فلل النخيل',
    d: 0
  }, {
    id: 'l-p1',
    en: 'Phase 01 — North Villas',
    ar: 'المرحلة ٠١ — فلل الشمال',
    d: 1,
    s: ['Villas 101–128', 'فلل 101–128']
  }, {
    id: 'l-p2',
    en: 'Phase 02 — Central Blocks',
    ar: 'المرحلة ٠٢ — البلوكات الوسطى',
    d: 1,
    s: ['Blocks A–F', 'بلوكات A–F']
  }, {
    id: 'l-p3',
    en: 'Phase 03 — East Villas',
    ar: 'المرحلة ٠٣ — فلل الشرق',
    d: 1,
    s: ['Villas 201–230', 'فلل 201–230']
  }, {
    id: 'l-p4',
    en: 'Phase 04 — South Villas',
    ar: 'المرحلة ٠٤ — فلل الجنوب',
    d: 1,
    s: ['Villas 301–331', 'فلل 301–331']
  }, {
    id: 'l-am',
    en: 'Amenities',
    ar: 'المرافق',
    d: 1,
    group: 1
  }, {
    id: 'l-club',
    en: 'Clubhouse',
    ar: 'النادي',
    d: 2
  }, {
    id: 'l-mos',
    en: 'Mosque',
    ar: 'المسجد',
    d: 2
  }, {
    id: 'l-land',
    en: 'Landscaping & Parks',
    ar: 'تنسيق الحدائق والمتنزهات',
    d: 2
  }, {
    id: 'l-inf',
    en: 'Infrastructure',
    ar: 'البنية التحتية',
    d: 1,
    group: 1
  }, {
    id: 'l-road',
    en: 'Main Gate & Internal Roads',
    ar: 'البوابة الرئيسية والطرق الداخلية',
    d: 2
  }, {
    id: 'l-util',
    en: 'Utilities Corridor',
    ar: 'ممر المرافق',
    d: 2
  }, {
    id: 'l-p5',
    en: 'Phase 05 — Future Expansion',
    ar: 'المرحلة ٠٥ — توسعة مستقبلية',
    d: 1,
    s: ['Not yet mapped', 'غير مرسومة بعد']
  }];
  window.MD = {
    ST,
    ORDER,
    TRADES,
    COS,
    TYPES,
    PHASES,
    ROLES,
    Z,
    LOCS
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/map/data.js", error: String((e && e.message) || e) }); }

// ui_kits/app/map/map.js
try { (() => {
// Multiple View → Map View. Exposes window.MV {V, view, bind}.
(function () {
  const S = RS.S,
    {
      ST,
      ORDER,
      TRADES,
      COS,
      TYPES,
      PHASES,
      ROLES,
      Z,
      LOCS
    } = MD;
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  const clone = o => JSON.parse(JSON.stringify(o));
  const KEY = 'rb-map-v1';
  const W = 1000,
    H = 640;
  const sample = () => Z.map(z => ({
    id: z.id,
    en: z.en,
    ar: z.ar,
    pts: clone(z.pts),
    m: clone(z.m),
    loc: z.loc,
    color: null
  }));
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY));
  } catch (e) {}
  let qv = new URLSearchParams(location.search).get('v') || 'map';
  if (qv === 'floor') {
    location.replace('floor-view.html');
    qv = 'map';
  }
  const V = {
    view: ['floor', 'map', 'plan'].includes(qv) ? qv : 'map',
    role: 'admin',
    f: {
      tr: '',
      type: '',
      co: '',
      ph: ''
    },
    sel: null,
    exec: false,
    prevMode: null,
    edit: false,
    tool: 'select',
    draft: [],
    layout: saved && saved.layout || sample(),
    img: saved && saved.img || null,
    empty: false,
    panelOpen: false,
    menu: null,
    picker: false,
    pq: '',
    k: 1,
    tx: 0,
    ty: 0,
    auto: true,
    tablet: false,
    toast: null,
    dirty: false,
    backup: null
  };
  const data = id => Z.find(z => z.id === id);
  const nm = z => L(z.en, z.ar);
  const short = z => nm(z).split(' – ')[0];
  const role = () => ROLES[V.role];
  function visible(it) {
    const r = role();
    if (r.co && !r.co.includes(it.co)) return false;
    if (r.tr && !r.tr.includes(it.tr)) return false;
    const f = V.f;
    if (f.tr && it.tr !== f.tr) return false;
    if (f.type && it.type !== f.type) return false;
    if (f.co && it.co !== f.co) return false;
    return true;
  }
  function counts(z) {
    const d = data(z.id);
    const c = {
      snag: 0,
      failed: 0,
      pending: 0,
      passed: 0,
      items: []
    };
    if (!d) return c;
    d.items.filter(visible).forEach(it => {
      c[it.kind]++;
      c.items.push(it);
    });
    c.open = c.snag + c.failed;
    c.total = c.items.length;
    return c;
  }
  function status(z, c) {
    const d = data(z.id);
    if (!c.total) return 'ns';
    if (d && d.done && !c.snag && !c.failed && !c.pending) return 'done';
    if (c.failed >= 2 || c.snag >= 4) return 'iss';
    if (c.snag || c.failed || c.pending >= 3) return 'att';
    return 'ok';
  }
  const isOff = z => {
    const d = data(z.id);
    return V.f.ph && (!d || d.ph !== V.f.ph);
  };
  function model() {
    return V.layout.map(z => {
      const c = counts(z);
      return {
        z,
        c,
        s: status(z, c),
        off: isOff(z)
      };
    });
  }
  const col = m => m.z.color || ST[m.s].c;
  const why = (s, c) => ({
    ok: L(`${c.passed} inspections passed, nothing failing.`, `${c.passed} فحصًا ناجحًا، ولا يوجد فشل.`),
    att: L(`${c.snag} open snag${c.snag === 1 ? '' : 's'}, ${c.failed} failed inspection${c.failed === 1 ? '' : 's'}, ${c.pending} submittal${c.pending === 1 ? '' : 's'} pending.`, `${c.snag} ملاحظة مفتوحة، ${c.failed} فحص راسب، ${c.pending} تقديم معلّق.`),
    iss: L(`${c.snag} open snags and ${c.failed} failed inspections — above the Issues threshold.`, `${c.snag} ملاحظة مفتوحة و${c.failed} فحص راسب — فوق حدّ المشكلات.`),
    done: L('Every inspection passed and nothing is open.', 'اجتازت جميع الفحوصات ولا يوجد شيء مفتوح.'),
    ns: L('No Work Items you can see in this zone yet.', 'لا توجد عناصر عمل مرئية لك في هذه المنطقة بعد.')
  })[s];
  /* ---------- toolbar ---------- */
  function fsel(key, label, opts) {
    const cur = V.f[key];
    const o = opts.find(x => x[0] === cur);
    return `<span class="rel"><button class="cb fbtn${cur ? ' set' : ''}" data-menu="f-${key}">${label}<span class="v">${o ? ': ' + o[1] : ''}</span><i class="ti ti-chevron-down"></i></button>${V.menu === 'f-' + key ? `<div class="pop" data-stop><h6>${label}</h6><button class="mi${!cur ? ' on' : ''}" data-f="${key}:">${L('All', 'الكل')}${!cur ? '<i class="ti ti-check ck"></i>' : ''}</button>${opts.map(x => `<button class="mi${cur === x[0] ? ' on' : ''}" data-f="${key}:${x[0]}">${x[2] || ''}${x[1]}${cur === x[0] ? '<i class="ti ti-check ck"></i>' : ''}</button>`).join('')}</div>` : ''}</span>`;
  }
  function toolbar() {
    if (V.edit) return `<div class="editbar"><b><i class="ti ti-pencil"></i>${L('Editing site layout', 'تحرير مخطط الموقع')}</b><span class="tools"><button class="cb sm ter${V.tool === 'select' ? ' on' : ''}" data-tool="select" title="V"><i class="ti ti-arrows-maximize"></i>${L('Select & edit', 'تحديد وتعديل')}</button><button class="cb sm ter${V.tool === 'draw' ? ' on' : ''}" data-tool="draw" title="P"><i class="ti ti-polygon"></i>${L('Draw zone', 'رسم منطقة')}</button></span><button class="cb sm" data-act="upload"><i class="ti ti-upload"></i>${V.img ? L('Replace site map', 'استبدال خريطة الموقع') : L('Upload site map', 'رفع خريطة الموقع')}</button>${V.sel ? `<button class="cb sm" data-act="delzone" style="color:var(--tone-red-fg)"><i class="ti ti-trash"></i>${L('Delete zone', 'حذف المنطقة')}</button>` : ''}<span class="sp"></span><span style="font-size:12.5px;font-weight:600">${V.layout.length} ${L('zones', 'مناطق')}${V.dirty ? ' · ' + L('unsaved', 'غير محفوظ') : ''}</span><button class="cb sm ter" data-act="canceledit" style="color:inherit">${L('Cancel', 'إلغاء')}</button><button class="cb sm pri" data-act="save"><i class="ti ti-check"></i>${L('Save layout', 'حفظ المخطط')}</button></div>`;
    const vr = role(),
      tr = Object.keys(TRADES).filter(k => !vr.tr || vr.tr.includes(k)),
      co = Object.keys(COS).filter(k => !vr.co || vr.co.includes(k));
    const segs = [['floor', 'ti-stairs', L('Floor', 'الطوابق')], ['map', 'ti-map', L('Map', 'الخريطة')], ['plan', 'ti-vector', L('Plan', 'المخطط')]];
    return `<div class="mv-bar"><span class="segv">${segs.map(s => `<button class="${V.view === s[0] ? 'on' : ''}" data-view="${s[0]}"><i class="ti ${s[1]}"></i>${s[2]}</button>`).join('')}</span>
 ${V.view === 'map' && !V.empty ? `${fsel('tr', L('Trade', 'التخصص'), tr.map(k => [k, L(TRADES[k][0], TRADES[k][1])]))}${fsel('type', L('Work Item Type', 'نوع العنصر'), Object.keys(TYPES).map(k => [k, L(TYPES[k][0], TYPES[k][1])]))}${fsel('co', L('Company', 'الشركة'), co.map(k => [k, L(COS[k][0], COS[k][1]), `<span class="av" style="width:18px;height:18px;font-size:8px;background:${COS[k][2]}">${RS.ini(COS[k][0])}</span>`]))}${fsel('ph', L('Phase', 'المرحلة'), Object.keys(PHASES).map(k => [k, L(PHASES[k][0], PHASES[k][1])]))}${Object.values(V.f).some(Boolean) ? `<button class="cb ter sm" data-act="clearf">${L('Clear', 'مسح')}</button>` : ''}` : ''}
 <span class="sp"></span>
 <span class="rel"><button class="vis" data-menu="role" title="${L('Counts include only what your company can see', 'تشمل الأرقام فقط ما يُسمح لشركتك برؤيته')}"><i class="ti ti-eye"></i>${L(vr.en, vr.ar)}<small>· ${L(vr.sub[0], vr.sub[1])}</small><i class="ti ti-chevron-down"></i></button>${V.menu === 'role' ? `<div class="pop end" data-stop style="min-width:300px"><h6>${L('Demo · view as', 'عرض توضيحي · العرض بصفة')}</h6>${Object.entries(ROLES).map(([k, r]) => `<button class="mi${V.role === k ? ' on' : ''}" data-role="${k}" style="white-space:normal"><i class="ti ${k === 'admin' ? 'ti-shield' : k === 'owner' ? 'ti-building' : 'ti-user-circle'}"></i><span><b style="display:block;font-weight:600">${L(r.en, r.ar)}</b><span style="font-size:11.5px;color:var(--ui-muted)">${L(r.sub[0], r.sub[1])}</span></span></button>`).join('')}</div>` : ''}</span>
 ${V.view === 'map' && !V.empty ? `<span class="tgl" data-act="exec"><span class="swc${V.exec ? ' on' : ''}"></span>${L('Executive view', 'العرض التنفيذي')}</span>` : ''}
 ${role().edit && V.view === 'map' && !V.empty ? `<button class="cb" data-act="edit"><i class="ti ti-pencil"></i>${L('Edit layout', 'تحرير المخطط')}</button>` : ''}
 ${V.view === 'map' && !V.empty ? `<button class="cb tbl-only${V.panelOpen ? ' on' : ''}" data-act="panel"><i class="ti ti-layout-dashboard"></i>${L('Overview', 'نظرة عامة')}</button>` : ''}
 <span class="rel"><button class="cb ic" data-menu="demo" title="${L('Demo states', 'حالات العرض')}"><i class="ti ti-dots"></i></button>${V.menu === 'demo' ? `<div class="pop end" data-stop><h6>${L('Demo states', 'حالات العرض')}</h6><button class="mi" data-act="empty"><i class="ti ti-photo"></i>${L('Empty state', 'الحالة الفارغة')}</button><button class="mi${V.tablet ? ' on' : ''}" data-act="tablet"><i class="ti ti-device-tablet"></i>${L('Tablet preview (1024px)', 'معاينة الجهاز اللوحي')}${V.tablet ? '<i class="ti ti-check ck"></i>' : ''}</button><div class="sep"></div><button class="mi" data-act="reset"><i class="ti ti-refresh"></i>${L('Reset sample layout', 'إعادة ضبط المخطط')}</button></div>` : ''}</span>
 </div>`;
  }
  /* ---------- exec strip ---------- */
  function kstrip(M) {
    const A = M.filter(m => !m.off),
      sum = k => A.reduce((a, m) => a + m.c[k], 0);
    const good = A.filter(m => m.s === 'ok' || m.s === 'done').length;
    const K = [[L('Zones on track', 'مناطق ضمن المسار'), `${good}<small> / ${A.length}</small>`, good / Math.max(1, A.length), 'var(--tone-blue-solid)'], [L('Open snags', 'ملاحظات مفتوحة'), sum('snag')], [L('Failed inspections', 'فحوصات راسبة'), sum('failed')], [L('Submittals pending approval', 'تقديمات بانتظار الاعتماد'), sum('pending')], [L('Inspections passed', 'فحوصات ناجحة'), sum('passed')]];
    return `<div class="kstrip">${K.map(k => `<div class="kbig"><span>${k[0]}</span><b>${k[1]}</b>${k[2] != null ? `<span class="bar"><i style="width:${Math.round(k[2] * 100)}%;background:${k[3]}"></i></span>` : ''}</div>`).join('')}</div>`;
  }
  /* ---------- canvas ---------- */
  const pts = p => p.map(x => x.join(',')).join(' ');
  const pc = (x, y) => `left:${x / W * 100}%;top:${y / H * 100}%`;
  function canvas(M) {
    if (V.empty) return `<div class="mv-canvas"><div class="mv-empty">${emptyState()}</div></div>`;
    const selM = M.find(m => m.z.id === V.sel);
    const polys = M.map(m => {
      const s = m.s,
        c = col(m);
      const pat = s === 'iss' ? 'url(#pt-iss)' : s === 'att' ? 'url(#pt-att)' : '';
      return `<g class="zp ${s}${V.sel === m.z.id ? ' sel' : ''}${m.off ? ' off' : ''}${V.edit ? ' edit' : ''}" data-z="${m.z.id}"><polygon class="hal" points="${pts(m.z.pts)}"></polygon><polygon class="fil" points="${pts(m.z.pts)}" style="fill:${c}"></polygon>${pat ? `<polygon class="pat" points="${pts(m.z.pts)}" fill="${pat}"></polygon>` : ''}<polygon class="lin" points="${pts(m.z.pts)}" style="stroke:${c}"></polygon></g>`;
    }).join('');
    const marks = M.map(m => {
      const st = ST[m.s];
      return `<div class="mk${V.sel === m.z.id ? ' sel' : ''}${m.off ? ' off' : ''}" data-z="${m.z.id}" style="${pc(m.z.m[0], m.z.m[1])}"><span class="dot" style="background:${m.z.color || st.c}"><i class="ti ${st.ic}"></i>${m.c.open ? `<span class="cn">${m.c.open}</span>` : ''}</span><span class="nm">${esc(short(m.z))}</span></div>`;
    }).join('');
    const vx = V.edit && selM && V.tool === 'select' ? selM.z.pts.map((p, i) => `<span class="vx" data-vx="${i}" style="${pc(p[0], p[1])}"></span>`).join('') : '';
    const dr = V.draft.length ? `<polygon class="draw-f" points="${pts(V.draft)}"></polygon><polyline class="draw-l" points="${pts(V.draft)}"></polyline><line id="dl" class="draw-l" x1="${V.draft.at(-1)[0]}" y1="${V.draft.at(-1)[1]}" x2="${V.draft.at(-1)[0]}" y2="${V.draft.at(-1)[1]}"></line>` : '';
    const dvx = V.draft.map((p, i) => `<span class="vx${i === 0 ? ' first' : ''}" style="${pc(p[0], p[1])}"></span>`).join('');
    const cnt = {};
    M.filter(m => !m.off).forEach(m => cnt[m.s] = (cnt[m.s] || 0) + 1);
    return `<div class="mv-canvas" dir="ltr"><div class="mv-stage${V.edit && V.tool === 'draw' ? ' draw' : ''}" id="stage"><div class="mv-world${selM && !V.edit ? ' has-sel' : ''}" id="world">
  <div class="mv-base">${V.img ? `<img src="${V.img}" alt="">` : `<span class="wm">${L('Sample site plan', 'مخطط موقع تجريبي')}</span>`}</div>
  <svg class="mv-svg" viewBox="0 0 ${W} ${H}"><defs><pattern id="pt-iss" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(45)"><rect width="4" height="12" style="fill:var(--tone-red-solid)"></rect></pattern><pattern id="pt-att" patternUnits="userSpaceOnUse" width="12" height="12"><circle cx="6" cy="6" r="2" style="fill:var(--tone-orange-solid)"></circle></pattern></defs>${polys}${dr}</svg>
  <div class="mv-marks">${marks}${vx}${dvx}</div></div></div>
  ${!V.img ? `<span class="mv-samp"><i class="ti ti-info-circle"></i>${L('Sample base — upload your masterplan in Edit layout', 'خلفية تجريبية — ارفع المخطط العام من تحرير المخطط')}</span>` : ''}
  ${V.edit && V.tool === 'draw' ? `<div class="mv-hint"><i class="ti ti-polygon"></i>${L('Click to add points', 'انقر لإضافة النقاط')} · ${L('click the first point or', 'انقر النقطة الأولى أو')} <kbd>Enter</kbd> ${L('to close', 'للإغلاق')} · <kbd>⌫</kbd> ${L('undo', 'تراجع')} · <kbd>Esc</kbd> ${L('cancel', 'إلغاء')}</div>` : ''}
  <div class="mv-ctl"><div class="grp"><button data-zoom="in" title="${L('Zoom in', 'تكبير')}"><i class="ti ti-zoom-in"></i></button><button data-zoom="out" title="${L('Zoom out', 'تصغير')}"><i class="ti ti-zoom-out"></i></button></div><div class="grp"><button data-zoom="fit" title="${L('Fit to screen', 'ملاءمة الشاشة')}"><i class="ti ti-maximize"></i></button></div><span class="zl" id="zl">100%</span></div>
  <div class="mv-leg" dir="${S.lang === 'ar' ? 'rtl' : 'ltr'}">${ORDER.map(k => {
      const s = ST[k];
      return `<span class="lg-i"><span class="sw" style="background:${s.c}"><i class="ti ${s.ic}"></i></span><span class="lb">${L(s.en, s.ar)}</span><span class="n">${cnt[k] || 0}</span><span class="tipx"><b>${L(s.en, s.ar)}</b>${L(s.den, s.dar)}</span></span>`;
    }).join('')}</div>
  <div class="mv-tip" id="mvtip"></div></div>`;
  }
  function emptyState() {
    const adm = role().edit;
    return `<div class="emp"><span class="ic"><i class="ti ti-map"></i></span><h2>${adm ? L('Upload a site map to get started', 'ارفع خريطة الموقع للبدء') : L('No site map yet', 'لا توجد خريطة للموقع بعد')}</h2><p>${adm ? L('Use a masterplan or aerial render of Al Nakheel Villas Compound. You’ll draw zones on it and link each one to a Location, so everyone sees status by area.', 'استخدم المخطط العام أو صورة جوية لمجمع فلل النخيل. سترسم عليها المناطق وتربط كل منطقة بموقع، ليرى الجميع الحالة حسب المنطقة.') : L('Your Project Admin hasn’t uploaded a site map for this project. You’ll see zone statuses here once they do.', 'لم يرفع مسؤول المشروع خريطة الموقع بعد. ستظهر حالات المناطق هنا بمجرد رفعها.')}</p>
 ${adm ? `<div class="drop" id="drop"><i class="ti ti-file-upload" style="font-size:24px;color:var(--ui-muted)"></i><span style="font-size:13px;color:var(--ui-text-2)">${L('Drag an image here, or', 'اسحب صورة إلى هنا، أو')}</span><span class="row"><button class="cb pri" data-act="upload"><i class="ti ti-upload"></i>${L('Upload site map', 'رفع خريطة الموقع')}</button><button class="cb" data-act="reset">${L('Use sample layout', 'استخدام المخطط التجريبي')}</button></span><span class="fmt">PNG · JPG · WEBP — ${L('up to 20 MB, at least 2000px wide', 'حتى 20 ميجابايت، وعرض 2000 بكسل على الأقل')}</span></div>
 <div class="steps"><div><span class="n">1</span>${L('Upload the masterplan or aerial image.', 'ارفع المخطط العام أو الصورة الجوية.')}</div><div><span class="n">2</span>${L('Draw a polygon around each Zone, Phase, Building or Villa cluster.', 'ارسم مضلعًا حول كل منطقة أو مرحلة أو مبنى أو مجموعة فلل.')}</div><div><span class="n">3</span>${L('Link each polygon to a Location — statuses fill in automatically.', 'اربط كل مضلع بموقع — تظهر الحالات تلقائيًا.')}</div></div>` : `<button class="cb" data-act="reset">${L('Show sample layout', 'عرض المخطط التجريبي')}</button>`}</div>`;
  }
  /* ---------- panels ---------- */
  function tiles(c) {
    return `<div class="tiles"><div class="tl${c.snag ? ' hot' : ''}"><b>${c.snag}</b><span><i class="ti ti-flag"></i>${L('Open snags', 'ملاحظات مفتوحة')}</span></div><div class="tl${c.failed ? ' hot' : ''}"><b>${c.failed}</b><span><i class="ti ti-circle-x"></i>${L('Failed inspections', 'فحوصات راسبة')}</span></div><div class="tl${c.pending >= 3 ? ' warm' : ''}"><b>${c.pending}</b><span><i class="ti ti-hourglass-high"></i>${L('Pending approval', 'بانتظار الاعتماد')}</span></div><div class="tl"><b>${c.passed}</b><span><i class="ti ti-circle-check"></i>${L('Inspections passed', 'فحوصات ناجحة')}</span></div></div>`;
  }
  const chipS = s => `<span class="zs" style="background:${ST[s].t};color:${ST[s].f}"><i class="ti ${ST[s].ic}"></i>${L(ST[s].en, ST[s].ar)}</span>`;
  const units = d => d ? `${d.units[0]} ${L(d.units[1], d.units[2])}` : L('Not linked to data yet', 'غير مرتبط بالبيانات بعد');
  function overview(M) {
    const A = M.filter(m => !m.off);
    const T = {
      snag: 0,
      failed: 0,
      pending: 0,
      passed: 0
    };
    A.forEach(m => Object.keys(T).forEach(k => T[k] += m.c[k]));
    const cnt = {};
    A.forEach(m => cnt[m.s] = (cnt[m.s] || 0) + 1);
    const sc = m => m.c.failed * 3 + m.c.snag * 2 + m.c.pending;
    const rank = [...A].sort((a, b) => sc(b) - sc(a) || ORDER.indexOf(a.s) - ORDER.indexOf(b.s));
    const iss = A.filter(m => m.s === 'iss'),
      att = A.filter(m => m.s === 'att'),
      good = A.filter(m => m.s === 'ok' || m.s === 'done');
    const names = a => a.map(m => `<b>${esc(short(m.z))}</b>`).join(L(' and ', ' و'));
    const sum = A.length ? `${L(`${good.length} of ${A.length} zones are on track or complete.`, `${good.length} من ${A.length} مناطق ضمن المسار أو مكتملة.`)} ${iss.length ? L(`${names(iss)} need action now — ${iss.reduce((a, m) => a + m.c.snag, 0)} open snags and ${iss.reduce((a, m) => a + m.c.failed, 0)} failed inspections between them.`, `${names(iss)} تحتاج إلى إجراء فوري — ${iss.reduce((a, m) => a + m.c.snag, 0)} ملاحظات مفتوحة و${iss.reduce((a, m) => a + m.c.failed, 0)} فحوصات راسبة.`) : ''} ${att.length ? L(`Keep an eye on ${names(att)}.`, `تابع ${names(att)}.`) : ''} ${T.pending ? L(`${T.pending} submittals are waiting for approval across the site.`, `${T.pending} تقديمات بانتظار الاعتماد في الموقع.`) : ''}` : L('No zones match the current filters.', 'لا توجد مناطق مطابقة للتصفية الحالية.');
    return `<div class="mp-hd"><div><h3>${L('Project overview', 'نظرة عامة على المشروع')}</h3><small>${A.length} ${L('zones', 'مناطق')} · 113 ${L('villas', 'فيلا')} · ${L('visible to', 'مرئي لـ')} ${L(role().en, role().ar)}</small></div><button class="cb ter sm ic x tbl-only" data-act="panel"><i class="ti ti-x"></i></button></div>
 <div class="mp-bd">
 <div class="sec"><h6>${L('Totals', 'الإجماليات')}</h6>${tiles(T)}</div>
 <div class="sec"><h6>${L('Zone status', 'حالة المناطق')}</h6><div class="sbar">${ORDER.filter(k => cnt[k]).map(k => `<i style="flex:${cnt[k]};background:${ST[k].c}"></i>`).join('')}</div><div class="slist">${ORDER.filter(k => cnt[k]).map(k => `<span><i style="background:${ST[k].c}"></i>${L(ST[k].en, ST[k].ar)} <b>${cnt[k]}</b></span>`).join('')}</div></div>
 <div class="sec"><h6>${L('Executive summary', 'الملخص التنفيذي')}</h6><div class="exec">${sum}</div></div>
 ${V.exec ? `<div class="sec"><h6>${L('Schedule & budget', 'الجدول والميزانية')}<small>${L('Coming soon', 'قريبًا')}</small></h6><div class="soons">${[['ti-calendar-time', L('Schedule progress', 'تقدم الجدول الزمني'), '—%', L('Available with Schedule module', 'متاح مع وحدة الجدول الزمني')], ['ti-cash', L('Budget utilisation', 'استخدام الميزانية'), '—%', L('Available with Financial module', 'متاح مع الوحدة المالية')], ['ti-calendar-event', L('Forecast finish date', 'تاريخ الإنجاز المتوقع'), '— — —', L('Available with Schedule module', 'متاح مع وحدة الجدول الزمني')]].map(x => `<div class="soon"><span class="h"><i class="ti ${x[0]}"></i>${x[1]}</span><b>${x[2]}</b><small><i class="ti ti-lock"></i>${x[3]}</small></div>`).join('')}</div></div>` : ''}
 <div class="sec"><h6>${L('Zone ranking', 'ترتيب المناطق')}<small>${L('Most issues first', 'الأكثر مشكلات أولًا')}</small></h6><div class="rank">${rank.map((m, i) => `<button class="rk" data-sel="${m.z.id}"><span class="no">${i + 1}</span><span class="ic" style="background:${ST[m.s].c}"><i class="ti ${ST[m.s].ic}"></i></span><span class="tx"><b>${esc(nm(m.z))}</b><small>${m.c.total ? `${m.c.snag} ${L('snags', 'ملاحظات')} · ${m.c.failed} ${L('failed', 'راسب')} · ${m.c.pending} ${L('pending', 'معلّق')}` : L(ST[m.s].en, ST[m.s].ar)}</small></span><span class="n" style="color:${m.c.open ? ST[m.s].f : 'var(--ui-faint)'}">${m.c.open}</span></button>`).join('')}</div></div>
 </div>`;
  }
  function zoneP(m) {
    const d = data(m.z.id),
      c = m.c;
    const loc = LOCS.find(l => l.id === m.z.loc);
    const top = c.items.filter(it => it.kind === 'failed' || it.kind === 'snag').sort((a, b) => (b.kind === 'failed') - (a.kind === 'failed') || b.age - a.age).slice(0, 3);
    return `<div class="mp-hd"><button class="cb ter sm ic bk" data-act="desel" title="${L('Back to overview', 'العودة للنظرة العامة')}"><i class="ti ti-arrow-left"></i></button><div style="min-width:0"><h3>${esc(nm(m.z))}</h3><small>${units(d)}${d ? ' · ' + L(PHASES[d.ph][0], PHASES[d.ph][1]) : ''}</small></div><button class="cb ter sm ic x" data-act="desel"><i class="ti ti-x"></i></button></div>
 <div class="mp-bd">
 <div class="sec" style="display:flex;flex-direction:column;gap:8px">${chipS(m.s)}<div class="why"><i class="ti ti-info-circle"></i>${why(m.s, c)}</div>${loc ? `<div class="crumb"><i class="ti ti-map-pin"></i>${L('Al Nakheel', 'النخيل')}<i class="ti ti-chevron-right"></i>${esc(L(loc.en, loc.ar))}</div>` : ''}</div>
 <div class="sec"><h6>${L('Work items', 'عناصر العمل')}${V.role !== 'admin' ? `<small><i class="ti ti-eye" style="font-size:12px"></i> ${L('Visible to you only', 'المرئي لك فقط')}</small>` : ''}</h6>${tiles(c)}</div>
 <div class="sec"><h6>${L('Top open issues', 'أهم المشكلات المفتوحة')}<small>${c.open}</small></h6>${top.length ? `<div class="iss">${top.map(it => {
      const t = TRADES[it.tr],
        f = it.kind === 'failed';
      return `<div class="is"><span class="ic" style="background:${f ? 'var(--tone-red-tint)' : 'var(--tone-orange-tint)'};color:${f ? 'var(--tone-red-fg)' : 'var(--tone-orange-fg)'}"><i class="ti ${f ? 'ti-circle-x' : 'ti-flag'}"></i></span><div class="tx"><b>${esc(L(it.t[0], it.t[1]))}</b><div class="mt"><span class="chip" style="height:20px;font-size:11px;background:var(--tone-${t[2]}-tint);color:var(--tone-${t[2]}-fg)">${L(t[0], t[1])}</span><span>${f ? L('Failed inspection', 'فحص راسب') : L('Snag', 'ملاحظة')}</span><span>·</span><span>${L(COS[it.co][0], COS[it.co][1])}</span><span>·</span><span>${it.age}${L('d open', 'ي مفتوحة')}</span></div></div></div>`;
    }).join('')}</div>` : `<div class="none">${L('No open issues in this zone.', 'لا توجد مشكلات مفتوحة في هذه المنطقة.')}</div>`}</div>
 </div>
 <div class="mp-ft"><button class="cb pri" data-act="floor"><i class="ti ti-stairs"></i>${L('Open Floor View', 'فتح عرض الطوابق')}</button><a class="cb" href="submittals-list.html"><i class="ti ti-list"></i>${L('Open in list', 'فتح في القائمة')}</a></div>`;
  }
  function editP(M) {
    const m = M.find(x => x.z.id === V.sel);
    if (!m) return `<div class="mp-hd"><div><h3>${L('Site layout', 'مخطط الموقع')}</h3><small>${L('Select a zone to edit it, or draw a new one.', 'حدّد منطقة لتعديلها أو ارسم منطقة جديدة.')}</small></div></div><div class="mp-bd"><div class="steps"><div><span class="n">1</span>${L('Choose Draw zone and click around an area on the map.', 'اختر رسم منطقة وانقر حول مساحة على الخريطة.')}</div><div><span class="n">2</span>${L('Close the shape on the first point.', 'أغلق الشكل عند النقطة الأولى.')}</div><div><span class="n">3</span>${L('Link it to a Location and set its name.', 'اربطه بموقع وحدد اسمه.')}</div></div><div class="sec"><h6>${L('Zones', 'المناطق')}<small>${V.layout.length}</small></h6><div class="zlist">${M.map(x => `<button class="rk" data-sel="${x.z.id}"><span class="ic" style="background:${col(x)}"><i class="ti ti-polygon"></i></span><span class="tx"><b>${esc(nm(x.z))}</b><small>${x.z.loc ? esc(L(LOCS.find(l => l.id === x.z.loc).en, LOCS.find(l => l.id === x.z.loc).ar)) : `<span style="color:var(--tone-orange-fg)">${L('No location linked', 'لا يوجد موقع مرتبط')}</span>`}</small></span></button>`).join('')}</div></div></div>`;
    const loc = LOCS.find(l => l.id === m.z.loc);
    const q = V.pq.trim().toLowerCase();
    const SW = [null, 'var(--tone-blue-solid)', 'var(--tone-violet-solid)', 'var(--tone-cyan-solid)', 'var(--tone-amber-solid)', 'var(--tone-tomato-solid)', 'var(--tone-gray-solid)'];
    const picker = V.picker ? `<div class="picker"><div class="ps"><i class="ti ti-search"></i><input id="pq" placeholder="${L('Search locations', 'ابحث في المواقع')}" value="${esc(V.pq)}"></div><div class="pl">${LOCS.filter(l => !q || (l.en + ' ' + l.ar).toLowerCase().includes(q)).map(l => {
      const used = V.layout.find(z => z.loc === l.id && z.id !== m.z.id);
      const grp = l.d === 0 || l.group;
      return `<button class="lo${grp ? ' grp' : ''}${m.z.loc === l.id ? ' on' : ''}${used ? ' used' : ''}" ${grp ? '' : `data-loc="${l.id}"`} style="padding-inline-start:${8 + l.d * 16}px"><i class="ti ${l.d === 0 ? 'ti-buildings' : grp ? 'ti-folder' : 'ti-map-pin'}"></i>${esc(L(l.en, l.ar))}${used ? `<small>${L('Linked', 'مرتبط')} · ${esc(short(used))}</small>` : l.s ? `<small>${L(l.s[0], l.s[1])}</small>` : ''}</button>`;
    }).join('')}</div></div>` : '';
    return `<div class="mp-hd"><button class="cb ter sm ic bk" data-act="desel"><i class="ti ti-arrow-left"></i></button><div><h3>${L('Zone properties', 'خصائص المنطقة')}</h3><small>${m.z.pts.length} ${L('points · drag the handles to reshape', 'نقاط · اسحب المقابض لتعديل الشكل')}</small></div></div>
 <div class="mp-bd">
 <div class="fld2"><label>${L('Name', 'الاسم')} (EN)</label><input data-name="en" value="${esc(m.z.en)}"></div>
 <div class="fld2"><label>${L('Name', 'الاسم')} (AR)</label><input data-name="ar" dir="rtl" value="${esc(m.z.ar)}"></div>
 <div class="fld2"><label>${L('Linked location', 'الموقع المرتبط')}</label><button class="locbtn${loc ? '' : ' need'}" data-act="picker"><i class="ti ${loc ? 'ti-map-pin' : 'ti-alert-circle'}"></i>${loc ? esc(L(loc.en, loc.ar)) : L('Link a Location from the project tree', 'اربط موقعًا من شجرة المشروع')}<i class="ti ti-chevron-${V.picker ? 'up' : 'down'}"></i></button>${picker}${!loc ? `<div class="warnx"><i class="ti ti-info-circle"></i>${L('Statuses appear once the zone is linked to a Location.', 'تظهر الحالات بمجرد ربط المنطقة بموقع.')}</div>` : ''}</div>
 <div class="fld2"><label>${L('Colour', 'اللون')}</label><div class="cols">${SW.map(c => c ? `<button class="cs${m.z.color === c ? ' on' : ''}" data-color="${c}" style="background:${c}">${m.z.color === c ? '<i class="ti ti-check"></i>' : ''}</button>` : `<button class="cs auto${!m.z.color ? ' on' : ''}" data-color="">${L('Auto · by status', 'تلقائي · حسب الحالة')}</button>`).join('')}</div></div>
 </div>
 <div class="mp-ft"><button class="cb" data-act="delzone" style="color:var(--tone-red-fg)"><i class="ti ti-trash"></i>${L('Delete zone', 'حذف المنطقة')}</button><button class="cb pri" data-act="desel"><i class="ti ti-check"></i>${L('Done', 'تم')}</button></div>`;
  }
  function subview() {
    const m = V.layout.find(z => z.id === V.sel);
    const k = V.view === 'floor';
    return `<div class="subv"><div class="emp"><span class="ic"><i class="ti ${k ? 'ti-stairs' : 'ti-vector'}"></i></span><div class="crumb" style="justify-content:center"><button class="cb ter sm" data-view="map"><i class="ti ti-map"></i>${L('Map View', 'عرض الخريطة')}</button>${m ? `<i class="ti ti-chevron-right"></i><span>${esc(nm(m))}</span>` : ''}<i class="ti ti-chevron-right"></i><b style="color:var(--ui-text)">${k ? L('Floor View', 'عرض الطوابق') : L('Plan View', 'عرض المخطط')}</b></div><h2>${k ? L('Floor View is designed next', 'عرض الطوابق هو التالي في التصميم') : L('Plan View is designed next', 'عرض المخطط هو التالي في التصميم')}</h2><p>${k ? L('Shows each building’s floors with status, drilled in from a zone on the Map View.', 'يعرض طوابق كل مبنى مع حالتها، انطلاقًا من منطقة في عرض الخريطة.') : L('Shows a floor’s plan drawing with Work Items pinned to rooms.', 'يعرض مخطط الطابق مع عناصر العمل مثبتة على الغرف.')}</p><button class="cb pri" data-view="map"><i class="ti ti-arrow-left"></i>${L('Back to Map View', 'العودة إلى عرض الخريطة')}</button></div></div>`;
  }
  function view() {
    const M = model();
    if (V.view !== 'map') return `${toolbar()}${subview()}${V.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>` : ''}`;
    const selM = M.find(m => m.z.id === V.sel);
    const panel = V.empty ? '' : V.edit ? editP(M) : selM ? zoneP(selM) : overview(M);
    const shut = !(V.sel || V.panelOpen || V.edit);
    return `${toolbar()}${V.exec && !V.edit && !V.empty ? kstrip(M) : ''}<div class="mv-body${V.empty ? ' nopanel' : ''}">${canvas(M)}${panel ? `<aside class="mv-panel${shut ? ' shut' : ''}">${panel}</aside>` : ''}</div>${V.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>` : ''}`;
  }
  /* ---------- transform ---------- */
  function applyT() {
    const w = document.getElementById('world');
    if (!w) return;
    w.style.transform = `translate(${V.tx}px,${V.ty}px) scale(${V.k})`;
    w.style.setProperty('--inv', 1 / V.k);
    const z = document.getElementById('zl');
    if (z) z.textContent = Math.round(V.k * 100) + '%';
  }
  function fit() {
    const s = document.getElementById('stage');
    if (!s) return;
    const r = s.getBoundingClientRect();
    if (!r.width) return;
    V.k = Math.min(r.width / W, r.height / H) * .94;
    V.tx = (r.width - W * V.k) / 2;
    V.ty = (r.height - H * V.k) / 2;
    V.auto = true;
    applyT();
  }
  function zoomAt(f, cx, cy) {
    const k2 = Math.max(.4, Math.min(5, V.k * f));
    V.tx = cx - (cx - V.tx) * (k2 / V.k);
    V.ty = cy - (cy - V.ty) * (k2 / V.k);
    V.k = k2;
    V.auto = false;
    applyT();
  }
  function toWorld(e) {
    const r = document.getElementById('stage').getBoundingClientRect();
    return [Math.round((e.clientX - r.left - V.tx) / V.k), Math.round((e.clientY - r.top - V.ty) / V.k)];
  }
  const cen = p => [Math.round(p.reduce((a, x) => a + x[0], 0) / p.length), Math.round(p.reduce((a, x) => a + x[1], 0) / p.length)];
  /* ---------- bind ---------- */
  function bind(root, R) {
    let tt;
    const flash = m => {
      V.toast = m;
      R.inner();
      clearTimeout(tt);
      tt = setTimeout(() => {
        V.toast = null;
        R.inner();
      }, 2200);
    };
    const mark = () => {
      V.dirty = true;
    };
    function closeDraft() {
      if (V.draft.length < 3) return;
      const n = V.layout.filter(z => z.isNew).length + 1;
      const z = {
        id: 'n' + Date.now(),
        en: 'New zone ' + n,
        ar: 'منطقة جديدة ' + n,
        pts: V.draft,
        m: cen(V.draft),
        loc: null,
        color: null,
        isNew: 1
      };
      V.layout.push(z);
      V.draft = [];
      V.sel = z.id;
      V.tool = 'select';
      V.picker = true;
      V.pq = '';
      mark();
      R.inner();
    }
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.style.display = 'none';
    document.body.appendChild(file);
    function loadImg(f) {
      if (!f || !/^image\//.test(f.type)) return;
      const rd = new FileReader();
      rd.onload = () => {
        const fromEmpty = V.empty;
        V.img = rd.result;
        if (fromEmpty) {
          V.empty = false;
          V.layout = [];
          V.edit = true;
          V.backup = {
            layout: [],
            img: null
          };
          V.tool = 'draw';
        }
        mark();
        V.auto = true;
        R.inner();
        flash(L('Site map uploaded', 'تم رفع خريطة الموقع'));
      };
      rd.readAsDataURL(f);
    }
    file.addEventListener('change', () => {
      loadImg(file.files[0]);
      file.value = '';
    });
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-menu],[data-f],[data-role],[data-act],[data-view],[data-tool],[data-zoom],[data-sel],[data-loc],[data-color]');
      if (!b) {
        if (V.menu && !e.target.closest('[data-stop]')) {
          V.menu = null;
          R.inner();
        }
        return;
      }
      if (b.closest('.hd,.tabs,.sb')) return;
      const d = b.dataset;
      if (d.menu) {
        e.stopPropagation();
        V.menu = V.menu === d.menu ? null : d.menu;
        return R.inner();
      }
      if (d.f !== undefined) {
        const [k, v] = d.f.split(':');
        V.f[k] = v;
        V.menu = null;
        return R.inner();
      }
      if (d.role) {
        V.role = d.role;
        V.menu = null;
        const r = ROLES[d.role];
        if (r.co && V.f.co && !r.co.includes(V.f.co)) V.f.co = '';
        if (r.tr && V.f.tr && !r.tr.includes(V.f.tr)) V.f.tr = '';
        if (!r.edit && V.edit) {
          V.edit = false;
          V.draft = [];
        }
        return R.inner();
      }
      if (d.view) {
        if (d.view === 'floor') {
          location.href = 'floor-view.html';
          return;
        }
        if (d.view === 'plan') {
          location.href = 'plan-view.html';
          return;
        }
        V.view = d.view;
        S.mv = d.view;
        V.menu = null;
        history.replaceState(null, '', '?v=' + d.view);
        V.auto = true;
        return R.full();
      }
      if (d.tool) {
        V.tool = d.tool;
        V.draft = [];
        if (d.tool === 'draw') V.sel = null;
        return R.inner();
      }
      if (d.zoom) {
        const s = document.getElementById('stage').getBoundingClientRect();
        if (d.zoom === 'fit') return fit();
        return zoomAt(d.zoom === 'in' ? 1.3 : 1 / 1.3, s.width / 2, s.height / 2);
      }
      if (d.sel) {
        V.sel = d.sel;
        V.picker = false;
        return R.inner();
      }
      if (d.loc) {
        const z = V.layout.find(z => z.id === V.sel);
        const l = LOCS.find(x => x.id === d.loc);
        z.loc = d.loc;
        if (z.isNew && /^New zone/.test(z.en)) {
          z.en = l.en.replace(' — ', ' – ');
          z.ar = l.ar.replace(' — ', ' – ');
        }
        V.picker = false;
        mark();
        return R.inner();
      }
      if (d.color !== undefined) {
        const z = V.layout.find(z => z.id === V.sel);
        z.color = d.color || null;
        mark();
        return R.inner();
      }
      const a = d.act;
      V.menu = null;
      if (a === 'exec') {
        V.exec = !V.exec;
        if (V.exec) {
          V.prevMode = S.mode;
          S.mode = 'dark';
        } else S.mode = V.prevMode || 'light';
        return R.full();
      }
      if (a === 'edit') {
        V.edit = true;
        V.exec && (V.exec = false, S.mode = V.prevMode || 'light');
        V.backup = {
          layout: clone(V.layout),
          img: V.img
        };
        V.dirty = false;
        V.tool = 'select';
        return R.full();
      }
      if (a === 'canceledit') {
        V.layout = V.backup.layout;
        V.img = V.backup.img;
        V.edit = false;
        V.draft = [];
        V.sel = null;
        V.dirty = false;
        return R.inner();
      }
      if (a === 'save') {
        V.draft = [];
        V.edit = false;
        V.dirty = false;
        V.sel = null;
        try {
          localStorage.setItem(KEY, JSON.stringify({
            layout: V.layout,
            img: V.img
          }));
        } catch (err) {
          try {
            localStorage.setItem(KEY, JSON.stringify({
              layout: V.layout
            }));
          } catch (e2) {}
        }
        return flash(L('Layout saved — everyone on the project sees it now', 'تم حفظ المخطط — يراه الجميع في المشروع الآن'));
      }
      if (a === 'upload') return file.click();
      if (a === 'delzone') {
        V.layout = V.layout.filter(z => z.id !== V.sel);
        V.sel = null;
        mark();
        return R.inner();
      }
      if (a === 'desel') {
        V.sel = null;
        V.picker = false;
        return R.inner();
      }
      if (a === 'picker') {
        V.picker = !V.picker;
        V.pq = '';
        R.inner();
        const i = document.getElementById('pq');
        i && i.focus();
        return;
      }
      if (a === 'floor') {
        location.href = 'floor-view.html';
        return;
      }
      if (a === 'clearf') {
        V.f = {
          tr: '',
          type: '',
          co: '',
          ph: ''
        };
        return R.inner();
      }
      if (a === 'panel') {
        V.panelOpen = !V.panelOpen;
        if (!V.panelOpen) V.sel = null;
        return R.inner();
      }
      if (a === 'empty') {
        V.empty = true;
        V.edit = false;
        V.sel = null;
        V.exec && (V.exec = false, S.mode = V.prevMode || 'light');
        return R.full();
      }
      if (a === 'tablet') {
        V.tablet = !V.tablet;
        V.auto = true;
        return R.full();
      }
      if (a === 'reset') {
        V.layout = sample();
        V.img = null;
        V.empty = false;
        V.edit = false;
        V.sel = null;
        V.draft = [];
        try {
          localStorage.removeItem(KEY);
        } catch (e) {}
        V.auto = true;
        return R.inner();
      }
    });
    root.addEventListener('input', e => {
      const i = e.target;
      if (i.id === 'pq') {
        V.pq = i.value;
        const p = i.selectionStart;
        R.inner();
        const n = document.getElementById('pq');
        n.focus();
        n.setSelectionRange(p, p);
      }
      if (i.dataset.name) {
        const z = V.layout.find(z => z.id === V.sel);
        z[i.dataset.name] = i.value;
        mark();
        const mk = root.querySelector(`.mk[data-z="${z.id}"] .nm`);
        if (mk) mk.textContent = short(z);
      }
    });
    root.addEventListener('dragover', e => {
      const dz = e.target.closest('#drop');
      if (dz) {
        e.preventDefault();
        dz.classList.add('over');
      }
    });
    root.addEventListener('dragleave', e => {
      const dz = e.target.closest('#drop');
      dz && dz.classList.remove('over');
    });
    root.addEventListener('drop', e => {
      const dz = e.target.closest('#drop');
      if (dz) {
        e.preventDefault();
        loadImg(e.dataTransfer.files[0]);
      }
    });
    // pan / zoom / pick / draw
    let P = null;
    root.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const st = e.target.closest('#stage');
      if (!st) return;
      const vx = e.target.closest('[data-vx]');
      P = {
        x: e.clientX,
        y: e.clientY,
        tx: V.tx,
        ty: V.ty,
        moved: false,
        vx: vx ? +vx.dataset.vx : null,
        t: e.target
      };
    });
    addEventListener('pointermove', e => {
      const tip = document.getElementById('mvtip'),
        st = document.getElementById('stage');
      if (!st) return;
      if (P) {
        const dx = e.clientX - P.x,
          dy = e.clientY - P.y;
        if (!P.moved && Math.hypot(dx, dy) > 4) {
          P.moved = true;
          if (P.vx == null) st.classList.add('panning');
        }
        if (P.moved) {
          if (P.vx != null) {
            const z = V.layout.find(z => z.id === V.sel);
            z.pts[P.vx] = toWorld(e);
            const g = root.querySelector(`.zp[data-z="${z.id}"]`);
            g && g.querySelectorAll('polygon').forEach(p => p.setAttribute('points', pts(z.pts)));
            const h = root.querySelector(`[data-vx="${P.vx}"]`);
            if (h) {
              h.style.left = z.pts[P.vx][0] / W * 100 + '%';
              h.style.top = z.pts[P.vx][1] / H * 100 + '%';
            }
          } else {
            V.tx = P.tx + dx;
            V.ty = P.ty + dy;
            V.auto = false;
            applyT();
          }
        }
        if (tip) tip.style.display = 'none';
        return;
      }
      const dl = document.getElementById('dl');
      if (dl && st.contains(e.target)) {
        const w = toWorld(e);
        dl.setAttribute('x2', w[0]);
        dl.setAttribute('y2', w[1]);
      }
      if (!tip) return;
      const g = e.target.closest && e.target.closest('#stage [data-z]');
      if (!g || V.edit && V.tool === 'draw') {
        tip.style.display = 'none';
        return;
      }
      const m = model().find(x => x.z.id === g.dataset.z);
      if (!m) {
        tip.style.display = 'none';
        return;
      }
      const r = st.getBoundingClientRect();
      tip.innerHTML = `<b>${esc(nm(m.z))}</b> · ${m.c.open} ${L(m.c.open === 1 ? 'open issue' : 'open issues', 'مشكلات مفتوحة')}<div class="s"><i style="background:${ST[m.s].c}"></i>${L(ST[m.s].en, ST[m.s].ar)}${m.c.pending ? ` · ${m.c.pending} ${L('pending approval', 'بانتظار الاعتماد')}` : ''}</div>`;
      tip.style.display = 'block';
      let x = e.clientX - r.left + 14,
        y = e.clientY - r.top + 14;
      const tw = tip.offsetWidth;
      if (x + tw > r.width - 8) x = e.clientX - r.left - tw - 14;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    });
    addEventListener('pointerup', e => {
      if (!P) return;
      const p = P;
      P = null;
      const st = document.getElementById('stage');
      st && st.classList.remove('panning');
      if (p.moved) {
        if (p.vx != null) {
          const z = V.layout.find(z => z.id === V.sel);
          if (z.id.startsWith('n') || !['road'].includes(z.id)) z.m = cen(z.pts);
          mark();
          R.inner();
        }
        return;
      }
      if (V.edit && V.tool === 'draw') {
        const w = toWorld(e);
        if (V.draft.length >= 3) {
          const f = V.draft[0];
          if (Math.hypot((f[0] - w[0]) * V.k, (f[1] - w[1]) * V.k) < 14) return closeDraft();
        }
        V.draft.push(w);
        return R.inner();
      }
      const g = p.t.closest && p.t.closest('[data-z]');
      V.sel = g ? g.dataset.z : null;
      V.picker = false;
      R.inner();
    });
    root.addEventListener('wheel', e => {
      const st = e.target.closest('#stage');
      if (!st) return;
      e.preventDefault();
      const r = st.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, {
      passive: false
    });
    addEventListener('resize', () => {
      if (V.auto) fit();
    });
    document.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input')) return;
      if (V.edit && V.tool === 'draw') {
        if (e.key === 'Enter') {
          e.preventDefault();
          return closeDraft();
        }
        if (e.key === 'Backspace' && V.draft.length) {
          e.preventDefault();
          V.draft.pop();
          return R.inner();
        }
        if (e.key === 'Escape') {
          V.draft.length ? V.draft = [] : V.tool = 'select';
          return R.inner();
        }
      }
      if (V.edit && (e.key === 'v' || e.key === 'V')) {
        V.tool = 'select';
        V.draft = [];
        return R.inner();
      }
      if (V.edit && (e.key === 'p' || e.key === 'P')) {
        V.tool = 'draw';
        V.sel = null;
        return R.inner();
      }
      if (e.key === 'Escape' && (V.sel || V.menu)) {
        V.sel = null;
        V.menu = null;
        R.inner();
      }
      if ((e.key === '+' || e.key === '=') && document.getElementById('stage')) {
        const s = document.getElementById('stage').getBoundingClientRect();
        zoomAt(1.3, s.width / 2, s.height / 2);
      }
      if (e.key === '-' && document.getElementById('stage')) {
        const s = document.getElementById('stage').getBoundingClientRect();
        zoomAt(1 / 1.3, s.width / 2, s.height / 2);
      }
    });
  }
  function after() {
    if (V.auto) fit();else applyT();
  }
  window.MV = {
    V,
    view,
    bind,
    after
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/map/map.js", error: String((e && e.message) || e) }); }

// ui_kits/app/plan/data.js
try { (() => {
// Plan View — sample data + drawing. Exposes window.PD.
(function () {
  const W = 1200,
    H = 800;
  const TYPE = {
    snag: {
      en: 'Snag',
      ar: 'ملاحظة',
      code: 'SNG',
      shape: 'circle'
    },
    insp: {
      en: 'Inspection Request',
      ar: 'طلب فحص',
      code: 'IR',
      shape: 'diamond'
    },
    com: {
      en: 'Comment',
      ar: 'تعليق',
      code: 'COM',
      shape: 'square'
    }
  };
  const STAT = {
    open: {
      en: 'Open',
      ar: 'مفتوح',
      c: 'var(--tone-orange-solid)',
      t: 'var(--tone-orange-tint)',
      f: 'var(--tone-orange-fg)'
    },
    review: {
      en: 'In review',
      ar: 'قيد المراجعة',
      c: 'var(--tone-blue-solid)',
      t: 'var(--tone-blue-tint)',
      f: 'var(--tone-blue-fg)'
    },
    failed: {
      en: 'Failed',
      ar: 'راسب',
      c: 'var(--tone-red-solid)',
      t: 'var(--tone-red-tint)',
      f: 'var(--tone-red-fg)'
    },
    closed: {
      en: 'Closed',
      ar: 'مغلق',
      c: 'var(--tone-green-solid)',
      t: 'var(--tone-green-tint)',
      f: 'var(--tone-green-fg)'
    },
    draft: {
      en: 'Draft',
      ar: 'مسودة',
      c: 'var(--tone-gray-solid)',
      t: 'var(--tone-gray-tint)',
      f: 'var(--tone-gray-fg)'
    }
  };
  const STAGE = {
    open: ['Raised · with contractor', 'مُسجّلة · لدى المقاول'],
    review: ['Fixed · awaiting consultant', 'مُصلحة · بانتظار الاستشاري'],
    failed: ['Inspection failed · re-work', 'رسب الفحص · إعادة عمل'],
    closed: ['Closed out', 'مغلقة'],
    draft: ['Draft', 'مسودة']
  };
  const TR = {
    EL: ['Electrical', 'كهرباء', 'cyan'],
    PL: ['Plumbing', 'سباكة', 'blue'],
    AR: ['Finishes', 'تشطيبات', 'violet'],
    FS: ['Firestopping', 'عزل الحريق', 'orange'],
    ME: ['Mechanical', 'ميكانيكا', 'green'],
    CV: ['Civil', 'مدني', 'amber']
  };
  const CO = {
    tmc: ['TMC Constructions', 'تي إم سي للمقاولات', '#f8552f', 'TMC'],
    dry: ['Gulf Dryliners', 'الخليج للألواح الجافة', '#7a5af0', 'GDL'],
    fire: ['FireSafe Systems', 'فاير سيف للأنظمة', '#e98b45', 'FSS'],
    mep: ['ALEC MEP', 'ألك للأعمال الكهروميكانيكية', '#1fae66', 'ALC']
  };
  const TRCO = {
    EL: 'tmc',
    PL: 'mep',
    ME: 'mep',
    AR: 'dry',
    FS: 'fire',
    CV: 'tmc'
  };
  const ROLES = {
    admin: {
      en: 'Project Admin',
      ar: 'مسؤول المشروع',
      sub: ['All companies', 'جميع الشركات']
    },
    tmc: {
      en: 'TMC Constructions',
      ar: 'تي إم سي للمقاولات',
      sub: ['Contractor · own work only', 'مقاول · أعمال الشركة فقط'],
      co: 'tmc'
    },
    dry: {
      en: 'Gulf Dryliners',
      ar: 'الخليج للألواح الجافة',
      sub: ['Contractor · own work only', 'مقاول · أعمال الشركة فقط'],
      co: 'dry'
    }
  };
  const ROOMS = [{
    id: 'a1',
    en: 'Apt 201',
    ar: 'شقة 201',
    r: [70, 70, 330, 250]
  }, {
    id: 'a2',
    en: 'Apt 202',
    ar: 'شقة 202',
    r: [420, 70, 330, 250]
  }, {
    id: 'a3',
    en: 'Apt 203',
    ar: 'شقة 203',
    r: [800, 70, 330, 250]
  }, {
    id: 'a4',
    en: 'Apt 204',
    ar: 'شقة 204',
    r: [70, 480, 330, 250]
  }, {
    id: 'a5',
    en: 'Apt 205',
    ar: 'شقة 205',
    r: [800, 480, 330, 250]
  }, {
    id: 'cor',
    en: 'Corridor',
    ar: 'الممر',
    r: [70, 340, 1060, 120]
  }, {
    id: 'core',
    en: 'Lift & stair core',
    ar: 'نواة المصاعد والدرج',
    r: [440, 480, 230, 250]
  }, {
    id: 'r1',
    en: 'Riser 01',
    ar: 'الرايزر ٠١',
    r: [680, 480, 100, 120]
  }, {
    id: 'r2',
    en: 'Riser 02',
    ar: 'الرايزر ٠٢',
    r: [680, 610, 100, 120]
  }];
  const TITLES = {
    EL: [['Cable tray not bonded', 'حامل الكابلات غير موصول بالتأريض'], ['Socket outlet loose', 'مقبس كهربائي غير مثبت'], ['Missing cable labels', 'ملصقات الكابلات مفقودة'], ['Light fitting misaligned', 'وحدة إنارة غير مستقيمة'], ['Conduit not capped', 'أنبوب التمديد غير مغلق']],
    PL: [['Leak at WC connector', 'تسرب عند وصلة المرحاض'], ['Pipe insulation torn', 'عزل الأنبوب ممزق'], ['Floor drain level wrong', 'منسوب مصرف الأرضية خاطئ']],
    AR: [['Plasterboard joint cracked', 'تشقق في وصلة الجبس'], ['Paint drips on skirting', 'قطرات دهان على النعلة'], ['Door frame out of plumb', 'إطار الباب غير رأسي'], ['Tile lippage over 2 mm', 'بروز البلاط أكثر من 2 مم'], ['Ceiling access panel missing', 'لوحة وصول السقف مفقودة']],
    FS: [['Firestopping incomplete at riser', 'عزل الحريق غير مكتمل عند الرايزر'], ['Collar undersized on SVP', 'طوق أنبوب الصرف أصغر من المطلوب']],
    ME: [['Duct flexible too long', 'المجرى المرن أطول من اللازم'], ['FCU drain pan dirty', 'حوض تصريف وحدة التكييف متسخ']],
    CV: [['Honeycomb at column base', 'تعشيش عند قاعدة العمود']]
  };
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const FLOORS = [{
    id: 'rf',
    en: 'Roof',
    ar: 'السطح',
    lv: 'RF',
    n: [6, 5, 0, 1, 0]
  }, {
    id: '03',
    en: 'Floor 03',
    ar: 'الطابق ٠٣',
    lv: 'L03',
    n: [12, 10, 1, 2, 0]
  }, {
    id: '02',
    en: 'Floor 02',
    ar: 'الطابق ٠٢',
    lv: 'L02',
    n: [27, 24, 1, 3, 1]
  }, {
    id: '01',
    en: 'Floor 01',
    ar: 'الطابق ٠١',
    lv: 'L01',
    n: [9, 6, 2, 1, 0]
  }, {
    id: 'gf',
    en: 'Ground Floor',
    ar: 'الطابق الأرضي',
    lv: 'GF',
    n: [4, 4, 0, 0, 0]
  }];
  // n = [snags, openSnags, inspections, comments, failedInspections]
  const PINS = {};
  const seq = {};
  FLOORS.forEach(f => {
    seed = f.id.charCodeAt(0) * 31 + f.id.charCodeAt(1);
    const L = [];
    const [sn, op, ins, com, fl] = f.n;
    const trs = ['EL', 'EL', 'AR', 'AR', 'PL', 'FS', 'ME', 'EL', 'AR', 'PL', 'CV'];
    const mk = (type, st, i) => {
      const tr = type === 'insp' ? 'EL' : type === 'com' ? ['AR', 'PL', 'EL'][i % 3] : trs[Math.floor(rnd() * trs.length)];
      const co = TRCO[tr];
      const room = ROOMS[Math.floor(rnd() * ROOMS.length)];
      const [x, y, w, h] = room.r;
      const key = CO[co][3] + '-' + tr + '-' + TYPE[type].code;
      seq[key] = (seq[key] || 0) + 1;
      const pool = TITLES[tr];
      const t = type === 'com' ? [['Clarify ceiling height at bulkhead', 'توضيح ارتفاع السقف عند الحاجز'], ['Confirm socket heights with ID', 'تأكيد ارتفاع المقابس مع التصميم الداخلي'], ['Riser door swing clashes with duct', 'فتحة باب الرايزر تتعارض مع المجرى']][i % 3] : type === 'insp' ? [['First-fix electrical — Apt 201–205', 'التمديدات الكهربائية الأولى — الشقق 201–205']][0] : pool[Math.floor(rnd() * pool.length)];
      return {
        id: f.id + '-' + L.length,
        fl: f.id,
        no: 'TWR-' + key + '-' + String(seq[key] + (tr === 'EL' && type === 'snag' ? 10 : 0)).padStart(3, '0'),
        type,
        st,
        tr,
        co,
        room: room.id,
        x: Math.round(x + 18 + rnd() * (w - 36)),
        y: Math.round(y + 18 + rnd() * (h - 36)),
        t,
        age: Math.floor(rnd() * 14) + 1,
        photos: rnd() > .35 ? 1 + Math.floor(rnd() * 3) : 0,
        mine: rnd() > .72,
        rev: rnd() > .25 ? 'C' : 'B',
        d: Math.floor(rnd() * 40)
      };
    };
    for (let i = 0; i < sn; i++) L.push(mk('snag', i < op ? 'open' : i % 2 ? 'closed' : 'review', i));
    for (let i = 0; i < ins; i++) L.push(mk('insp', i < fl ? 'failed' : 'review', i));
    for (let i = 0; i < com; i++) L.push(mk('com', i === 2 ? 'closed' : 'open', i));
    PINS[f.id] = L;
  });
  // hero pin + two items 3+ weeks old on Floor 02
  const P2 = PINS['02'];
  Object.assign(P2[0], {
    no: 'TWR-TMC-EL-SNG-014',
    t: ['Cable tray not bonded', 'حامل الكابلات غير موصول بالتأريض'],
    tr: 'EL',
    co: 'tmc',
    st: 'open',
    age: 14,
    photos: 1,
    x: 712,
    y: 520,
    room: 'r1',
    rev: 'C',
    mine: true
  });
  P2[5].age = 24;
  P2[11].age = 23;
  // cluster-friendly: stack a few pins close together in Riser 01 / corridor
  [3, 7, 9].forEach((k, i) => {
    P2[k].x = 700 + i * 14;
    P2[k].y = 545 + i * 10;
    P2[k].room = 'r1';
  });
  const SHEETS = {
    '02': [{
      id: 'C',
      no: 'A-102',
      en: 'Floor 02 Plan',
      ar: 'مخطط الطابق ٠٢',
      rev: 'C',
      cur: 1,
      date: '14 Sep 2026'
    }, {
      id: 'B',
      no: 'A-102',
      en: 'Floor 02 Plan',
      ar: 'مخطط الطابق ٠٢',
      rev: 'B',
      date: '02 Jul 2026'
    }, {
      id: 'A',
      no: 'A-102',
      en: 'Floor 02 Plan',
      ar: 'مخطط الطابق ٠٢',
      rev: 'A',
      date: '11 Mar 2026'
    }]
  };
  // schematic drawing (sample sheet)
  function drawing(sheet) {
    const g = [];
    const rect = (x, y, w, h, cls) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls || 'wl'}"></rect>`;
    for (let i = 0; i < 7; i++) {
      const x = 70 + i * (1060 / 6);
      g.push(`<line x1="${x}" y1="22" x2="${x}" y2="${H - 22}" class="gd"></line><circle cx="${x}" cy="22" r="13" class="gb"></circle><text x="${x}" y="26.5" class="gt">${'ABCDEFG'[i]}</text>`);
    }
    for (let j = 0; j < 5; j++) {
      const y = 70 + j * 165;
      g.push(`<line x1="22" y1="${y}" x2="${W - 22}" y2="${y}" class="gd"></line><circle cx="22" cy="${y}" r="13" class="gb"></circle><text x="22" y="${y + 4.5}" class="gt">${j + 1}</text>`);
    }
    g.push(rect(60, 60, 1080, 680, 'ow'));
    ROOMS.forEach(r => {
      const [x, y, w, h] = r.r;
      g.push(rect(x, y, w, h));
      g.push(`<text x="${x + w / 2}" y="${y + h / 2}" class="rl">${r.en.toUpperCase()}</text><text x="${x + w / 2}" y="${y + h / 2 + 16}" class="ra">${r.id === 'cor' ? '1060 × 120' : w * 10 + ' × ' + h * 10}</text>`);
    });
    // doors, fixtures, core details
    [[240, 320], [590, 320], [965, 320], [240, 480], [965, 480]].forEach(([x, y]) => g.push(`<path d="M${x - 22} ${y} a44 44 0 0 1 44 0" class="dr"></path>`));
    [[90, 90], [440, 90], [820, 90], [90, 500], [820, 500]].forEach(([x, y]) => g.push(rect(x, y, 70, 50, 'fx'), rect(x + 80, y, 40, 50, 'fx')));
    g.push(rect(450, 490, 100, 110, 'fx'), rect(560, 490, 100, 110, 'fx'), `<line x1="450" y1="490" x2="550" y2="600" class="fx"></line><line x1="550" y1="490" x2="450" y2="600" class="fx"></line><line x1="560" y1="490" x2="660" y2="600" class="fx"></line><line x1="660" y1="490" x2="560" y2="600" class="fx"></line>`);
    for (let i = 0; i < 9; i++) g.push(`<line x1="${450 + i * 23}" y1="615" x2="${450 + i * 23}" y2="720" class="fx"></line>`);
    [[70, 70], [400, 70], [750, 70], [1130, 70], [70, 730], [400, 730], [800, 730], [1130, 730]].forEach(([x, y]) => g.push(rect(x - 9, y - 9, 18, 18, 'col')));
    g.push(`<g class="tb"><rect x="${W - 300}" y="${H - 58}" width="280" height="44"></rect><text x="${W - 290}" y="${H - 41}">${sheet.no} · ${sheet.en.toUpperCase()}</text><text x="${W - 290}" y="${H - 24}">REV ${sheet.rev} · ${sheet.date.toUpperCase()} · 1:100</text></g>`);
    if (sheet.rev !== 'C') g.push(`<rect x="800" y="480" width="330" height="250" class="cloud"></rect>`);
    return `<svg class="dwg" viewBox="0 0 ${W} ${H}">${g.join('')}</svg>`;
  }
  window.PD = {
    W,
    H,
    TYPE,
    STAT,
    STAGE,
    TR,
    CO,
    ROLES,
    ROOMS,
    FLOORS,
    PINS,
    SHEETS,
    drawing
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/plan/data.js", error: String((e && e.message) || e) }); }

// ui_kits/app/plan/mobile.js
try { (() => {
// Plan View — mobile (one-handed). Uses PD + PC.
(function () {
  const {
    W,
    H,
    TYPE,
    STAT,
    STAGE,
    TR,
    CO,
    ROOMS,
    FLOORS,
    PINS,
    drawing
  } = PD;
  const {
    shape,
    shapeFlat,
    sheetsFor,
    onSheet,
    canSee,
    filt,
    ageDots,
    stc,
    trc,
    coAv,
    roomAt,
    RANK,
    cluster,
    badges
  } = PC;
  const S = RS.S;
  try {
    Object.assign(S, JSON.parse(localStorage.getItem('rb-shell-v1') || '{}'));
  } catch (e) {}
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  const M = {
    fl: '02',
    k: 1,
    tx: 0,
    ty: 0,
    auto: true,
    sh: 'peek',
    mode: 'list',
    sel: null,
    F: {
      type: new Set(),
      tr: new Set(),
      st: new Set(),
      mine: false,
      dr: 'all'
    },
    adding: false,
    draft: null,
    cam: false,
    shot: null,
    form: null,
    toast: null
  };
  const sheet = () => sheetsFor(M.fl).find(s => s.cur);
  const vis = () => PINS[M.fl].filter(p => canSee(p, 'admin') && onSheet(p, M.fl, sheet().id) && filt(p, M.F));
  const fname = f => L(f.en, f.ar);
  const SH = {
    peek: 150,
    half: 420,
    full: 660
  };
  const nF = () => M.F.type.size + M.F.tr.size + M.F.st.size + (M.F.mine ? 1 : 0) + (M.F.dr !== 'all' ? 1 : 0);
  function pinsHtml() {
    return cluster(vis(), M.k, 30).map(c => {
      if (c.p.length === 1) {
        const p = c.p[0];
        return `<div class="pin${M.sel === p.id ? ' sel' : ''}${p.fresh ? ' new' : ''}" data-pin="${p.id}" style="left:${p.x}px;top:${p.y}px"><span class="g">${shape(p.type, STAT[p.st].c, 28)}${p.age >= 21 && p.st !== 'closed' ? '<span class="old"></span>' : ''}</span></div>`;
      }
      const w = c.p.slice().sort((a, b) => RANK[a.st] - RANK[b.st])[0];
      return `<div class="clu" data-clu="${c.sx / M.k},${c.sy / M.k}" style="left:${c.sx / M.k}px;top:${c.sy / M.k}px;--c:${STAT[w.st].c}"><span>${c.p.length}</span></div>`;
    }).join('') + (M.draft ? `<div class="pin draft new" style="left:${M.draft.x}px;top:${M.draft.y}px"><span class="g">${shape(M.draft.type || 'snag', 'var(--btn-pri)', 28)}</span></div>` : '');
  }
  function chips() {
    const T = [['all', L('All', 'الكل')], ...Object.keys(TYPE).map(k => [k, L(TYPE[k].en.split(' ')[0] + (k === 'com' ? 's' : k === 'snag' ? 's' : 's'), {
      snag: 'ملاحظات',
      insp: 'فحوصات',
      com: 'تعليقات'
    }[k])])];
    return `<div class="m-chips">${T.map(t => `<button class="m-chip${(t[0] === 'all' ? !M.F.type.size : M.F.type.has(t[0]) && M.F.type.size === 1) ? ' on' : ''}" data-ty="${t[0]}">${t[0] !== 'all' ? shapeFlat(t[0], 'currentColor', 13) : ''}${t[1]}</button>`).join('')}<button class="m-chip${M.F.mine ? ' on' : ''}" data-act="mine"><i class="ti ti-user-circle"></i>${L('Assigned to me', 'مسند إليّ')}</button></div>`;
  }
  function listBody() {
    const ps = vis().sort((a, b) => RANK[a.st] - RANK[b.st] || b.age - a.age);
    return `<div class="m-list">${ps.map(p => `<div class="m-row" data-row="${p.id}">${shape(p.type, STAT[p.st].c, 22)}<div class="tx"><b>${esc(L(p.t[0], p.t[1]))}</b><small><code>${p.no}</code>· ${L(ROOMS.find(r => r.id === p.room).en, ROOMS.find(r => r.id === p.room).ar)}</small></div>${stc(p.st)}<i class="ti ti-chevron-right"></i></div>`).join('') || `<div class="none" style="padding:30px;text-align:center;color:var(--ui-muted)">${L('No pins match.', 'لا توجد دبابيس مطابقة.')}</div>`}</div>`;
  }
  function sheetHtml() {
    const ps = vis(),
      open = ps.filter(p => p.st === 'open' || p.st === 'failed').length;
    if (M.mode === 'pin') {
      const p = PINS[M.fl].find(x => x.id === M.sel);
      const room = ROOMS.find(r => r.id === p.room);
      return `<div class="m-sh-hd">${shape(p.type, STAT[p.st].c, 24)}<div style="min-width:0"><small><code style="font:700 12px var(--font-ui)">${p.no}</code></small><b style="display:block;line-height:1.3">${esc(L(p.t[0], p.t[1]))}</b></div><button class="m-btn r" data-act="back" style="background:var(--ui-surface-2)"><i class="ti ti-x"></i></button></div>
  <div class="m-body"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${stc(p.st)}<span style="font-size:13px;color:var(--ui-muted)">${L(STAGE[p.st][0], STAGE[p.st][1])}</span></div>
  <div class="m-kv"><span>${L('Trade', 'التخصص')}</span><b>${trc(p.tr)}</b><span>${L('Assigned to', 'مسند إلى')}</span><b>${coAv(p.co)}${L(CO[p.co][0], CO[p.co][1])}</b><span>${L('Location', 'الموقع')}</span><b>${fname(FLOORS.find(f => f.id === M.fl))} · ${L(room.en, room.ar)}</b><span>${L('Age', 'العمر')}</span><b>${ageDots(p)}</b></div>
  <div class="m-thumb">${p.img ? `<img src="${p.img}" alt="">` : p.photos ? `<i class="ti ti-photo"></i>${p.photos} ${L(p.photos > 1 ? 'photos' : 'photo', 'صور')}` : `<i class="ti ti-photo-off"></i>${L('No photos', 'لا توجد صور')}`}</div>
  <div class="m-row2"><button class="m-big sec" data-act="back">${L('Close', 'إغلاق')}</button><button class="m-big pri" data-act="open"><i class="ti ti-external-link"></i>${L('Open', 'فتح')}</button></div></div>`;
    }
    if (M.mode === 'floors') return `<div class="m-sh-hd"><b>${L('Floors · Tower 1', 'الطوابق · البرج ١')}</b><button class="m-btn r" data-act="back" style="background:var(--ui-surface-2)"><i class="ti ti-x"></i></button></div><div class="m-list">${FLOORS.map(f => {
      const b = badges(f.id, 'admin');
      return `<div class="m-row" data-fl="${f.id}" style="${f.id === M.fl ? 'background:var(--tone-tomato-tint)' : ''}"><span style="width:44px;height:44px;border-radius:12px;background:var(--ui-press);display:flex;align-items:center;justify-content:center;font:800 12px var(--font-ui)">${f.lv}</span><div class="tx"><b>${fname(f)}</b><small>${b.os ? `<span style="color:var(--tone-orange-fg);font-weight:700">${b.os} ${L('open snags', 'ملاحظة مفتوحة')}</span>` : ''}${b.fail ? `<span style="color:var(--tone-red-fg);font-weight:700">${b.fail} ${L('failed', 'راسب')}</span>` : ''}${b.com ? `<span>${b.com} ${L('comments', 'تعليقات')}</span>` : ''}</small></div>${f.id === M.fl ? '<i class="ti ti-check" style="color:var(--btn-pri)"></i>' : '<i class="ti ti-chevron-right"></i>'}</div>`;
    }).join('')}</div>`;
    if (M.mode === 'filters') {
      const grp = (key, title, opts) => `<div class="m-fld"><label>${title}</label><div class="m-tr">${opts.map(o => `<button class="${M.F[key].has(o[0]) ? 'on' : ''}" data-fk="${key}:${o[0]}">${o[2] || ''}${o[1]}</button>`).join('')}</div></div>`;
      return `<div class="m-sh-hd"><b>${L('Filters', 'التصفية')}</b>${nF() ? `<button class="m-chip" data-act="clearf" style="height:32px">${L('Reset', 'إعادة ضبط')}</button>` : ''}<button class="m-btn r" data-act="back" style="background:var(--ui-surface-2)"><i class="ti ti-x"></i></button></div><div class="m-body">
  ${grp('type', L('Work Item Type', 'نوع العنصر'), Object.keys(TYPE).map(k => [k, L(TYPE[k].en, TYPE[k].ar), shapeFlat(k, 'currentColor', 13)]))}${grp('tr', L('Trade', 'التخصص'), Object.keys(TR).map(k => [k, L(TR[k][0], TR[k][1]), `<i style="background:var(--tone-${TR[k][2]}-solid)"></i>`]))}${grp('st', L('Stage', 'المرحلة'), ['open', 'review', 'failed', 'closed'].map(k => [k, L(STAT[k].en, STAT[k].ar), `<i style="border-radius:50%;background:${STAT[k].c}"></i>`]))}
  <div class="m-fld"><label>${L('Date', 'التاريخ')}</label><div class="m-tr">${[['all', L('Any', 'أي')], ['7', L('7 days', '7 أيام')], ['30', L('30 days', '30 يومًا')]].map(o => `<button class="${M.F.dr === o[0] ? 'on' : ''}" data-dr="${o[0]}">${o[1]}</button>`).join('')}</div></div>
  <label style="display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;min-height:48px" data-act="mine"><span class="swc${M.F.mine ? ' on' : ''}" style="width:44px;height:26px;border-radius:13px"></span>${L('Assigned to me', 'مسند إليّ')}</label>
  <button class="m-big pri" data-act="back">${L(`Show ${vis().length} items`, `عرض ${vis().length} عنصر`)}</button></div>`;
    }
    if (M.mode === 'type') return `<div class="m-sh-hd"><b>${L('What are you adding?', 'ماذا تضيف؟')}</b><button class="m-btn r" data-act="cancel" style="background:var(--ui-surface-2)"><i class="ti ti-x"></i></button></div><div class="m-body"><div class="m-types">${Object.keys(TYPE).map(k => `<button class="m-type" data-ptype="${k}">${shape(k, k === 'snag' ? STAT.open.c : k === 'insp' ? STAT.review.c : STAT.draft.c, 26)}${L(TYPE[k].en, TYPE[k].ar)}<small>${TYPE[k].code}</small></button>`).join('')}</div></div>`;
    if (M.mode === 'form') {
      const f = M.form,
        room = roomAt(M.draft.x, M.draft.y);
      return `<div class="m-sh-hd">${shape(M.draft.type, STAT.open.c, 22)}<b>${L('New ', 'جديد: ')}${L(TYPE[M.draft.type].en, TYPE[M.draft.type].ar)}</b><button class="m-btn r" data-act="cancel" style="background:var(--ui-surface-2)"><i class="ti ti-x"></i></button></div><div class="m-body">
  <div class="locs"><span class="lc"><i class="ti ti-stairs"></i>${fname(FLOORS.find(x => x.id === M.fl))}</span>${room ? `<span class="lc"><i class="ti ti-map-pin"></i>${L(room.en, room.ar)}</span>` : ''}<span class="lc"><i class="ti ti-file-text"></i>${sheet().no} Rev ${sheet().rev}</span></div>
  <div class="m-photos">${f.photos.map(s => `<img src="${s}" alt="">`).join('')}<button data-act="cam"><i class="ti ti-camera"></i>${L('Photo', 'صورة')}</button></div>
  <div class="m-fld"><label>${L('Title', 'العنوان')} *</label><input id="mtitle" class="${f.err ? 'err' : ''}" value="${esc(f.title)}" placeholder="${L('What’s wrong?', 'ما المشكلة؟')}"></div>
  <div class="m-fld"><label>${L('Trade', 'التخصص')}</label><div class="m-tr">${Object.keys(TR).map(k => `<button class="${f.tr === k ? 'on' : ''}" data-ftr="${k}"><i style="background:var(--tone-${TR[k][2]}-solid)"></i>${L(TR[k][0], TR[k][1])}</button>`).join('')}</div></div>
  <div class="m-fld"><label>${L('Note', 'ملاحظة')}</label><textarea id="mdesc" placeholder="${L('Optional', 'اختياري')}">${esc(f.desc)}</textarea></div>
  <button class="m-big pri" data-act="save"><i class="ti ti-check"></i>${L('Save ', 'حفظ ')}${L(TYPE[M.draft.type].en.split(' ')[0].toLowerCase(), TYPE[M.draft.type].ar)}</button></div>`;
    }
    return `<div class="m-sh-hd"><div><b>${ps.length} ${L('items', 'عنصر')}</b> <small>· ${open} ${L('open', 'مفتوح')}</small></div><button class="m-chip r" data-act="toggle" style="height:32px"><i class="ti ti-chevron-${M.sh === 'peek' ? 'up' : 'down'}"></i>${M.sh === 'peek' ? L('List', 'القائمة') : L('Map', 'المخطط')}</button></div>${chips()}${M.sh !== 'peek' ? listBody() : ''}`;
  }
  function screen() {
    const f = FLOORS.find(x => x.id === M.fl),
      sh = sheet();
    const h = M.adding ? 0 : SH[M.sh];
    return `<div class="notch"></div><div class="sbar"><span>9:41</span><span class="ic"><i class="ti ti-antenna-bars-5"></i><i class="ti ti-wifi"></i><i class="ti ti-battery-3"></i></span></div>
 <div class="m-stage" id="mstage" dir="ltr"><div class="pv-world" id="mworld">${drawing(sh)}<div class="pins" id="mpins">${pinsHtml()}</div></div></div>
 <div class="m-top"><button class="m-btn bk glass"><i class="ti ti-arrow-left"></i></button><button class="m-fl glass" data-act="floors"><b>${fname(f)}<i class="ti ti-chevron-down" style="font-size:14px"></i></b><small>${sh.no} · Rev ${sh.rev}</small></button><button class="m-btn glass" data-act="filters"><i class="ti ti-adjustments-horizontal"></i>${nF() ? `<span class="n">${nF()}</span>` : ''}</button></div>
 <div class="m-zoom glass" dir="ltr"><button data-zoom="in"><i class="ti ti-plus"></i></button><button data-zoom="out"><i class="ti ti-minus"></i></button><button data-zoom="fit"><i class="ti ti-maximize"></i></button></div>
 ${M.adding ? `<div class="m-hint">${L('Move the plan under the pin', 'حرّك المخطط تحت الدبوس')}</div><div class="m-ret"><svg viewBox="0 0 40 52"><path d="M20 51C20 51 38 31 38 19A18 18 0 1 0 2 19C2 31 20 51 20 51Z" fill="var(--btn-pri)" stroke="#fff" stroke-width="3"></path><circle cx="20" cy="19" r="6" fill="#fff"></circle></svg></div><div class="m-drop"><button class="m-big sec" data-act="cancel">${L('Cancel', 'إلغاء')}</button><button class="m-big pri" data-act="drop"><i class="ti ti-map-pin"></i>${L('Drop pin here', 'ضع الدبوس هنا')}</button></div>` : `${M.mode === 'list' && M.sh === 'peek' || M.mode === 'pin' ? '' : '<!--'}<button class="m-fab" data-act="add" style="bottom:${h + 18}px" aria-label="${L('Add pin', 'إضافة دبوس')}"><i class="ti ti-plus"></i></button>${M.mode === 'list' && M.sh === 'peek' || M.mode === 'pin' ? '' : '-->'}
 <div class="m-sheet" style="height:${h}px"><div class="m-grab" data-act="toggle"><i></i></div>${sheetHtml()}</div>`}
 ${M.cam ? `<div class="m-cam"><div class="vf">${M.shot ? `<img src="${M.shot}" alt="">` : `<div class="grid"></div><div class="lbl"><i class="ti ti-camera"></i>${L('Camera ready', 'الكاميرا جاهزة')}</div>`}<div class="top"><button data-act="camx"><i class="ti ti-x"></i></button><span>${L(TYPE[M.draft.type].en, TYPE[M.draft.type].ar)} · ${fname(f)}</span><button><i class="ti ti-bolt"></i></button></div></div>
  <div class="bar"><button data-act="lib"><span class="lib"><i class="ti ti-photo"></i></span>${L('Library', 'المعرض')}</button><button data-act="shoot" aria-label="${L('Take photo', 'التقاط صورة')}"><span class="shut"></span></button><button data-act="skip"><span class="lib"><i class="ti ti-arrow-right"></i></span>${M.shot ? L('Use photo', 'استخدام') : L('Skip', 'تخطي')}</button></div></div>` : ''}
 ${M.toast ? `<div class="m-toast"><i class="ti ti-circle-check"></i>${M.toast}</div>` : ''}<div class="m-home"></div>`;
  }
  function applyT() {
    const w = document.getElementById('mworld');
    if (!w) return;
    w.style.transform = `translate(${M.tx}px,${M.ty}px) scale(${M.k})`;
    w.style.setProperty('--inv', 1 / M.k);
    const p = document.getElementById('mpins');
    if (p) p.innerHTML = pinsHtml();
  }
  function fit() {
    const s = document.getElementById('mstage').getBoundingClientRect();
    M.k = s.width / W * 1.02;
    M.tx = (s.width - W * M.k) / 2;
    M.ty = 150;
    M.auto = true;
    applyT();
  }
  function zoomAt(f, cx, cy) {
    const k2 = Math.max(.2, Math.min(4, M.k * f));
    M.tx = cx - (cx - M.tx) * (k2 / M.k);
    M.ty = cy - (cy - M.ty) * (k2 / M.k);
    M.k = k2;
    M.auto = false;
    applyT();
  }
  function center(x, y, k) {
    const s = document.getElementById('mstage').getBoundingClientRect();
    if (k) M.k = k;
    M.tx = s.width / 2 - x * M.k;
    M.ty = s.height * .3 - y * M.k;
    M.auto = false;
    applyT();
  }
  function render() {
    const el = document.getElementById('scr');
    const l = el.querySelector('.m-list,.m-body');
    const y = l ? l.scrollTop : 0;
    el.innerHTML = screen();
    const n = el.querySelector('.m-list,.m-body');
    if (n) n.scrollTop = y;
    if (M.auto) fit();else applyT();
  }
  function all() {
    document.documentElement.lang = S.lang;
    document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    document.body.classList.toggle('theme-dark', S.mode === 'dark');
    document.getElementById('scr').className = 'scr' + (S.mode === 'dark' ? ' theme-dark' : '');
    document.getElementById('demo').innerHTML = `<span class="segv">${[['peek', L('Sheet collapsed', 'القائمة مطوية')], ['full', L('Sheet expanded', 'القائمة موسعة')], ['pin', L('Pin open', 'دبوس مفتوح')], ['add', L('Add pin + photo', 'إضافة دبوس + صورة')]].map(s => `<button data-demo="${s[0]}">${s[1]}</button>`).join('')}</span><span class="segv"><button class="${S.lang === 'en' ? 'on' : ''}" data-lang="en">EN</button><button class="${S.lang === 'ar' ? 'on' : ''}" data-lang="ar">عربي</button></span><a class="cb" href="plan-view.html" style="text-decoration:none"><i class="ti ti-device-desktop"></i>${L('Desktop', 'سطح المكتب')}</a>`;
    render();
  }
  let tt;
  const flash = m => {
    M.toast = m;
    render();
    clearTimeout(tt);
    tt = setTimeout(() => {
      M.toast = null;
      render();
    }, 2200);
  };
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.setAttribute('capture', 'environment');
  file.style.display = 'none';
  document.body.appendChild(file);
  file.addEventListener('change', () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      M.shot = rd.result;
      render();
    };
    rd.readAsDataURL(f);
  });
  const saveForm = () => {
    if (!M.form) return;
    const t = document.getElementById('mtitle'),
      d = document.getElementById('mdesc');
    if (t) M.form.title = t.value;
    if (d) M.form.desc = d.value;
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act],[data-ty],[data-fk],[data-dr],[data-ptype],[data-ftr],[data-row],[data-fl],[data-zoom],[data-demo],[data-lang]');
    if (!b) return;
    const d = b.dataset;
    saveForm();
    if (d.lang) {
      S.lang = d.lang;
      try {
        const o = JSON.parse(localStorage.getItem('rb-shell-v1') || '{}');
        o.lang = d.lang;
        localStorage.setItem('rb-shell-v1', JSON.stringify(o));
      } catch (x) {}
      return all();
    }
    if (d.demo) {
      M.cam = false;
      M.adding = false;
      M.draft = null;
      M.shot = null;
      if (d.demo === 'peek') {
        M.mode = 'list';
        M.sh = 'peek';
        M.sel = null;
      }
      if (d.demo === 'full') {
        M.mode = 'list';
        M.sh = 'full';
        M.sel = null;
      }
      if (d.demo === 'pin') {
        M.mode = 'pin';
        M.sh = 'half';
        M.sel = PINS['02'][0].id;
        M.fl = '02';
        render();
        return center(712, 520, .75);
      }
      if (d.demo === 'add') {
        M.adding = true;
        M.sel = null;
      }
      return render();
    }
    if (d.zoom) {
      const s = document.getElementById('mstage').getBoundingClientRect();
      if (d.zoom === 'fit') return fit();
      return zoomAt(d.zoom === 'in' ? 1.4 : 1 / 1.4, s.width / 2, s.height * .4);
    }
    if (d.ty) {
      if (d.ty === 'all') M.F.type = new Set();else M.F.type = new Set([d.ty]);
      return render();
    }
    if (d.fk) {
      const [k, v] = d.fk.split(':');
      M.F[k].has(v) ? M.F[k].delete(v) : M.F[k].add(v);
      return render();
    }
    if (d.dr) {
      M.F.dr = d.dr;
      return render();
    }
    if (d.row) {
      const p = PINS[M.fl].find(x => x.id === d.row);
      M.sel = p.id;
      M.mode = 'pin';
      M.sh = 'half';
      render();
      return center(p.x, p.y, Math.max(M.k, .75));
    }
    if (d.fl) {
      M.fl = d.fl;
      M.mode = 'list';
      M.sh = 'peek';
      M.sel = null;
      M.auto = true;
      return render();
    }
    if (d.ptype) {
      M.draft.type = d.ptype;
      M.cam = true;
      M.shot = null;
      M.form = {
        title: '',
        tr: 'EL',
        desc: '',
        photos: [],
        err: false
      };
      return render();
    }
    if (d.ftr) {
      M.form.tr = d.ftr;
      return render();
    }
    const a = d.act;
    if (a === 'toggle') {
      if (M.mode !== 'list') {
        M.mode = 'list';
        M.sel = null;
      }
      M.sh = M.sh === 'peek' ? 'full' : 'peek';
      return render();
    }
    if (a === 'back') {
      M.mode = 'list';
      M.sh = 'peek';
      M.sel = null;
      return render();
    }
    if (a === 'floors') {
      M.mode = 'floors';
      M.sh = 'half';
      return render();
    }
    if (a === 'filters') {
      M.mode = 'filters';
      M.sh = 'full';
      return render();
    }
    if (a === 'mine') {
      M.F.mine = !M.F.mine;
      return render();
    }
    if (a === 'clearf') {
      M.F = {
        type: new Set(),
        tr: new Set(),
        st: new Set(),
        mine: false,
        dr: 'all'
      };
      return render();
    }
    if (a === 'open') {
      const p = PINS[M.fl].find(x => x.id === M.sel);
      return flash(L(`Opening ${p.no}…`, `جارٍ فتح ${p.no}…`));
    }
    if (a === 'add') {
      M.adding = true;
      M.sel = null;
      M.mode = 'list';
      return render();
    }
    if (a === 'cancel') {
      M.adding = false;
      M.draft = null;
      M.cam = false;
      M.form = null;
      M.mode = 'list';
      M.sh = 'peek';
      return render();
    }
    if (a === 'drop') {
      const s = document.getElementById('mstage').getBoundingClientRect();
      const x = Math.round((s.width / 2 - M.tx) / M.k),
        y = Math.round((s.height * .44 - M.ty) / M.k);
      M.draft = {
        x: Math.max(0, Math.min(W, x)),
        y: Math.max(0, Math.min(H, y)),
        type: 'snag'
      };
      M.adding = false;
      M.mode = 'type';
      M.sh = 'half';
      return render();
    }
    if (a === 'shoot' || a === 'lib') {
      file.toggleAttribute('capture', a === 'shoot');
      return file.click();
    }
    if (a === 'camx') {
      M.cam = false;
      if (!M.form.photos.length && M.mode !== 'form') {
        M.mode = 'type';
      }
      return render();
    }
    if (a === 'skip') {
      if (M.shot) M.form.photos.push(M.shot);
      M.shot = null;
      M.cam = false;
      M.mode = 'form';
      M.sh = 'full';
      return render();
    }
    if (a === 'cam') {
      M.cam = true;
      M.shot = null;
      return render();
    }
    if (a === 'save') {
      if (!M.form.title.trim()) {
        M.form.err = true;
        render();
        document.getElementById('mtitle').focus();
        return;
      }
      const co = 'tmc',
        type = M.draft.type,
        key = CO[co][3] + '-' + M.form.tr + '-' + TYPE[type].code;
      const n = PINS[M.fl].filter(p => p.no.startsWith('TWR-' + key)).length + 15;
      const p = {
        id: M.fl + '-m' + Date.now(),
        fl: M.fl,
        no: 'TWR-' + key + '-' + String(n).padStart(3, '0'),
        type,
        st: 'open',
        tr: M.form.tr,
        co,
        room: (roomAt(M.draft.x, M.draft.y) || ROOMS[5]).id,
        x: M.draft.x,
        y: M.draft.y,
        t: [M.form.title, M.form.title],
        age: 0,
        photos: M.form.photos.length,
        img: M.form.photos[0],
        mine: true,
        rev: sheet().id,
        d: 0,
        fresh: 1
      };
      PINS[M.fl].push(p);
      M.draft = null;
      M.form = null;
      M.sel = p.id;
      M.mode = 'pin';
      M.sh = 'half';
      return flash(L(`${p.no} saved`, `تم حفظ ${p.no}`));
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'mtitle' && M.form) {
      M.form.title = e.target.value;
      if (M.form.err && e.target.value) {
        M.form.err = false;
        e.target.classList.remove('err');
      }
    }
  });
  // pan + pinch + tap
  const pts = new Map();
  let P = null,
    pinch = null;
  document.addEventListener('pointerdown', e => {
    const st = e.target.closest('#mstage');
    if (!st) return;
    pts.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY
    });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        k: M.k
      };
      P = null;
      return;
    }
    P = {
      x: e.clientX,
      y: e.clientY,
      tx: M.tx,
      ty: M.ty,
      moved: false,
      t: e.target
    };
  });
  addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY
    });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const r = document.getElementById('mstage').getBoundingClientRect();
      const f = Math.hypot(a.x - b.x, a.y - b.y) / pinch.d * pinch.k / M.k;
      zoomAt(f, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    if (!P) return;
    const dx = e.clientX - P.x,
      dy = e.clientY - P.y;
    if (!P.moved && Math.hypot(dx, dy) > 5) P.moved = true;
    if (P.moved) {
      M.tx = P.tx + dx;
      M.ty = P.ty + dy;
      M.auto = false;
      applyT();
    }
  });
  addEventListener('pointerup', e => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!P) return;
    const p = P;
    P = null;
    if (p.moved || M.adding) return;
    const c = p.t.closest && p.t.closest('[data-clu]');
    if (c) {
      const [x, y] = c.dataset.clu.split(',').map(Number);
      return zoomAt(2, M.tx + x * M.k, M.ty + y * M.k);
    }
    const pin = p.t.closest && p.t.closest('[data-pin]');
    if (pin && !pin.classList.contains('draft')) {
      M.sel = pin.dataset.pin;
      M.mode = 'pin';
      M.sh = 'half';
      return render();
    }
    if (M.mode === 'pin') {
      M.mode = 'list';
      M.sh = 'peek';
      M.sel = null;
      render();
    }
  });
  document.addEventListener('wheel', e => {
    const st = e.target.closest('#mstage');
    if (!st) return;
    e.preventDefault();
    const r = st.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  }, {
    passive: false
  });
  window.MP = {
    M,
    all
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/plan/mobile.js", error: String((e && e.message) || e) }); }

// ui_kits/app/plan/plan.js
try { (() => {
// Plan View core (PC) + desktop view (PV).
(function () {
  const S = RS.S,
    {
      W,
      H,
      TYPE,
      STAT,
      STAGE,
      TR,
      CO,
      ROLES,
      ROOMS,
      FLOORS,
      PINS,
      SHEETS,
      drawing
    } = PD;
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  /* ---------- core ---------- */
  function shape(type, c, sz) {
    sz = sz || 24;
    const s = `fill:${c}`;
    const m = type === 'snag' ? `<circle class="s" cx="12" cy="12" r="9" style="${s}"></circle>` : type === 'insp' ? `<rect class="s" x="5" y="5" width="14" height="14" rx="2" transform="rotate(45 12 12)" style="${s}"></rect>` : `<rect class="s" x="3.5" y="3.5" width="17" height="17" rx="3" style="${s}"></rect>`;
    return `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" style="overflow:visible">${m}</svg>`;
  }
  const shapeFlat = (type, c, sz) => shape(type, c, sz).replace(/class="s"/, 'stroke="#fff" stroke-width="2"');
  const sheetsFor = fl => SHEETS[fl] || [{
    id: 'A',
    no: 'A-10' + FLOORS.findIndex(f => f.id === fl),
    en: FLOORS.find(f => f.id === fl).en + ' Plan',
    ar: 'مخطط ' + FLOORS.find(f => f.id === fl).ar,
    rev: 'A',
    cur: 1,
    date: '20 Aug 2026'
  }];
  const onSheet = (p, fl, sh) => SHEETS[fl] ? p.rev === sh : true;
  const canSee = (p, role) => {
    const r = ROLES[role];
    return !r.co || p.co === r.co;
  };
  function filt(p, F) {
    if (F.type.size && !F.type.has(p.type)) return false;
    if (F.tr.size && !F.tr.has(p.tr)) return false;
    if (F.st.size && !F.st.has(p.st)) return false;
    if (F.mine && !p.mine) return false;
    if (F.dr !== 'all' && p.d > +F.dr) return false;
    return true;
  }
  const weeks = p => Math.min(4, Math.max(1, Math.ceil(p.age / 7)));
  const ageDots = p => `<span class="agd">${[1, 2, 3, 4].map(i => `<i class="${i <= weeks(p) ? 'on' : ''}"></i>`).join('')}<em>${p.age < 7 ? L(p.age + ' days', 'منذ ' + p.age + ' أيام') : L(Math.floor(p.age / 7) + (Math.floor(p.age / 7) === 1 ? ' week' : ' weeks'), Math.floor(p.age / 7) + ' أسابيع')}${p.age >= 21 ? L(' at this step', ' في هذه الخطوة') : ''}</em></span>`;
  const stc = st => `<span class="stc" style="background:${STAT[st].t};color:${STAT[st].f}"><i></i>${L(STAT[st].en, STAT[st].ar)}</span>`;
  const trc = tr => `<span class="chip" style="height:22px;font-size:11.5px;background:var(--tone-${TR[tr][2]}-tint);color:var(--tone-${TR[tr][2]}-fg)">${L(TR[tr][0], TR[tr][1])}</span>`;
  const coAv = co => `<span class="av" style="background:${CO[co][2]}">${RS.ini(CO[co][0])}</span>`;
  const roomAt = (x, y) => ROOMS.filter(r => x >= r.r[0] && x <= r.r[0] + r.r[2] && y >= r.r[1] && y <= r.r[1] + r.r[3]).sort((a, b) => a.r[2] * a.r[3] - b.r[2] * b.r[3])[0];
  const RANK = {
    failed: 0,
    open: 1,
    review: 2,
    draft: 3,
    closed: 4
  };
  function cluster(pins, k, R) {
    const out = [];
    pins.forEach(p => {
      const sx = p.x * k,
        sy = p.y * k;
      const c = out.find(c => Math.hypot(c.sx - sx, c.sy - sy) < R);
      if (c) {
        c.p.push(p);
        c.sx = (c.sx * (c.p.length - 1) + sx) / c.p.length;
        c.sy = (c.sy * (c.p.length - 1) + sy) / c.p.length;
      } else out.push({
        sx,
        sy,
        p: [p]
      });
    });
    return out;
  }
  function badges(fl, role) {
    const ps = PINS[fl].filter(p => canSee(p, role));
    const c = {
      os: ps.filter(p => p.type === 'snag' && p.st === 'open').length,
      sn: ps.filter(p => p.type === 'snag').length,
      ins: ps.filter(p => p.type === 'insp').length,
      com: ps.filter(p => p.type === 'com').length,
      fail: ps.filter(p => p.st === 'failed').length,
      old: ps.filter(p => p.age >= 21 && p.st !== 'closed').length
    };
    return c;
  }
  window.PC = {
    shape,
    shapeFlat,
    sheetsFor,
    onSheet,
    canSee,
    filt,
    weeks,
    ageDots,
    stc,
    trc,
    coAv,
    roomAt,
    RANK,
    cluster,
    badges
  };
  /* ---------- desktop ---------- */
  const qs = new URLSearchParams(location.search);
  const V = {
    fl: FLOORS.some(f => f.id === qs.get('fl')) ? qs.get('fl') : '02',
    sheet: null,
    role: 'admin',
    F: {
      type: new Set(),
      tr: new Set(),
      st: new Set(),
      mine: false,
      dr: 'all'
    },
    list: true,
    sel: null,
    k: 1,
    tx: 0,
    ty: 0,
    auto: true,
    adding: false,
    add: null,
    form: null,
    menu: null,
    toast: null,
    tablet: false
  };
  V.sheet = sheetsFor(V.fl).find(s => s.cur).id;
  const fl = () => FLOORS.find(f => f.id === V.fl);
  const sheet = () => sheetsFor(V.fl).find(s => s.id === V.sheet);
  const vis = () => PINS[V.fl].filter(p => canSee(p, V.role) && onSheet(p, V.fl, V.sheet) && filt(p, V.F));
  const fname = f => L(f.en, f.ar);
  function fsel(key, label, opts) {
    const set = V.F[key];
    const n = set.size;
    return `<span class="rel"><button class="cb fbtn${n ? ' set' : ''}" data-menu="f-${key}">${label}<span class="v">${n ? ': ' + (n === 1 ? opts.find(o => set.has(o[0]))[1] : n) : ''}</span><i class="ti ti-chevron-down"></i></button>${V.menu === 'f-' + key ? `<div class="pop" data-stop style="min-width:230px"><h6>${label}</h6>${opts.map(o => `<button class="mi${set.has(o[0]) ? ' on' : ''}" data-fk="${key}:${o[0]}">${o[2] || ''}${o[1]}${set.has(o[0]) ? '<i class="ti ti-check ck"></i>' : ''}</button>`).join('')}${n ? `<div class="sep"></div><button class="mi" data-fclr="${key}">${L('Clear', 'مسح')}</button>` : ''}</div>` : ''}</span>`;
  }
  function top() {
    const f = fl(),
      i = FLOORS.indexOf(f),
      sh = sheet(),
      segs = [['floor', 'ti-stairs', L('Floor', 'الطوابق')], ['map', 'ti-map', L('Map', 'الخريطة')], ['plan', 'ti-vector', L('Plan', 'المخطط')]];
    const up = FLOORS[i - 1],
      dn = FLOORS[i + 1];
    return `<div class="pv-bar"><span class="segv">${segs.map(s => `<button class="${s[0] === 'plan' ? 'on' : ''}" data-view="${s[0]}"><i class="ti ${s[1]}"></i>${s[2]}</button>`).join('')}</span>
 <nav class="bc"><span>${L('Dubai Marina Tower – Phase 2', 'برج دبي مارينا – المرحلة ٢')}</span><i class="ti ti-chevron-right"></i><span>${L('Tower 1', 'البرج ١')}</span><i class="ti ti-chevron-right"></i></nav>
 <span class="flsw"><button class="cb ter sm ic" ${dn ? `data-fl="${dn.id}" title="${fname(dn)}"` : 'disabled'}><i class="ti ti-chevron-down"></i></button><b>${fname(f)}</b><button class="cb ter sm ic" ${up ? `data-fl="${up.id}" title="${fname(up)}"` : 'disabled'}><i class="ti ti-chevron-up"></i></button></span>
 <span class="rel"><button class="dsel" data-menu="sheet"><i class="ti ti-file-text" style="color:var(--ui-muted)"></i><code>${sh.no}</code>${L(sh.en, sh.ar)} – Rev ${sh.rev}${sh.cur ? `<span class="cur">${L('current', 'الحالي')}</span>` : `<span class="old">${L('superseded', 'مستبدل')}</span>`}<i class="ti ti-chevron-down" style="color:var(--ui-muted)"></i></button>${V.menu === 'sheet' ? `<div class="pop" data-stop style="min-width:320px"><h6>${L('Drawings · ', 'المخططات · ')}${fname(f)}</h6>${sheetsFor(V.fl).map(s => {
      const n = PINS[V.fl].filter(p => canSee(p, V.role) && onSheet(p, V.fl, s.id)).length;
      return `<button class="mi${s.id === V.sheet ? ' on' : ''}" data-sheet="${s.id}"><i class="ti ti-file-text"></i><span><b style="font-weight:600">${s.no} – Rev ${s.rev}</b> ${s.cur ? `<span class="cur" style="font-size:10.5px;font-weight:700;color:var(--tone-green-fg);background:var(--tone-green-tint);border-radius:4px;padding:0 5px">${L('current', 'الحالي')}</span>` : ''}<br><span style="font-size:11.5px;color:var(--ui-muted)">${s.date} · ${n} ${L('pins', 'دبابيس')}</span></span>${s.id === V.sheet ? '<i class="ti ti-check ck"></i>' : ''}</button>`;
    }).join('')}<div class="sep"></div><button class="mi" data-fl="__elev"><i class="ti ti-building-skyscraper"></i>A-201 ${L('Tower 1 Elevation', 'واجهة البرج ١')}<small>${L('Use as floor picker', 'استخدمها لاختيار الطابق')}</small></button></div>` : ''}</span>
 <span class="sp"></span>
 <span class="rel"><button class="vis" data-menu="role"><i class="ti ti-eye"></i>${L(ROLES[V.role].en, ROLES[V.role].ar)}<i class="ti ti-chevron-down"></i></button>${V.menu === 'role' ? `<div class="pop end" data-stop style="min-width:270px"><h6>${L('Demo · view as', 'عرض توضيحي · العرض بصفة')}</h6>${Object.entries(ROLES).map(([k, r]) => `<button class="mi${V.role === k ? ' on' : ''}" data-role="${k}" style="white-space:normal"><i class="ti ${k === 'admin' ? 'ti-shield' : 'ti-user-circle'}"></i><span><b style="display:block;font-weight:600">${L(r.en, r.ar)}</b><span style="font-size:11.5px;color:var(--ui-muted)">${L(r.sub[0], r.sub[1])}</span></span></button>`).join('')}</div>` : ''}</span>
 <span class="rel"><button class="cb ic" data-menu="demo"><i class="ti ti-dots"></i></button>${V.menu === 'demo' ? `<div class="pop end" data-stop><h6>${L('Demo states', 'حالات العرض')}</h6><button class="mi" data-act="d-pop"><i class="ti ti-map-pin"></i>${L('Open example pin', 'فتح الدبوس المثال')}</button><button class="mi" data-act="d-clu"><i class="ti ti-zoom-out"></i>${L('Zoomed out · clusters', 'تصغير · التجميع')}</button><button class="mi" data-act="d-add"><i class="ti ti-plus"></i>${L('Adding a new snag', 'إضافة ملاحظة جديدة')}</button><div class="sep"></div><a class="mi" href="plan-view-mobile.html"><i class="ti ti-device-mobile"></i>${L('Mobile version', 'نسخة الجوال')}<i class="ti ti-arrow-right ck"></i></a></div>` : ''}</span></div>
 <div class="pv-bar fbar">${fsel('type', L('Type', 'النوع'), Object.keys(TYPE).map(k => [k, L(TYPE[k].en, TYPE[k].ar), shapeFlat(k, 'var(--ui-muted)', 14)]))}${fsel('tr', L('Trade', 'التخصص'), Object.keys(TR).map(k => [k, L(TR[k][0], TR[k][1]), `<i style="width:8px;height:8px;border-radius:3px;background:var(--tone-${TR[k][2]}-solid)"></i>`]))}${fsel('st', L('Stage', 'المرحلة'), Object.keys(STAT).filter(k => k !== 'draft').map(k => [k, L(STAT[k].en, STAT[k].ar), `<i style="width:8px;height:8px;border-radius:50%;background:${STAT[k].c}"></i>`]))}
 <span class="rel"><button class="cb fbtn${V.F.dr !== 'all' ? ' set' : ''}" data-menu="dr"><i class="ti ti-calendar"></i>${V.F.dr === 'all' ? L('Any date', 'أي تاريخ') : L('Last ' + V.F.dr + ' days', 'آخر ' + V.F.dr + ' يومًا')}<i class="ti ti-chevron-down"></i></button>${V.menu === 'dr' ? `<div class="pop" data-stop>${[['all', L('Any date', 'أي تاريخ')], ['7', L('Last 7 days', 'آخر 7 أيام')], ['14', L('Last 14 days', 'آخر 14 يومًا')], ['30', L('Last 30 days', 'آخر 30 يومًا')]].map(o => `<button class="mi${V.F.dr === o[0] ? ' on' : ''}" data-dr="${o[0]}">${o[1]}${V.F.dr === o[0] ? '<i class="ti ti-check ck"></i>' : ''}</button>`).join('')}</div>` : ''}</span>
 <span class="tgl" data-act="mine"><span class="swc${V.F.mine ? ' on' : ''}"></span>${L('Assigned to me', 'مسند إليّ')}</span>
 ${V.F.type.size || V.F.tr.size || V.F.st.size || V.F.mine || V.F.dr !== 'all' ? `<button class="cb ter sm" data-act="clearf">${L('Clear all', 'مسح الكل')}</button>` : ''}
 <span class="sp"></span>
 <button class="cb${V.list ? ' on' : ''}" data-act="list"><i class="ti ti-list"></i>${L('List', 'القائمة')}</button>
 <button class="cb pri${V.adding || V.add ? ' on' : ''}" data-act="add"><i class="ti ti-plus"></i>${L('Add pin', 'إضافة دبوس')}</button></div>`;
  }
  function plans() {
    const f = fl();
    const up = [...FLOORS];
    return `<aside class="pcard"><div class="pvh"><i class="ti ti-stack-2"></i>${L('Plans', 'المخططات')}<span class="r">${L('Tower 1', 'البرج ١')}</span></div>
 <div class="elev"><h6>${L('Elevation', 'الواجهة')}<code>A-201</code></h6>${up.map(x => {
      const b = badges(x.id, V.role);
      return `<button class="${x.id === 'rf' ? 'rf ' : ''}${x.id === V.fl ? 'on' : ''}" data-fl="${x.id}">${x.lv}${b.os + b.fail ? '<i></i>' : ''}</button>${x.id === 'gf' ? '<div class="grd"></div>' : ''}`;
    }).join('')}</div>
 <div class="flist">${FLOORS.map(x => {
      const b = badges(x.id, V.role);
      return `<button class="fr${x.id === V.fl ? ' on' : ''}" data-fl="${x.id}"><span class="h"><b>${fname(x)}</b><code>${sheetsFor(x.id).find(s => s.cur).no}</code></span><span class="bdg">${b.os ? `<span class="bg" style="background:${STAT.open.c}" title="${L('Open snags', 'ملاحظات مفتوحة')}">${shapeFlat('snag', 'transparent', 9)}${b.os}</span>` : ''}${b.fail ? `<span class="bg" style="background:${STAT.failed.c}" title="${L('Failed', 'راسب')}">${shapeFlat('insp', 'transparent', 9)}${b.fail}</span>` : ''}${b.ins - b.fail > 0 ? `<span class="bg" style="background:${STAT.review.c}">${shapeFlat('insp', 'transparent', 9)}${b.ins - b.fail}</span>` : ''}${b.com ? `<span class="bg" style="background:${STAT.draft.c}" title="${L('Comments', 'تعليقات')}">${shapeFlat('com', 'transparent', 9)}${b.com}</span>` : ''}${!(b.sn + b.ins + b.com) ? `<span style="font-size:11.5px;color:var(--ui-faint)">${L('No items', 'لا توجد عناصر')}</span>` : ''}</span>${b.old ? `<span class="old"><span class="agd"><i class="on"></i><i class="on"></i><i class="on"></i><i></i></span>${b.old} ${L('at their step 3+ weeks', 'في خطوتها منذ 3+ أسابيع')}</span>` : ''}</button>`;
    }).join('')}</div></aside>`;
  }
  function pinsHtml() {
    const ps = vis();
    const cl = cluster(ps, V.k, 26);
    const drafts = V.add ? `<div class="pin draft new" style="left:${V.add.x}px;top:${V.add.y}px"><span class="g">${shape(V.add.type || 'snag', 'var(--btn-pri)')}</span></div>` : '';
    return cl.map(c => {
      if (c.p.length === 1) {
        const p = c.p[0];
        return `<div class="pin${V.sel === p.id ? ' sel' : ''}${p.fresh ? ' new' : ''}" data-pin="${p.id}" style="left:${p.x}px;top:${p.y}px"><span class="g">${shape(p.type, STAT[p.st].c)}${p.age >= 21 && p.st !== 'closed' ? '<span class="old"></span>' : ''}</span></div>`;
      }
      const w = c.p.slice().sort((a, b) => RANK[a.st] - RANK[b.st])[0];
      return `<div class="clu" data-clu="${c.sx / V.k},${c.sy / V.k}" style="left:${c.sx / V.k}px;top:${c.sy / V.k}px;--c:${STAT[w.st].c}"><span>${c.p.length}</span></div>`;
    }).join('') + drafts;
  }
  function popHtml() {
    const p = V.sel && PINS[V.fl].find(x => x.id === V.sel);
    if (!p || V.add) return '';
    const room = ROOMS.find(r => r.id === p.room);
    return `<div class="ppop" id="ppop" data-stop><div class="ph">${shape(p.type, STAT[p.st].c, 22)}<div class="tx"><code>${p.no}</code><b>${esc(L(p.t[0], p.t[1]))}</b></div><button class="cb ter sm ic x" data-act="desel"><i class="ti ti-x"></i></button></div>
 <div class="pb"><div class="row">${stc(p.st)}<span style="font-size:12px;color:var(--ui-muted)">${L(STAGE[p.st][0], STAGE[p.st][1])}</span></div>
 <div class="kv"><span>${L('Type', 'النوع')}</span><b>${L(TYPE[p.type].en, TYPE[p.type].ar)}</b><span>${L('Trade', 'التخصص')}</span><b>${trc(p.tr)}</b><span>${L('Assigned to', 'مسند إلى')}</span><b>${coAv(p.co)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${L(CO[p.co][0], CO[p.co][1])}</span></b><span>${L('Location', 'الموقع')}</span><b>${fname(fl())} · ${L(room.en, room.ar)}</b><span>${L('Age', 'العمر')}</span><b>${ageDots(p)}</b></div>
 <div class="thumb">${p.photos ? `<i class="ti ti-photo" style="font-size:18px"></i>${L('Site photo', 'صورة الموقع')}<span class="n">${p.photos}</span>` : `<i class="ti ti-photo-off"></i>${L('No photos', 'لا توجد صور')}`}${p.img ? `<img src="${p.img}" alt="">` : ''}</div></div>
 <div class="pf"><button class="cb sm" data-act="locate"><i class="ti ti-focus-2"></i>${L('Centre', 'توسيط')}</button><button class="cb sm pri" data-open="${p.id}"><i class="ti ti-external-link"></i>${L('Open', 'فتح')}</button></div></div>`;
  }
  function typePick() {
    if (!V.add || V.add.step !== 'type') return '';
    return `<div class="tpick" id="tpick" data-stop><h6>${L('What are you adding?', 'ماذا تضيف؟')}</h6>${Object.keys(TYPE).map(k => `<button data-ptype="${k}">${shape(k, k === 'snag' ? STAT.open.c : k === 'insp' ? STAT.review.c : STAT.draft.c, 18)}${L(TYPE[k].en, TYPE[k].ar)}<small>${TYPE[k].code}</small></button>`).join('')}<div class="sep" style="height:1px;background:var(--ui-border-2);margin:4px"></div><button data-act="canceladd"><i class="ti ti-x" style="font-size:16px;color:var(--ui-muted)"></i>${L('Cancel', 'إلغاء')}</button></div>`;
  }
  function canvas() {
    const sh = sheet(),
      total = PINS[V.fl].filter(p => canSee(p, V.role)).length,
      here = PINS[V.fl].filter(p => canSee(p, V.role) && onSheet(p, V.fl, V.sheet)).length;
    return `<section class="pv-canvas" dir="ltr"><div class="pv-stage${V.adding ? ' adding' : ''}" id="pstage"><div class="pv-world" id="pworld">${drawing(sh)}<div class="pins" id="pins">${pinsHtml()}</div></div>${popHtml()}${typePick()}</div>
 <div class="pv-sheet glass"><i class="ti ti-file-text"></i><code>${sh.no}</code>Rev ${sh.rev} · ${here} ${L('pins', 'دبابيس')}</div>
 ${V.adding ? `<div class="pv-hint"><i class="ti ti-map-pin"></i>${L('Click a point on the plan to drop a pin', 'انقر على نقطة في المخطط لوضع دبوس')}<button class="cb sm" data-act="canceladd" style="background:rgba(255,255,255,.12);color:#fff">${L('Cancel', 'إلغاء')}</button></div>` : !sh.cur ? `<div class="pv-warn"><i class="ti ti-alert-triangle"></i>${L(`Superseded sheet · ${total - here} pins live on the current revision`, `مخطط مستبدل · ${total - here} دبابيس على المراجعة الحالية`)}<button class="cb sm" data-sheet="${sheetsFor(V.fl).find(s => s.cur).id}">${L('Go to Rev C', 'الانتقال إلى Rev C')}</button></div>` : ''}
 <div class="pv-leg glass" dir="${S.lang === 'ar' ? 'rtl' : 'ltr'}">${Object.keys(TYPE).map(k => `<span>${shapeFlat(k, '#6a6e7a', 13)}<span class="lb">${L(TYPE[k].en, TYPE[k].ar)}</span></span>`).join('')}<span class="sep"></span>${['open', 'review', 'failed', 'closed'].map(k => `<span><i class="d" style="background:${STAT[k].c}"></i><span class="lb">${L(STAT[k].en, STAT[k].ar)}</span></span>`).join('')}<span class="sep"></span><span><span class="agd"><i class="on"></i><i class="on"></i><i></i><i></i></span><span class="lb">${L('Age in weeks', 'العمر بالأسابيع')}</span></span></div>
 <div class="pv-ctl glass"><button data-zoom="out" title="${L('Zoom out', 'تصغير')}"><i class="ti ti-zoom-out"></i></button><span class="zl" id="pzl">100%</span><button data-zoom="in" title="${L('Zoom in', 'تكبير')}"><i class="ti ti-zoom-in"></i></button><button data-zoom="fit" title="${L('Fit', 'ملاءمة')}"><i class="ti ti-maximize"></i></button></div></section>`;
  }
  function listP() {
    const ps = vis().sort((a, b) => RANK[a.st] - RANK[b.st] || b.age - a.age);
    const c = {
      open: 0,
      failed: 0,
      review: 0,
      closed: 0
    };
    ps.forEach(p => c[p.st] = (c[p.st] || 0) + 1);
    return `<aside class="pcard"><div class="pvh"><i class="ti ti-list"></i>${L('Pinned items', 'العناصر المثبتة')}<span class="r">${ps.length}</span></div><div class="lsum">${['open', 'failed', 'review', 'closed'].filter(k => c[k]).map(k => `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${STAT[k].c};margin-inline-end:5px"></i>${L(STAT[k].en, STAT[k].ar)} <b>${c[k]}</b></span>`).join('')}</div>
 <div class="ilist">${ps.length ? ps.map(p => `<div class="ir${V.sel === p.id ? ' sel' : ''}" data-row="${p.id}">${shape(p.type, STAT[p.st].c, 18)}<div class="tx"><b>${esc(L(p.t[0], p.t[1]))}</b><div class="mt"><code>${p.no}</code><span>${L(TR[p.tr][0], TR[p.tr][1])}</span><span>·</span><span>${L(ROOMS.find(r => r.id === p.room).en, ROOMS.find(r => r.id === p.room).ar)}</span></div></div><div class="r">${stc(p.st)}<span class="agd">${[1, 2, 3, 4].map(i => `<i class="${i <= weeks(p) ? 'on' : ''}"></i>`).join('')}</span></div></div>`).join('') : `<div class="none">${L('No pins match these filters.', 'لا توجد دبابيس مطابقة للتصفية.')}</div>`}</div></aside>`;
  }
  function formP() {
    const a = V.add,
      fm = V.form,
      room = roomAt(a.x, a.y),
      sh = sheet();
    const r = ROLES[V.role];
    const cos = Object.keys(CO).filter(k => !r.co || k === r.co);
    return `<aside class="pcard slidein"><div class="pvh">${shape(a.type, a.type === 'snag' ? STAT.open.c : a.type === 'insp' ? STAT.review.c : STAT.draft.c, 18)}${L('New ', 'جديد: ')}${L(TYPE[a.type].en, TYPE[a.type].ar)}<span class="r"><button class="cb ter sm ic" data-act="canceladd"><i class="ti ti-x"></i></button></span></div>
 <div class="form">
 <div class="fld2"><label>${L('Location', 'الموقع')}</label><div class="locs"><span class="lc"><i class="ti ti-building-skyscraper"></i>${L('Tower 1', 'البرج ١')}</span><span class="lc"><i class="ti ti-stairs"></i>${fname(fl())}</span>${room ? `<span class="lc"><i class="ti ti-map-pin"></i>${L(room.en, room.ar)}</span>` : ''}<span class="lc"><i class="ti ti-file-text"></i>${sh.no} Rev ${sh.rev}</span></div></div>
 <div class="fld2"><label>${L('Title', 'العنوان')} <span class="rq">*</span></label><input id="ftitle" class="${fm.err ? 'err' : ''}" value="${esc(fm.title)}" placeholder="${L('e.g. Cable tray not bonded', 'مثال: حامل الكابلات غير موصول')}"></div>
 <div class="fld2"><label>${L('Trade', 'التخصص')}</label><div class="chipsel">${Object.keys(TR).map(k => `<button class="${fm.tr === k ? 'on' : ''}" data-ftr="${k}"><i class="d" style="background:var(--tone-${TR[k][2]}-solid)"></i>${L(TR[k][0], TR[k][1])}</button>`).join('')}</div></div>
 <div class="fld2"><label>${L('Assign to', 'إسناد إلى')}</label><select id="fco">${cos.map(k => `<option value="${k}"${fm.co === k ? ' selected' : ''}>${L(CO[k][0], CO[k][1])}</option>`).join('')}</select></div>
 <div class="fld2"><label>${L('Description', 'الوصف')}</label><textarea id="fdesc" rows="3" placeholder="${L('What’s wrong, and what needs to happen?', 'ما المشكلة وما المطلوب؟')}">${esc(fm.desc)}</textarea></div>
 <div class="fld2"><label>${L('Photos', 'الصور')}</label><div class="photos">${fm.photos.map(src => `<img class="ph-img" src="${src}" alt="">`).join('')}<button class="ph-add" data-act="photo"><i class="ti ti-camera"></i>${L('Add photo', 'إضافة صورة')}</button></div></div>
 </div><div class="fft"><button class="cb" data-act="canceladd">${L('Cancel', 'إلغاء')}</button><button class="cb pri" data-act="create"><i class="ti ti-check"></i>${L('Create ', 'إنشاء ')}${L(TYPE[a.type].en.split(' ')[0].toLowerCase(), TYPE[a.type].ar)}</button></div></aside>`;
  }
  function view() {
    const side = V.add && V.add.step === 'form' ? formP() : V.list ? listP() : '';
    return `${top()}<div class="pv-body${side ? '' : ' nolist'}">${plans()}${canvas()}${side}</div>${V.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>` : ''}`;
  }
  /* ---------- transform ---------- */
  let raf = 0;
  function applyT() {
    const w = document.getElementById('pworld');
    if (!w) return;
    w.style.transform = `translate(${V.tx}px,${V.ty}px) scale(${V.k})`;
    w.style.setProperty('--inv', 1 / V.k);
    const z = document.getElementById('pzl');
    if (z) z.textContent = Math.round(V.k * 100) + '%';
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const p = document.getElementById('pins');
      if (p) p.innerHTML = pinsHtml();
      place();
    });
  }
  function place() {
    const st = document.getElementById('pstage');
    if (!st) return;
    const r = st.getBoundingClientRect();
    const put = (el, x, y) => {
      if (!el) return;
      const sx = V.tx + x * V.k,
        sy = V.ty + y * V.k,
        w = el.offsetWidth,
        h = el.offsetHeight;
      let left = sx + 22,
        top = sy - 40;
      if (left + w > r.width - 10) left = sx - w - 22;
      if (left < 10) left = 10;
      if (top + h > r.height - 10) top = r.height - h - 10;
      if (top < 10) top = 10;
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    };
    const p = V.sel && PINS[V.fl].find(x => x.id === V.sel);
    if (p) put(document.getElementById('ppop'), p.x, p.y);
    if (V.add) put(document.getElementById('tpick'), V.add.x, V.add.y);
  }
  function fit() {
    const s = document.getElementById('pstage');
    if (!s) return;
    const r = s.getBoundingClientRect();
    if (!r.width) return;
    V.k = Math.min(r.width / W, r.height / H) * .96;
    V.tx = (r.width - W * V.k) / 2;
    V.ty = (r.height - H * V.k) / 2;
    V.auto = true;
    applyT();
  }
  function zoomAt(f, cx, cy) {
    const k2 = Math.max(.25, Math.min(4, V.k * f));
    V.tx = cx - (cx - V.tx) * (k2 / V.k);
    V.ty = cy - (cy - V.ty) * (k2 / V.k);
    V.k = k2;
    V.auto = false;
    applyT();
  }
  function center(x, y, k) {
    const s = document.getElementById('pstage').getBoundingClientRect();
    if (k) V.k = k;
    V.tx = s.width / 2 - x * V.k;
    V.ty = s.height / 2 - y * V.k;
    V.auto = false;
    applyT();
  }
  const toWorld = e => {
    const r = document.getElementById('pstage').getBoundingClientRect();
    return [Math.round((e.clientX - r.left - V.tx) / V.k), Math.round((e.clientY - r.top - V.ty) / V.k)];
  };
  let ro = null,
    roEl = null;
  function after() {
    const s = document.getElementById('pstage');
    if (s && s !== roEl) {
      ro && ro.disconnect();
      roEl = s;
      ro = new ResizeObserver(() => {
        if (V.auto) fit();else place();
      });
      ro.observe(s);
    }
    if (V.auto) fit();else applyT();
  }
  /* ---------- bind ---------- */
  function bind(root, R) {
    let tt;
    const flash = m => {
      V.toast = m;
      R.inner();
      clearTimeout(tt);
      tt = setTimeout(() => {
        V.toast = null;
        R.inner();
      }, 2400);
    };
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.multiple = true;
    file.style.display = 'none';
    document.body.appendChild(file);
    file.addEventListener('change', () => {
      [...file.files].forEach(f => {
        const rd = new FileReader();
        rd.onload = () => {
          V.form.photos.push(rd.result);
          R.inner();
        };
        rd.readAsDataURL(f);
      });
      file.value = '';
    });
    const startAdd = () => {
      V.adding = true;
      V.add = null;
      V.sel = null;
      V.menu = null;
    };
    const saveForm = () => {
      if (!V.form) return;
      const t = document.getElementById('ftitle'),
        d = document.getElementById('fdesc'),
        c = document.getElementById('fco');
      if (t) V.form.title = t.value;
      if (d) V.form.desc = d.value;
      if (c) V.form.co = c.value;
    };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-menu],[data-fk],[data-fclr],[data-dr],[data-role],[data-act],[data-view],[data-fl],[data-sheet],[data-zoom],[data-ptype],[data-ftr],[data-open],[data-row]');
      if (!b) {
        if (V.menu && !e.target.closest('[data-stop]')) {
          V.menu = null;
          R.inner();
        }
        return;
      }
      if (b.closest('.hd,.tabs,.sb')) return;
      const d = b.dataset;
      saveForm();
      if (d.menu) {
        V.menu = V.menu === d.menu ? null : d.menu;
        return R.inner();
      }
      if (d.fk) {
        const [k, v] = d.fk.split(':');
        V.F[k].has(v) ? V.F[k].delete(v) : V.F[k].add(v);
        return R.inner();
      }
      if (d.fclr) {
        V.F[d.fclr] = new Set();
        V.menu = null;
        return R.inner();
      }
      if (d.dr) {
        V.F.dr = d.dr;
        V.menu = null;
        return R.inner();
      }
      if (d.role) {
        V.role = d.role;
        V.menu = null;
        V.sel = null;
        return R.inner();
      }
      if (d.view) {
        if (d.view === 'floor') location.href = 'floor-view.html';
        if (d.view === 'map') location.href = 'map-view.html';
        return;
      }
      if (d.fl) {
        if (d.fl === '__elev') {
          V.menu = null;
          return flash(L('Tip: the elevation in the Plans panel picks a floor', 'تلميح: الواجهة في لوحة المخططات تختار الطابق'));
        }
        V.fl = d.fl;
        V.sheet = sheetsFor(V.fl).find(s => s.cur).id;
        V.sel = null;
        V.add = null;
        V.adding = false;
        V.auto = true;
        V.menu = null;
        history.replaceState(null, '', '?fl=' + d.fl);
        return R.inner();
      }
      if (d.sheet) {
        V.sheet = d.sheet;
        V.menu = null;
        V.sel = null;
        return R.inner();
      }
      if (d.zoom) {
        const s = document.getElementById('pstage').getBoundingClientRect();
        if (d.zoom === 'fit') return fit();
        return zoomAt(d.zoom === 'in' ? 1.3 : 1 / 1.3, s.width / 2, s.height / 2);
      }
      if (d.ptype) {
        V.add.type = d.ptype;
        V.add.step = 'form';
        const rm = roomAt(V.add.x, V.add.y);
        V.form = {
          title: '',
          tr: d.ptype === 'insp' ? 'EL' : 'EL',
          co: ROLES[V.role].co || 'tmc',
          desc: '',
          photos: [],
          err: false
        };
        return R.inner();
      }
      if (d.ftr) {
        V.form.tr = d.ftr;
        return R.inner();
      }
      if (d.open) {
        const p = PINS[V.fl].find(x => x.id === d.open);
        return flash(L(`Opening ${p.no}…`, `جارٍ فتح ${p.no}…`));
      }
      if (d.row) {
        const p = PINS[V.fl].find(x => x.id === d.row);
        V.sel = p.id;
        R.inner();
        if (V.k < .9) center(p.x, p.y, 1.2);else center(p.x, p.y);
        return;
      }
      const a = d.act;
      if (a === 'desel') {
        V.sel = null;
        return R.inner();
      }
      if (a === 'locate') {
        const p = PINS[V.fl].find(x => x.id === V.sel);
        return center(p.x, p.y, Math.max(V.k, 1.4));
      }
      if (a === 'mine') {
        V.F.mine = !V.F.mine;
        return R.inner();
      }
      if (a === 'clearf') {
        V.F = {
          type: new Set(),
          tr: new Set(),
          st: new Set(),
          mine: false,
          dr: 'all'
        };
        return R.inner();
      }
      if (a === 'list') {
        V.list = !V.list;
        V.auto = V.auto;
        return R.inner();
      }
      if (a === 'add') {
        if (V.adding || V.add) {
          V.adding = false;
          V.add = null;
          return R.inner();
        }
        startAdd();
        return R.inner();
      }
      if (a === 'canceladd') {
        V.adding = false;
        V.add = null;
        V.form = null;
        return R.inner();
      }
      if (a === 'photo') return file.click();
      if (a === 'create') {
        if (!V.form.title.trim()) {
          V.form.err = true;
          R.inner();
          document.getElementById('ftitle').focus();
          return;
        }
        const co = V.form.co,
          tr = V.form.tr,
          type = V.add.type,
          key = CO[co][3] + '-' + tr + '-' + TYPE[type].code;
        const n = PINS[V.fl].filter(p => p.no.startsWith('TWR-' + key)).length + 15;
        const p = {
          id: V.fl + '-n' + Date.now(),
          fl: V.fl,
          no: 'TWR-' + key + '-' + String(n).padStart(3, '0'),
          type,
          st: 'open',
          tr,
          co,
          room: (roomAt(V.add.x, V.add.y) || ROOMS[5]).id,
          x: V.add.x,
          y: V.add.y,
          t: [V.form.title, V.form.title],
          age: 0,
          photos: V.form.photos.length,
          img: V.form.photos[0],
          mine: true,
          rev: V.sheet,
          d: 0,
          fresh: 1
        };
        PINS[V.fl].push(p);
        V.add = null;
        V.adding = false;
        V.form = null;
        V.sel = p.id;
        V.list = true;
        return flash(L(`${p.no} created`, `تم إنشاء ${p.no}`));
      }
      if (a === 'd-pop') {
        V.menu = null;
        V.fl = '02';
        V.sheet = 'C';
        V.sel = PINS['02'][0].id;
        R.inner();
        const s = document.getElementById('pstage').getBoundingClientRect();
        return center(712, 520, Math.max(Math.min(s.width / W, s.height / H) * 1.6, .6));
      }
      if (a === 'd-clu') {
        V.menu = null;
        V.sel = null;
        R.inner();
        const s = document.getElementById('pstage').getBoundingClientRect();
        V.k = Math.min(s.width / W, s.height / H) * .62;
        V.tx = (s.width - W * V.k) / 2;
        V.ty = (s.height - H * V.k) / 2;
        V.auto = false;
        return applyT();
      }
      if (a === 'd-add') {
        V.menu = null;
        V.adding = false;
        V.sel = null;
        V.add = {
          x: 560,
          y: 392,
          step: 'form',
          type: 'snag'
        };
        V.form = {
          title: 'Door closer missing',
          tr: 'AR',
          co: ROLES[V.role].co || 'dry',
          desc: '',
          photos: [],
          err: false
        };
        return R.inner();
      }
    });
    root.addEventListener('input', e => {
      if (e.target.id === 'ftitle' && V.form) {
        V.form.title = e.target.value;
        if (V.form.err && e.target.value) {
          V.form.err = false;
          e.target.classList.remove('err');
        }
      }
    });
    root.addEventListener('mouseover', e => {
      const r = e.target.closest('[data-row]'),
        p = e.target.closest('[data-pin]');
      root.querySelectorAll('.pin.hl,.ir.hl').forEach(x => x.classList.remove('hl'));
      const id = r ? r.dataset.row : p ? p.dataset.pin : null;
      if (!id) return;
      root.querySelector(`[data-pin="${id}"]`)?.classList.add('hl');
      root.querySelector(`[data-row="${id}"]`)?.classList.add('hl');
    });
    let P = null;
    root.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const st = e.target.closest('#pstage');
      if (!st || e.target.closest('#ppop,#tpick')) return;
      P = {
        x: e.clientX,
        y: e.clientY,
        tx: V.tx,
        ty: V.ty,
        moved: false,
        t: e.target
      };
    });
    addEventListener('pointermove', e => {
      if (!P) return;
      const dx = e.clientX - P.x,
        dy = e.clientY - P.y;
      if (!P.moved && Math.hypot(dx, dy) > 4) {
        P.moved = true;
        document.getElementById('pstage')?.classList.add('panning');
      }
      if (P.moved) {
        V.tx = P.tx + dx;
        V.ty = P.ty + dy;
        V.auto = false;
        applyT();
      }
    });
    addEventListener('pointerup', e => {
      if (!P) return;
      const p = P;
      P = null;
      document.getElementById('pstage')?.classList.remove('panning');
      if (p.moved) return;
      saveForm();
      if (V.adding) {
        const [x, y] = toWorld(e);
        if (x < 0 || y < 0 || x > W || y > H) return;
        V.adding = false;
        V.add = {
          x,
          y,
          step: 'type',
          type: 'snag'
        };
        return R.inner();
      }
      const c = p.t.closest && p.t.closest('[data-clu]');
      if (c) {
        const [x, y] = c.dataset.clu.split(',').map(Number);
        const s = document.getElementById('pstage').getBoundingClientRect();
        return zoomAt(2, V.tx + x * V.k, V.ty + y * V.k);
      }
      const pin = p.t.closest && p.t.closest('[data-pin]');
      if (V.add && V.add.step === 'form' && !pin) {
        const [x, y] = toWorld(e);
        V.add.x = x;
        V.add.y = y;
        return R.inner();
      }
      V.sel = pin ? pin.dataset.pin : null;
      if (!pin && V.add && V.add.step === 'type') V.add = null;
      R.inner();
    });
    root.addEventListener('wheel', e => {
      const st = e.target.closest('#pstage');
      if (!st || e.target.closest('#ppop')) return;
      e.preventDefault();
      const r = st.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, {
      passive: false
    });
    addEventListener('resize', () => {
      if (V.auto) fit();else place();
    });
    document.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input,textarea,select')) return;
      if (e.key === 'Escape') {
        V.adding = false;
        V.add = null;
        V.sel = null;
        V.menu = null;
        R.inner();
      }
      if (e.key === '+' || e.key === '=') document.querySelector('[data-zoom=in]')?.click();
      if (e.key === '-') document.querySelector('[data-zoom=out]')?.click();
      if (e.key === 'n' || e.key === 'N') {
        startAdd();
        R.inner();
      }
    });
  }
  window.PV = {
    V,
    view,
    bind,
    after
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/plan/plan.js", error: String((e && e.message) || e) }); }

// ui_kits/app/reports/data.js
try { (() => {
// Reports — data. Exposes window.RD.
(function () {
  const TPL = {
    daily: {
      g: 'daily',
      ic: 'ti-calendar',
      tone: 'tomato',
      en: 'Daily Site Report',
      ar: 'تقرير الموقع اليومي',
      d: ['Manpower, equipment, work done and site issues — every working day.', 'العمالة والمعدات والأعمال المنجزة ومشكلات الموقع — كل يوم عمل.'],
      code: 'DSR'
    },
    hseD: {
      g: 'daily',
      ic: 'ti-alert-triangle',
      tone: 'amber',
      en: 'Daily Safety Walk',
      ar: 'جولة السلامة اليومية',
      d: ['Quick PPE and housekeeping check.', 'فحص سريع لمعدات الوقاية والنظافة.'],
      code: 'DSW'
    },
    weekly: {
      g: 'weekly',
      ic: 'ti-chart-bar',
      tone: 'blue',
      en: 'Weekly Progress Report',
      ar: 'تقرير التقدم الأسبوعي',
      d: ['Built from the week’s daily reports, with charts for management.', 'يُبنى من التقارير اليومية للأسبوع مع رسوم بيانية للإدارة.'],
      code: 'WPR'
    },
    hse: {
      g: 'weekly',
      ic: 'ti-shield',
      tone: 'green',
      en: 'Weekly Safety (HSE)',
      ar: 'السلامة الأسبوعية',
      d: ['Checklist inspection with photos; failed items raise snags.', 'فحص بقائمة تحقق مع صور؛ البنود الراسبة تنشئ ملاحظات.'],
      code: 'HSE'
    },
    qa: {
      g: 'weekly',
      ic: 'ti-clipboard-check',
      tone: 'violet',
      en: 'Quality Control',
      ar: 'ضبط الجودة',
      d: ['Quality checks, tests and non-conformances.', 'فحوصات الجودة والاختبارات وحالات عدم المطابقة.'],
      code: 'QCR'
    },
    monthly: {
      g: 'monthly',
      ic: 'ti-report',
      tone: 'cyan',
      en: 'Monthly Report',
      ar: 'التقرير الشهري',
      d: ['Month summary for the client.', 'ملخص الشهر للعميل.'],
      code: 'MR'
    },
    env: {
      g: 'monthly',
      ic: 'ti-world',
      tone: 'green',
      en: 'Environmental',
      ar: 'البيئة',
      d: ['Waste, dust and noise monitoring.', 'مراقبة النفايات والغبار والضوضاء.'],
      code: 'ENV'
    }
  };
  const GROUPS = [['daily', 'Daily', 'يومي'], ['weekly', 'Weekly', 'أسبوعي'], ['monthly', 'Monthly', 'شهري']];
  const ST = {
    draft: ['Draft', 'مسودة', 'gray'],
    review: ['Manager review', 'مراجعة المدير', 'blue'],
    submitted: ['Submitted', 'مُقدَّم', 'violet'],
    returned: ['Returned', 'مُعاد', 'orange'],
    affirmed: ['Affirmed', 'مُعتمد', 'green'],
    missing: ['Missing', 'مفقود', 'red'],
    off: ['Not a working day', 'ليس يوم عمل', 'gray']
  };
  const SORD = ['draft', 'review', 'returned', 'submitted', 'affirmed'];
  // Aug 2025 (1 Aug = Friday). Working days Sun–Thu.
  const days = [];
  const stFor = {
    6: 'missing',
    12: 'returned',
    27: 'submitted',
    28: 'review',
    31: 'draft'
  };
  for (let d = 1; d <= 31; d++) {
    const dow = new Date(2025, 7, d).getDay();
    const off = dow === 5 || dow === 6;
    days.push({
      d,
      dow,
      st: off ? 'off' : d > 28 && d !== 31 ? 'none' : stFor[d] || 'affirmed'
    });
  }
  days[30].st = 'off';
  const MP = [['Masons', 'بنّاؤون'], ['Electricians', 'كهربائيون'], ['Helpers', 'مساعدون'], ['Steel fixers', 'حدّادون']];
  let n = 190;
  const reps = [];
  days.forEach(x => {
    if (['off', 'missing', 'none'].includes(x.st)) return;
    n++;
    const k = x.d;
    reps.push({
      id: 'r' + k,
      tpl: 'daily',
      no: 'TWR-TMC-DSR-' + String(n).padStart(4, '0'),
      d: k,
      st: x.st,
      by: 'Hafiz Hamdan',
      wk: x.st === 'affirmed' ? 0 : x.st === 'returned' ? 2 : 1,
      mp: [10 + k % 4, 14 + k % 6, 22 + k % 5, 3 + k % 3],
      eq: [[['Tower crane', 'رافعة برجية'], 1, 8 + k % 3], [['Concrete pump', 'مضخة خرسانة'], k % 3 ? 1 : 0, k % 3 ? 4 : 0], [['Excavator', 'حفارة'], 1, 6]],
      temp: 42 + k % 4,
      w: k % 5 === 0 ? 'dust' : 'sun',
      lost: k % 5 === 0 ? 1.5 : 0,
      inc: 0,
      iss: k === 7 ? [['Concrete truck delayed 2 h', 'تأخر شاحنة الخرسانة ساعتين']] : []
    });
  });
  const r7 = reps.find(r => r.d === 7);
  Object.assign(r7, {
    no: 'TWR-TMC-DSR-0217',
    mp: [12, 18, 25, 4],
    temp: 44,
    w: 'dust',
    lost: 1.5,
    work: [['Floor 07 slab pour — 40 m³', 'صب بلاطة الطابق ٠٧ — 40 م³'], ['Floor 05 first-fix electrical', 'التمديدات الكهربائية الأولى — الطابق ٠٥']]
  });
  const W1 = {
    id: 'w1',
    tpl: 'weekly',
    no: 'TWR-TMC-WPR-0031',
    wk: 1,
    st: 'draft',
    range: [3, 7],
    by: 'Ali Sonour'
  };
  const HSE1 = {
    id: 'h1',
    tpl: 'hse',
    no: 'TWR-TMC-HSE-0012',
    st: 'submitted',
    d: 7,
    by: 'Khalid Al Dhaheri',
    wk: 1,
    pass: 42,
    fail: 3
  };
  const PPL = {
    hafiz: ['Hafiz Hamdan', 'حافظ حمدان', 'Site Engineer · TMC', '#e98b45'],
    ali: ['Ali Sonour', 'علي سنور', 'Contractor PM · TMC', '#3d6db5'],
    shamsi: ['Mohammed Al Shamsi', 'محمد الشامسي', 'Consultant Manager · DCL', '#b5455a'],
    ahmed: ['Ahmed bin Said', 'أحمد بن سعيد', 'Consultant Engineer · DCL', '#1fae66']
  };
  window.RD = {
    TPL,
    GROUPS,
    ST,
    SORD,
    days,
    reps,
    W1,
    HSE1,
    MP,
    PPL
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/reports/data.js", error: String((e && e.message) || e) }); }

// ui_kits/app/reports/reports.js
try { (() => {
// Reports module. Exposes window.RP2 {V, view, bind}.
(function () {
  const S = RS.S,
    {
      TPL,
      GROUPS,
      ST,
      SORD,
      days,
      reps,
      W1,
      HSE1,
      MP,
      PPL
    } = RD;
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  const T = x => esc(L(x[0], x[1]));
  const V = {
    opt: 'A',
    tpl: 'daily',
    sel: 7,
    role: 'ctr',
    open: null,
    form: null,
    step: 0,
    pdf: false,
    toast: null,
    ask: false,
    note: '',
    weekly: false
  };
  const DOW = [['Sun', 'أحد'], ['Mon', 'اثنين'], ['Tue', 'ثلاثاء'], ['Wed', 'أربعاء'], ['Thu', 'خميس'], ['Fri', 'جمعة'], ['Sat', 'سبت']];
  const fd = d => `${L(DOW[new Date(2025, 7, d).getDay()][0], DOW[new Date(2025, 7, d).getDay()][1])} ${d} ${L('Aug', 'أغسطس')} 2025`;
  const stp = k => `<span class="stp" style="background:var(--tone-${ST[k][2]}-tint);color:var(--tone-${ST[k][2]}-fg)"><i></i>${L(ST[k][0], ST[k][1])}</span>`;
  const age = w => {
    const n = Math.min(4, Math.max(0, w));
    return n ? `<span class="age">${[1, 2, 3, 4].map(i => `<i style="${i <= n ? `background:${n >= 3 ? '#ee964b' : '#9aa0ad'};box-shadow:none` : ''}"></i>`).join('')}</span>` : '';
  };
  const tot = r => r.mp.reduce((a, b) => a + b, 0);
  const rep = d => reps.find(r => r.d === d);
  const tone = k => TPL[k].tone;
  /* ---- template chooser ---- */
  function tplRail() {
    return GROUPS.map(g => `<div class="rg"><h6>${L(g[1], g[2])}</h6>${Object.entries(TPL).filter(([k, t]) => t.g === g[0]).map(([k, t]) => `<button class="rt${V.tpl === k ? ' on' : ''}" data-tpl="${k}"><span class="ic" style="background:var(--tone-${t.tone}-tint);color:var(--tone-${t.tone}-solid)"><i class="ti ${t.ic}"></i></span><span class="tx"><b>${L(t.en, t.ar)}</b><small>${L(t.d[0], t.d[1])}</small></span></button>`).join('')}</div>`).join('');
  }
  function tplTabs() {
    return `<div class="rtabs">${GROUPS.map(g => `<span class="rtg"><small>${L(g[1], g[2])}</small>${Object.entries(TPL).filter(([k, t]) => t.g === g[0]).map(([k, t]) => `<button class="${V.tpl === k ? 'on' : ''}" data-tpl="${k}"><i class="ti ${t.ic}" style="color:var(--tone-${t.tone}-solid)"></i>${L(t.en, t.ar)}</button>`).join('')}</span>`).join('')}</div>`;
  }
  function tplCards() {
    return `<div class="rcards">${Object.entries(TPL).map(([k, t]) => `<button class="rcard${V.tpl === k ? ' on' : ''}" data-tpl="${k}" style="--c:var(--tone-${t.tone}-solid);--ct:var(--tone-${t.tone}-tint)"><span class="ic"><i class="ti ${t.ic}"></i></span><b>${L(t.en, t.ar)}</b><small>${L(GROUPS.find(g => g[0] === t.g)[1], GROUPS.find(g => g[0] === t.g)[2])}</small></button>`).join('')}</div>`;
  }
  /* ---- summary ---- */
  function strip() {
    const c = {
      affirmed: 0,
      missing: 0,
      review: 0,
      submitted: 0,
      returned: 0,
      draft: 0
    };
    days.forEach(x => {
      if (c[x.st] != null) c[x.st]++;
    });
    return `<div class="rstrip"><b>${L('August 2025', 'أغسطس 2025')}</b>${[['affirmed'], ['submitted'], ['review'], ['returned'], ['missing']].map(([k]) => `<span><i style="background:var(--tone-${ST[k][2]}-solid)"></i>${c[k]} ${L(ST[k][0].toLowerCase(), ST[k][1])}</span>`).join('')}</div>`;
  }
  /* ---- calendar ---- */
  function cal() {
    const first = new Date(2025, 7, 1).getDay();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<div class="cd emp"></div>');
    days.forEach(x => {
      const r = rep(x.d);
      const st = x.st;
      cells.push(`<button class="cd ${st}${V.sel === x.d ? ' sel' : ''}" data-day="${x.d}"${st === 'off' ? ' disabled' : ''}><span class="n">${x.d}</span>${st === 'off' ? `<small>${L('Off', 'عطلة')}</small>` : st === 'none' ? '' : st === 'missing' ? `<span class="chip2 miss"><i class="ti ti-plus"></i>${L('Missing', 'مفقود')}</span>` : `${stp(st)}<small class="num">${tot(r)} ${L('workers', 'عامل')}</small>`}</button>`);
    });
    return `<div class="cal"><div class="cw">${[0, 1, 2, 3, 4, 5, 6].map(i => `<span>${L(DOW[i][0], DOW[i][1])}</span>`).join('')}</div><div class="cg">${cells.join('')}</div></div>`;
  }
  function dayPrev() {
    const x = days[V.sel - 1];
    if (!x) return '';
    const r = rep(V.sel);
    if (x.st === 'missing') return `<div class="rprev"><span class="bic" style="background:var(--tone-red-tint);color:var(--tone-red-solid)"><i class="ti ti-calendar-x"></i></span><h3>${fd(V.sel)}</h3><p>${L('No Daily Site Report for this working day.', 'لا يوجد تقرير يومي لهذا اليوم.')}</p><button class="cb pri" data-new="${V.sel}"><i class="ti ti-plus"></i>${L('Add it late', 'إضافته متأخرًا')}</button></div>`;
    if (!r) return `<div class="rprev"><p>${L('Pick a day', 'اختر يومًا')}</p></div>`;
    return `<div class="rprev"><div class="rph"><div><span class="num" style="font-size:12px;color:var(--ui-muted);font-weight:700">${r.no}</span><h3>${fd(r.d)}</h3></div>${stp(r.st)}</div>${kpis(r, 1)}<div class="rpl">${[[L('Weather', 'الطقس'), `${r.w === 'dust' ? L('Dust', 'غبار') : L('Sunny', 'مشمس')} · ${r.temp}°C${r.lost ? ' · ' + r.lost + L(' h lost', ' س ضائعة') : ''}`], [L('Prepared by', 'أعدّه'), r.by], [L('Issues', 'المشكلات'), r.iss.length ? T(r.iss[0]) : L('None', 'لا يوجد')]].map(k => `<div><span>${k[0]}</span><b>${k[1]}</b></div>`).join('')}</div><button class="cb" data-open="${r.id}" style="width:100%"><i class="ti ti-eye"></i>${L('Open report', 'فتح التقرير')}</button></div>`;
  }
  function kpis(r, sm) {
    return `<div class="kp${sm ? ' sm' : ''}"><div style="--c:var(--tone-blue-solid)"><i class="ti ti-users"></i><b>${tot(r)}</b><span>${L('Manpower', 'العمالة')}</span></div><div style="--c:var(--tone-green-solid)"><i class="ti ti-tool"></i><b>${r.eq.filter(e => e[1]).length}/${r.eq.length}</b><span>${L('Equipment working', 'المعدات العاملة')}</span></div><div style="--c:var(--tone-orange-solid)"><i class="ti ti-sun"></i><b>${r.temp}°</b><span>${r.lost ? r.lost + L(' h lost', ' س ضائعة') : L('No time lost', 'لا وقت ضائع')}</span></div><div style="--c:var(--tone-${r.inc ? 'red' : 'green'}-solid)"><i class="ti ti-shield"></i><b>${r.inc}</b><span>${L('Incidents', 'الحوادث')}</span></div></div>`;
  }
  /* ---- register (list) ---- */
  function list() {
    const rs = V.tpl === 'daily' ? reps.slice().reverse() : V.tpl === 'weekly' ? [W1] : V.tpl === 'hse' ? [HSE1] : [];
    if (!rs.length) return empty();
    return `<div class="tw"><table class="lv"><thead><tr><th>${L('Number', 'الرقم')}</th><th>${L('Report date', 'تاريخ التقرير')}</th><th>${L('Prepared by', 'أعدّه')}</th><th>${L('Summary', 'الملخص')}</th><th>${L('Stage', 'المرحلة')}</th><th>${L('Age', 'العمر')}</th><th></th></tr></thead><tbody>${SORD.filter(s => rs.some(r => r.st === s)).map(s => `<tr class="gh open"><td colspan="7"><span class="ghi">${stp(s)}<small>${rs.filter(r => r.st === s).length}</small></span></td></tr>${rs.filter(r => r.st === s).map(r => `<tr data-open="${r.id}" style="cursor:pointer"><td><span class="num" style="font-weight:600;color:var(--ui-muted);font-size:12.5px">${r.no}</span></td><td>${r.range ? `${L('Week', 'الأسبوع')} 32 · ${r.range[0]}–${r.range[1]} ${L('Aug', 'أغسطس')}` : fd(r.d)}</td><td>${r.by}</td><td style="font-size:12.5px;color:var(--ui-text-2)">${r.mp ? `${tot(r)} ${L('workers', 'عامل')} · ${r.eq.filter(e => e[1]).length} ${L('equipment', 'معدات')}${r.iss.length ? ' · 1 ' + L('issue', 'مشكلة') : ''}` : r.pass ? `${r.pass} ${L('pass', 'ناجح')} · ${r.fail} ${L('fail', 'راسب')}` : L('5 daily reports · 1 missing', '5 تقارير يومية · 1 مفقود')}</td><td>${stp(r.st)}</td><td>${age(r.wk)}</td><td>${r.st === 'affirmed' ? '<i class="ti ti-file-text" style="color:var(--tone-red-solid)" title="PDF"></i>' : ''}</td></tr>`).join('')}`).join('')}</tbody></table></div>`;
  }
  /* ---- feed ---- */
  function feed() {
    const rs = V.tpl === 'daily' ? reps.slice().reverse().slice(0, 8) : V.tpl === 'weekly' ? [W1] : [];
    if (!rs.length) return empty();
    return `<div class="feed">${days.filter(x => x.st === 'missing').map(x => `<div class="fi miss"><span class="dt"><b>${x.d}</b><small>${L('Aug', 'أغسطس')}</small></span><div class="fc"><b>${L('Daily report missing', 'التقرير اليومي مفقود')} · ${fd(x.d)}</b><button class="cb sm" data-new="${x.d}"><i class="ti ti-plus"></i>${L('Add it late', 'إضافته متأخرًا')}</button></div></div>`).join('')}${rs.map(r => `<div class="fi" data-open="${r.id}"><span class="dt"><b>${r.d || r.range[1]}</b><small>${L('Aug', 'أغسطس')}</small></span><div class="fc"><div class="fh"><span class="num">${r.no}</span>${stp(r.st)}${age(r.wk)}<span style="flex:1"></span><small>${r.by}</small></div>${r.mp ? kpis(r, 1) : `<div style="font-size:13px;color:var(--ui-muted)">${L('Week 32 · built from 4 daily reports', 'الأسبوع 32 · من 4 تقارير يومية')}</div>`}</div></div>`).join('')}</div>`;
  }
  function empty() {
    return `<div class="empty2"><span class="ic" style="background:var(--tone-tomato-tint);color:var(--btn-pri)"><i class="ti ${TPL[V.tpl].ic}"></i></span><h2>${L('No reports yet', 'لا توجد تقارير بعد')}</h2><p>${L(`Start the first ${TPL[V.tpl].en}.`, `ابدأ أول ${TPL[V.tpl].ar}.`)}</p><button class="cb pri" data-new="today"><i class="ti ti-plus"></i>${L('New report', 'تقرير جديد')}</button></div>`;
  }
  /* ---- weekly ---- */
  function bars() {
    const wd = [3, 4, 5, 6, 7];
    const mx = 80;
    return `<div class="bars">${wd.map(d => {
      const r = rep(d);
      const v = r ? tot(r) : 0;
      return `<div class="bc"><div class="bw">${r ? MP.map((m, i) => `<i style="height:${r.mp[i] / mx * 150}px;background:var(--tone-${['blue', 'cyan', 'violet', 'amber'][i]}-solid)"></i>`).join('') : `<em>${L('Missing', 'مفقود')}</em>`}</div><b class="num">${v || '—'}</b><small>${L(DOW[new Date(2025, 7, d).getDay()][0], DOW[new Date(2025, 7, d).getDay()][1])} ${d}</small></div>`;
    }).join('')}</div><div class="lgd">${MP.map((m, i) => `<span><i style="background:var(--tone-${['blue', 'cyan', 'violet', 'amber'][i]}-solid)"></i>${T(m)}</span>`).join('')}</div>`;
  }
  function weekly() {
    return `<div class="wkb">${V.ign ? '' : `<div class="warnb"><i class="ti ti-calendar-x"></i><div style="flex:1"><b>${L('Daily report for Tue 6 Aug is missing', 'التقرير اليومي ليوم الثلاثاء 6 أغسطس مفقود')}</b><small>${L('Totals below skip that day.', 'الإجماليات أدناه لا تشمل ذلك اليوم.')}</small></div><button class="cb sm" data-new="6">${L('Add it late', 'إضافته متأخرًا')}</button><button class="cb sm ter" data-act="ign">${L('Ignore', 'تجاهل')}</button></div>`}${V.ign ? `<div class="okb" style="background:var(--tone-gray-tint);color:var(--ui-text-2)"><i class="ti ti-info-circle"></i>${L('Missing Tue 6 Aug ignored — recorded in history.', 'تم تجاهل 6 أغسطس — مسجّل في السجل.')}</div>` : ''}
 <div class="okb" style="background:var(--tone-blue-tint);color:var(--tone-blue-fg)"><i class="ti ti-refresh"></i>${L('Pre-filled from 4 affirmed Daily reports (Sun 3 – Thu 7 Aug).', 'مُعبأ مسبقًا من 4 تقارير يومية معتمدة (3–7 أغسطس).')}</div>
 <div class="g2c"><section class="box"><h6>${L('Manpower per day', 'العمالة اليومية')}</h6>${bars()}</section><section class="box"><h6>${L('Week totals', 'إجماليات الأسبوع')}</h6><table class="mt"><tbody>${MP.map((m, i) => `<tr><td>${T(m)}</td><td class="num">${[3, 4, 5, 7].reduce((a, d) => a + (rep(d) ? rep(d).mp[i] : 0), 0)}</td></tr>`).join('')}<tr><td><b>${L('Worker-days', 'أيام العمل')}</b></td><td class="num"><b>${[3, 4, 5, 7].reduce((a, d) => a + (rep(d) ? tot(rep(d)) : 0), 0)}</b></td></tr><tr><td>${L('Crane hours', 'ساعات الرافعة')}</td><td class="num">${[3, 4, 5, 7].reduce((a, d) => a + (rep(d) ? rep(d).eq[0][2] : 0), 0)} h</td></tr><tr><td>${L('Hours lost to weather', 'ساعات ضائعة بسبب الطقس')}</td><td class="num">${[3, 4, 5, 7].reduce((a, d) => a + (rep(d) ? rep(d).lost : 0), 0)} h</td></tr></tbody></table></section></div>
 <section class="box"><h6>${L('Progress summary · look-ahead', 'ملخص التقدم · الأسبوع القادم')}</h6><textarea class="ta" rows="3">${L('Floor 07 slab poured; Floor 05 first-fix electrical 70%. Next week: Floor 08 formwork, Floor 06 first-fix.', 'تم صب بلاطة الطابق ٠٧؛ التمديدات الكهربائية للطابق ٠٥ بنسبة 70٪. الأسبوع القادم: قوالب الطابق ٠٨.')}</textarea></section></div>`;
  }
  /* ---- detail ---- */
  function flow(r) {
    const steps = [['draft', L('Prepared', 'أُعد'), 'hafiz'], ['review', L('Manager review', 'مراجعة المدير'), 'ali'], ['submitted', L('Consultant', 'الاستشاري'), 'shamsi'], ['affirmed', L('Affirmed', 'معتمد'), 'shamsi']];
    const i = Math.max(0, SORD.indexOf(r.st === 'returned' ? 'review' : r.st));
    const map = {
      draft: 0,
      review: 1,
      returned: 1,
      submitted: 2,
      affirmed: 3
    };
    const ci = map[r.st];
    return `<div class="flow">${steps.map((s, j) => `<div class="fs${j < ci || r.st === 'affirmed' ? ' done' : j === ci ? ' cur' : ''}"><span>${j < ci || r.st === 'affirmed' ? '<i class="ti ti-check"></i>' : j + 1}</span><b>${s[1]}</b><small>${PPL[s[2]][0]}</small></div>`).join('<i class="fl2"></i>')}</div>`;
  }
  function acts(r) {
    const R = V.role;
    const b = [];
    if (R === 'ctr' && (r.st === 'draft' || r.st === 'returned')) b.push(`<button class="cb pri" data-do="review"><i class="ti ti-send"></i>${L('Send to manager', 'إرسال للمدير')}</button>`);
    if (R === 'pm' && r.st === 'review') b.push(`<button class="cb" data-do="returned"><i class="ti ti-arrow-back-up"></i>${L('Return', 'إرجاع')}</button><button class="cb pri" data-do="submitted"><i class="ti ti-signature"></i>${L('Submit to consultant ✍', 'تقديم للاستشاري ✍')}</button>`);
    if (R === 'cns' && r.st === 'submitted') b.push(`<button class="cb" data-act="ask"><i class="ti ti-message-question"></i>${L('Ask a question', 'طرح سؤال')}</button><button class="cb pri" data-do="affirmed"><i class="ti ti-signature"></i>${L('Affirm ✍', 'اعتماد ✍')}</button>`);
    return b.join('') || `<span style="font-size:12.5px;color:var(--ui-muted)">${r.st === 'affirmed' ? L('Affirmed — sealed PDF issued.', 'معتمد — تم إصدار PDF مختوم.') : L('Waiting for the next person.', 'بانتظار الشخص التالي.')}</span>`;
  }
  function detail() {
    const r = V.open === 'w1' ? W1 : V.open === 'h1' ? HSE1 : reps.find(x => x.id === V.open);
    if (!r) return '';
    const t = TPL[r.tpl];
    const body = r.tpl === 'weekly' ? weekly() : r.tpl === 'hse' ? `<div class="kp"><div style="--c:var(--tone-green-solid)"><i class="ti ti-check"></i><b>${r.pass}</b><span>Pass</span></div><div style="--c:var(--tone-red-solid)"><i class="ti ti-x"></i><b>${r.fail}</b><span>Fail → ${r.fail} snags</span></div></div><section class="box"><h6>${L('Failed items', 'البنود الراسبة')}</h6>${[['Missing guardrail at Floor 07 slab edge', 'حاجز مفقود عند حافة بلاطة الطابق ٠٧'], ['Extension cable damaged – Floor 05', 'كابل تمديد تالف – الطابق ٠٥'], ['Fire extinguisher expired – Level B1', 'طفاية حريق منتهية – القبو ١']].map(x => `<div class="fli"><i class="ti ti-x"></i>${T(x)}<span class="ty" style="margin-inline-start:auto;background:var(--tone-red-tint);color:var(--tone-red-fg)"><i class="ti ti-alert-triangle"></i>${L('Snag raised', 'أُنشئت ملاحظة')}</span></div>`).join('')}</section>` : `${kpis(r)}<div class="g2c"><section class="box"><h6>${L('Manpower', 'العمالة')}</h6>${MP.map((m, i) => `<div class="mpr"><span>${T(m)}</span><i><em style="width:${r.mp[i] / 30 * 100}%"></em></i><b class="num">${r.mp[i]}</b></div>`).join('')}<div class="mpr tot"><span>${L('Total', 'الإجمالي')}</span><i></i><b class="num">${tot(r)}</b></div></section><section class="box"><h6>${L('Equipment', 'المعدات')}</h6>${r.eq.map(e => `<div class="eqr"><span>${T(e[0])}</span>${e[1] ? `<span class="ty" style="background:var(--tone-green-tint);color:var(--tone-green-fg)"><i class="ti ti-check"></i>${e[2]} h</span>` : `<span class="ty" style="background:var(--tone-gray-tint);color:var(--ui-muted)">${L('Idle', 'متوقف')}</span>`}</div>`).join('')}</section><section class="box"><h6>${L('Work done', 'الأعمال المنجزة')}</h6>${(r.work || [['Floor 05 first-fix electrical', 'التمديدات الكهربائية — الطابق ٠٥']]).map(w => `<div class="fli" style="color:var(--ui-text)"><i class="ti ti-check" style="color:var(--tone-green-solid)"></i>${T(w)}</div>`).join('')}</section><section class="box"><h6>${L('Issues & delays', 'المشكلات والتأخير')}</h6>${r.iss.length ? r.iss.map(x => `<div class="fli" style="background:var(--tone-amber-tint);color:var(--tone-amber-fg)"><i class="ti ti-clock"></i>${T(x)}</div>`).join('') : `<div style="font-size:13px;color:var(--ui-muted)">${L('None reported', 'لم يُبلّغ عن شيء')}</div>`}</section></div>`;
    return `<div class="scrim" data-close="1"><div class="drw rdrw" data-stop><div class="dh" style="padding-bottom:12px"><div class="t1"><span class="ty" style="background:var(--tone-${t.tone}-tint);color:var(--tone-${t.tone}-fg)"><i class="ti ${t.ic}"></i>${L(t.en, t.ar)}</span><span class="num" style="font-size:12.5px;font-weight:700;color:var(--ui-muted)">${r.no}</span>${stp(r.st)}${age(r.wk)}<span class="segv" style="margin-inline-start:auto" title="demo">${[['ctr', L('Site Engineer', 'مهندس الموقع')], ['pm', L('Contractor PM', 'مدير المقاول')], ['cns', L('Consultant', 'الاستشاري')]].map(x => `<button class="${V.role === x[0] ? 'on' : ''}" data-role="${x[0]}">${x[1]}</button>`).join('')}</span><button class="cb ter sm ic" data-close="1"><i class="ti ti-x"></i></button></div><h2>${r.range ? L('Week 32 · 3–7 Aug 2025', 'الأسبوع 32 · 3–7 أغسطس 2025') : fd(r.d)}</h2>${flow(r)}<div class="acts">${acts(r)}<span style="flex:1"></span><button class="cb" data-act="pdf"><i class="ti ti-file-download"></i>${L('Export PDF', 'تصدير PDF')}</button></div>${V.ask ? `<div class="actf" style="margin-top:10px"><h4><i class="ti ti-message-question"></i>${L('Ask the contractor', 'اسأل المقاول')}</h4><textarea id="rq" rows="2" placeholder="${L('e.g. Please confirm helper count — gate log shows 22.', 'مثال: يرجى تأكيد عدد المساعدين')}"></textarea><div class="row"><button class="cb" data-act="ask">${L('Cancel', 'إلغاء')}</button><button class="cb pri" data-act="sendq"><i class="ti ti-send"></i>${L('Send & return', 'إرسال وإرجاع')}</button></div></div>` : ''}</div><div class="db">${body}</div></div></div>`;
  }
  function pdf() {
    if (!V.pdf) return '';
    const r = reps.find(x => x.id === V.open) || rep(7);
    return `<div class="scrim" data-act="pdfx" style="z-index:95"><div class="a4" data-stop><div class="ph"><span class="lg">R</span><div><b>${L('Daily Site Report', 'تقرير الموقع اليومي')} / تقرير الموقع اليومي</b><small>Dubai Marina Tower – Phase 2 · TMC Constructions</small></div><div style="margin-inline-start:auto;text-align:end"><b class="num">${r.no}</b><small>${fd(r.d)}</small></div></div><table class="pt"><tr><th>${L('Weather', 'الطقس')}</th><td>${r.w === 'dust' ? 'Sunny, dust later' : 'Sunny'} · ${r.temp}°C · ${r.lost} h lost</td></tr></table><table class="pt"><tr><th>${L('Trade', 'الفئة')}</th><th>${L('Count', 'العدد')}</th></tr>${MP.map((m, i) => `<tr><td>${T(m)}</td><td class="num">${r.mp[i]}</td></tr>`).join('')}<tr><td><b>${L('Total', 'الإجمالي')}</b></td><td class="num"><b>${tot(r)}</b></td></tr></table><table class="pt"><tr><th>${L('Equipment', 'المعدات')}</th><th>${L('Hours', 'الساعات')}</th></tr>${r.eq.map(e => `<tr><td>${T(e[0])}</td><td class="num">${e[2]}</td></tr>`).join('')}</table><div class="pgal">${[1, 2, 3].map(i => `<div><span></span><small>${L('Photo', 'صورة')} ${i} · 10:${10 + i * 7}</small></div>`).join('')}</div><div class="sig">${[['Prepared', 'hafiz'], ['Reviewed', 'ali'], ['Affirmed', 'shamsi']].map(s => `<div><small>${s[0]}</small><b>${PPL[s[1]][0]}</b><em>✍ ${L('signed', 'موقّع')}</em></div>`).join('')}</div><div class="pf"><span class="qr"></span><small>${L('Verify at rabaed.com/v/', 'تحقق عبر rabaed.com/v/')}${r.no}</small><span style="margin-inline-start:auto">Page 1 of 1</span></div><div class="pbar2"><button class="cb" data-act="pdfx">${L('Close', 'إغلاق')}</button><button class="cb pri" data-act="dl"><i class="ti ti-download"></i>${L('Download PDF', 'تنزيل PDF')}</button></div></div></div>`;
  }
  /* ---- create ---- */
  const SECS = [['ti-info-circle', 'General', 'عام'], ['ti-sun', 'Weather', 'الطقس'], ['ti-users', 'Manpower', 'العمالة'], ['ti-tool', 'Equipment', 'المعدات'], ['ti-truck', 'Materials', 'المواد'], ['ti-checklist', 'Work done', 'الأعمال'], ['ti-alert-triangle', 'Issues & safety', 'المشكلات والسلامة'], ['ti-camera', 'Photos', 'الصور']];
  function create() {
    if (!V.form) return '';
    const f = V.form;
    const sec = V.step;
    let body = '';
    if (sec === 0) body = `<div class="fg2"><label>${L('Report date', 'تاريخ التقرير')}<input value="${fd(f.d)}" readonly></label><label>${L('Shift', 'الوردية')}<select><option>${L('Day', 'نهاري')}</option><option>${L('Night', 'ليلي')}</option></select></label><label style="grid-column:1/-1">${L('Locations', 'المواقع')}<span class="chs">${['Floor 05', 'Floor 07', 'Roof'].map((x, i) => `<button class="${i < 2 ? 'on' : ''}">${x}</button>`).join('')}</span></label></div>`;
    if (sec === 1) body = `<div class="wx">${[['sun', 'ti-sun', L('Sunny', 'مشمس')], ['cloud', 'ti-cloud', L('Cloudy', 'غائم')], ['dust', 'ti-wind', L('Dust storm', 'عاصفة ترابية')], ['rain', 'ti-cloud-rain', L('Rain', 'مطر')]].map(w => `<button class="${f.w === w[0] ? 'on' : ''}" data-wx="${w[0]}"><i class="ti ${w[1]}"></i>${w[2]}</button>`).join('')}</div><div class="fg2"><label>${L('Temperature', 'الحرارة')} °C<input type="number" value="${f.temp}"></label><label>${L('Hours lost to weather', 'ساعات ضائعة')}<input type="number" value="${f.lost}"></label></div>`;
    if (sec === 2) body = `<div class="okb" style="background:var(--tone-blue-tint);color:var(--tone-blue-fg)"><i class="ti ti-copy"></i>${L('Manpower changes little day to day.', 'العمالة تتغير قليلًا يوميًا.')}<button class="cb sm" data-act="copy" style="margin-inline-start:auto">${L('Copy from yesterday', 'نسخ من الأمس')}</button></div>${f.mp.map((m, i) => `<div class="mrow"><div><b>${esc(m[0])}</b><small>${esc(m[1])}</small></div><div class="stepr"><button data-st="${i}:-1">−</button><span class="num">${m[2]}</span><button data-st="${i}:1">+</button></div><button class="cb ter sm ic" data-rm="${i}"><i class="ti ti-trash"></i></button></div>`).join('')}<button class="cb" data-act="addrow"><i class="ti ti-plus"></i>${L('Add row', 'إضافة صف')}</button><div class="mrow tot"><b>${L('Total', 'الإجمالي')}</b><b class="num">${f.mp.reduce((a, m) => a + m[2], 0)}</b></div>`;
    if (sec > 2) body = `<div class="okb" style="background:var(--ui-surface-2);color:var(--ui-muted)"><i class="ti ti-forms"></i>${L('Fields for this section come from the template.', 'حقول هذا القسم تأتي من القالب.')}</div><textarea class="ta" rows="4" placeholder="${L('Notes…', 'ملاحظات…')}"></textarea>${sec === 7 ? `<div class="gal2">${[1, 2].map(i => `<div class="ph2"><i class="ti ti-photo"></i><small>10:${14 + i * 9} · GPS ✓</small></div>`).join('')}<button class="phadd"><i class="ti ti-camera"></i>${L('Take photo', 'التقاط صورة')}</button></div>` : ''}`;
    const done = f.done.length;
    return `<div class="scrim" data-close="1"><div class="cmod" data-stop><div class="ch"><div><b>${L('New Daily Site Report', 'تقرير يومي جديد')}</b><small>${fd(f.d)} · ${L('template', 'القالب')} v2 · <span style="color:var(--tone-green-fg)"><i class="ti ti-check"></i> ${L('Saved 10:42', 'حُفظ 10:42')}</span></small></div><button class="cb ter sm ic" data-close="1" style="margin-inline-start:auto"><i class="ti ti-x"></i></button></div><div class="cbod"><nav class="snav"><div class="prg"><b>${done} ${L('of', 'من')} ${SECS.length}</b> ${L('sections done', 'أقسام مكتملة')}<i><em style="width:${done / SECS.length * 100}%"></em></i></div>${SECS.map((s, i) => `<button class="${i === sec ? 'on' : ''}${f.done.includes(i) ? ' dn' : ''}" data-sec="${i}"><i class="ti ${f.done.includes(i) ? 'ti-circle-check' : s[0]}"></i>${L(s[1], s[2])}</button>`).join('')}</nav><div class="sbody"><h3><i class="ti ${SECS[sec][0]}"></i>${L(SECS[sec][1], SECS[sec][2])}</h3>${body}</div></div><div class="cf2"><button class="cb" data-act="prev"${sec ? '' : ' disabled'}>${L('Previous', 'السابق')}</button><span style="flex:1"></span><button class="cb" data-act="draft">${L('Save as draft', 'حفظ كمسودة')}</button>${sec < SECS.length - 1 ? `<button class="cb pri" data-act="next">${L('Next', 'التالي')}</button>` : `<button class="cb pri" data-act="send"><i class="ti ti-send"></i>${L('Send to manager', 'إرسال للمدير')}</button>`}</div></div></div>`;
  }
  /* ---- page ---- */
  function view() {
    const t = TPL[V.tpl];
    const head = `<div class="rhd"><div><h1>${L('Reports', 'التقارير')}</h1><p>${L('Site reports built from templates · Daily · Weekly · Monthly', 'تقارير الموقع من القوالب · يومي · أسبوعي · شهري')}</p></div><span style="flex:1"></span><span class="segv" title="${L('Design option', 'خيار التصميم')}">${[['A', L('A · Calendar', 'أ · التقويم')], ['B', L('B · Register', 'ب · السجل')], ['C', L('C · Feed', 'ج · الموجز')]].map(o => `<button class="${V.opt === o[0] ? 'on' : ''}" data-opt="${o[0]}">${o[1]}</button>`).join('')}</span><button class="cb" data-act="wk"><i class="ti ti-chart-bar"></i>${L('Weekly from dailies', 'الأسبوعي من اليوميات')}</button><button class="cb pri" data-new="today"><i class="ti ti-plus"></i>${L('New ', 'جديد: ')}${L(t.en, t.ar)}</button></div>`;
    let main = '';
    if (V.opt === 'A') main = `<div class="la"><aside class="card rrail">${tplRail()}</aside><section class="card" style="padding:14px">${strip()}${V.tpl === 'daily' ? cal() : list()}</section><aside class="card">${V.tpl === 'daily' ? dayPrev() : `<div class="rprev"><p>${L(t.d[0], t.d[1])}</p></div>`}</aside></div>`;
    if (V.opt === 'B') main = `${tplTabs()}${strip()}${list()}`;
    if (V.opt === 'C') main = `${tplCards()}<div class="lc2"><div>${feed()}</div><aside class="card" style="padding:14px"><h6 class="h6">${L('Manpower · this week', 'العمالة · هذا الأسبوع')}</h6>${bars()}</aside></div>`;
    return head + main + detail() + create() + pdf() + (V.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>` : '');
  }
  function bind(root, R) {
    let tt;
    const flash = m => {
      V.toast = m;
      R();
      clearTimeout(tt);
      tt = setTimeout(() => {
        V.toast = null;
        R();
      }, 2200);
    };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-opt],[data-tpl],[data-day],[data-open],[data-new],[data-close],[data-role],[data-do],[data-act],[data-sec],[data-wx],[data-st],[data-rm]');
      if (!b || b.closest('.hd,.tabs,.sb')) return;
      const d = b.dataset;
      if (d.close !== undefined) {
        if (e.target.closest('[data-stop]') && !b.closest('button')) return;
        V.open = null;
        V.form = null;
        V.ask = false;
        return R();
      }
      if (d.opt) {
        V.opt = d.opt;
        return R();
      }
      if (d.tpl) {
        V.tpl = d.tpl;
        return R();
      }
      if (d.day) {
        V.sel = +d.day;
        return R();
      }
      if (d.open) {
        V.open = d.open;
        V.ask = false;
        V.role = reps.find(r => r.id === d.open)?.st === 'submitted' ? 'cns' : V.role;
        return R();
      }
      if (d.new) {
        const dd = d.new === 'today' ? 31 : +d.new;
        V.open = null;
        V.form = {
          d: dd,
          w: 'sun',
          temp: 44,
          lost: 0,
          mp: MP.map((m, i) => [m[0], m[1], 0]),
          done: []
        };
        V.step = 0;
        return R();
      }
      if (d.role) {
        V.role = d.role;
        V.ask = false;
        return R();
      }
      if (d.do) {
        const r = V.open === 'w1' ? W1 : V.open === 'h1' ? HSE1 : reps.find(x => x.id === V.open);
        r.st = d.do;
        r.wk = d.do === 'affirmed' ? 0 : 1;
        const x = days[r.d - 1];
        if (x) x.st = d.do;
        return flash(L(`${r.no} → ${ST[d.do][0]}`, `${r.no} ← ${ST[d.do][1]}`));
      }
      if (d.sec) {
        V.form.done = [...new Set([...V.form.done, V.step])];
        V.step = +d.sec;
        return R();
      }
      if (d.wx) {
        V.form.w = d.wx;
        return R();
      }
      if (d.st) {
        const [i, v] = d.st.split(':').map(Number);
        V.form.mp[i][2] = Math.max(0, V.form.mp[i][2] + v);
        return R();
      }
      if (d.rm !== undefined) {
        V.form.mp.splice(+d.rm, 1);
        return R();
      }
      const a = d.act;
      if (a === 'ask') {
        V.ask = !V.ask;
        return R();
      }
      if (a === 'sendq') {
        const r = reps.find(x => x.id === V.open);
        r.st = 'returned';
        V.ask = false;
        return flash(L('Question sent — report returned to contractor', 'أُرسل السؤال — أُعيد التقرير للمقاول'));
      }
      if (a === 'pdf') {
        V.pdf = true;
        return R();
      }
      if (a === 'pdfx') {
        if (e.target.closest('[data-stop]') && !b.closest('button')) return;
        V.pdf = false;
        return R();
      }
      if (a === 'dl') return flash(L('PDF downloaded', 'تم تنزيل PDF'));
      if (a === 'wk') {
        V.open = 'w1';
        return R();
      }
      if (a === 'ign') {
        V.ign = true;
        return R();
      }
      if (a === 'copy') {
        const y = rep(28) || rep(27);
        V.form.mp.forEach((m, i) => m[2] = y.mp[i]);
        return flash(L('Copied from yesterday', 'تم النسخ من الأمس'));
      }
      if (a === 'addrow') {
        V.form.mp.push(['Carpenters', 'نجّارون', 0]);
        return R();
      }
      if (a === 'next') {
        V.form.done = [...new Set([...V.form.done, V.step])];
        V.step++;
        return R();
      }
      if (a === 'prev') {
        V.step--;
        return R();
      }
      if (a === 'draft') {
        V.form = null;
        return flash(L('Saved as draft', 'حُفظ كمسودة'));
      }
      if (a === 'send') {
        const f = V.form;
        const x = days[f.d - 1];
        x.st = 'review';
        reps.push({
          id: 'r' + f.d,
          tpl: 'daily',
          no: 'TWR-TMC-DSR-0' + (240 + f.d),
          d: f.d,
          st: 'review',
          by: 'Hafiz Hamdan',
          wk: 0,
          mp: f.mp.slice(0, 4).map(m => m[2]),
          eq: rep(7).eq,
          temp: f.temp,
          w: f.w,
          lost: f.lost,
          inc: 0,
          iss: []
        });
        V.form = null;
        V.sel = f.d;
        return flash(L('Sent to Ali Sonour (Contractor PM)', 'أُرسل إلى علي سنور'));
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        V.open = null;
        V.form = null;
        V.pdf = false;
        R();
      }
    });
  }
  window.RP2 = {
    V,
    view,
    bind
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/reports/reports.js", error: String((e && e.message) || e) }); }

// ui_kits/app/settings/numbering.js
try { (() => {
// Project Settings → Document Numbering. Exposes window.DN {view, bind}.
(function () {
  const S = RS.S;
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  const MAX = 6;
  const SEG = {
    project: {
      en: 'Project code',
      ar: 'رمز المشروع',
      ex: () => 'TWR',
      tone: 'project',
      scope: 0
    },
    type: {
      en: 'Work item type',
      ar: 'نوع العنصر',
      ex: c => c.type,
      tone: 'type',
      scope: 1
    },
    trade: {
      en: 'Trade',
      ar: 'التخصص',
      ex: c => c.trade,
      tone: 'trade',
      scope: 1
    },
    company: {
      en: 'Company',
      ar: 'الشركة',
      ex: c => c.company,
      tone: 'company',
      scope: 1
    },
    loc: {
      en: 'Location',
      ar: 'الموقع',
      ex: (c, s) => ({
        zone: 'ZA',
        bldg: 'T1',
        floor: 'F01'
      })[s.level || 'bldg'],
      tone: 'loc',
      scope: 1
    },
    text: {
      en: 'Fixed text',
      ar: 'نص ثابت',
      ex: (c, s) => (s.v || 'TXT').toUpperCase(),
      tone: 'text',
      scope: 0
    }
  };
  const LEVEL = {
    zone: ['Zone', 'المنطقة'],
    bldg: ['Building', 'المبنى'],
    floor: ['Floor', 'الطابق']
  };
  const TYPES = [['MAR', 'Material Approval Request', 'طلب اعتماد مواد'], ['SAR', 'Shop Drawing', 'مخطط تنفيذي'], ['DAR', 'Document', 'مستند'], ['IR', 'Inspection Request', 'طلب فحص'], ['SNG', 'Snag', 'ملاحظة'], ['DSR', 'Daily Site Report', 'تقرير الموقع اليومي']];
  // existing register (counts) to compute "next"
  const REG = [{
    company: 'TMC',
    trade: 'EL',
    type: 'MAR',
    n: 41
  }, {
    company: 'TMC',
    trade: 'CV',
    type: 'MAR',
    n: 18
  }, {
    company: 'GLF',
    trade: 'EL',
    type: 'MAR',
    n: 7
  }, {
    company: 'TMC',
    trade: 'EL',
    type: 'SAR',
    n: 12
  }, {
    company: 'GLF',
    trade: 'CV',
    type: 'MAR',
    n: 5
  }, {
    company: 'TMC',
    trade: 'ME',
    type: 'MAR',
    n: 9
  }];
  const SAMPLES = [{
    company: 'TMC',
    trade: 'EL',
    type: 'MAR',
    en: 'TMC · Electrical',
    ar: 'TMC · كهربائية'
  }, {
    company: 'TMC',
    trade: 'CV',
    type: 'MAR',
    en: 'TMC · Civil',
    ar: 'TMC · مدنية'
  }, {
    company: 'GLF',
    trade: 'EL',
    type: 'MAR',
    en: 'Gulf Builders · Electrical',
    ar: 'الخليج · كهربائية'
  }];
  const mk = () => ({
    segs: [{
      k: 'project'
    }, {
      k: 'company'
    }, {
      k: 'trade'
    }, {
      k: 'type'
    }],
    sep: '-',
    digits: 3,
    scope: {
      company: 1,
      trade: 1,
      type: 1
    }
  });
  const clone = o => JSON.parse(JSON.stringify(o));
  const D = {
    saved: mk(),
    draft: mk(),
    over: {
      SAR: {
        segs: [{
          k: 'project'
        }, {
          k: 'type'
        }, {
          k: 'loc',
          level: 'bldg'
        }],
        sep: '-',
        digits: 4,
        scope: {
          type: 1,
          loc: 1
        }
      }
    },
    overDraft: null,
    drawer: null,
    modal: false,
    ro: false,
    nav: 'numbering',
    toast: null
  };
  D.savedOver = clone(D.over);
  function next(p, ctx) {
    const sc = Object.keys(p.scope).filter(k => p.scope[k] && p.segs.some(s => s.k === k) && ['company', 'trade', 'type'].includes(k));
    const n = REG.filter(r => sc.every(k => r[k] === ctx[k])).reduce((a, r) => a + r.n, 0);
    return n + 1;
  }
  function parts(p, ctx) {
    const out = p.segs.map(s => ({
      k: s.k,
      t: SEG[s.k].ex(ctx, s)
    }));
    out.push({
      k: 'seq',
      t: String(next(p, ctx)).padStart(p.digits, '0')
    });
    return out;
  }
  const str = (p, ctx) => parts(p, ctx).map(x => x.t).join(p.sep);
  const numHtml = (p, ctx, big) => `<span class="pv-num"${big ? '' : ' style="font-size:inherit"'}>${parts(p, ctx).map((x, i) => `${i ? `<span class="sep">${p.sep}</span>` : ''}<span class="sg tone-${x.k === 'seq' ? 'seq' : SEG[x.k].tone}">${esc(x.t)}</span>`).join('')}</span>`;
  const dirty = () => JSON.stringify(D.draft) !== JSON.stringify(D.saved) || JSON.stringify(D.over) !== JSON.stringify(D.savedOver);
  const CTX0 = SAMPLES[0];
  function warns(p, pid) {
    const w = [];
    if (!p.segs.some(s => s.k === 'company')) w.push(`<div class="wn amber"><i class="ti ti-alert-triangle"></i><div>${L('<b>No Company segment.</b> Contractors sharing this pattern share one counter, so each can infer how many submittals the others raised.', '<b>لا يوجد مقطع الشركة.</b> المقاولون الذين يستخدمون هذا النمط يتشاركون عدّادًا واحدًا، فيمكن لكل منهم معرفة عدد تقديمات الآخرين.')}</div>${D.ro ? '' : `<button class="cb sm ac" data-add="company" data-p="${pid}"${p.segs.length >= MAX ? ' disabled' : ''}><i class="ti ti-plus"></i>${L('Add Company', 'إضافة الشركة')}</button>`}</div>`);
    if (p.segs.length >= MAX) w.push(`<div class="wn blue"><i class="ti ti-info-circle"></i><div>${L(`Maximum of ${MAX} segments reached (plus the sequence). Remove one to add another.`, `تم بلوغ الحد الأقصى وهو ${MAX} مقاطع (إضافة إلى التسلسل). احذف مقطعًا لإضافة آخر.`)}</div></div>`);
    const len = str(p, CTX0).length;
    if (len > 30) w.push(`<div class="wn amber"><i class="ti ti-ruler-2"></i><div>${L(`Numbers will be about <b>${len} characters</b> — long numbers get cut off in tables and exports. Aim for 30 or fewer.`, `سيكون طول الرقم حوالي <b>${len} حرفًا</b> — الأرقام الطويلة تُقتطع في الجداول والتصدير. يُفضّل ألا تتجاوز 30.`)}</div></div>`);
    return w.length ? `<div class="warns">${w.join('')}</div>` : '';
  }
  function builder(p, pid) {
    const used = new Set(p.segs.map(s => s.k));
    const chips = p.segs.map((s, i) => {
      const d = SEG[s.k];
      return `${i ? `<span class="chip-arrow">${esc(p.sep)}</span>` : ''}<div class="chip-s tone-${d.tone}" draggable="${!D.ro}" data-chip="${i}" data-p="${pid}"><i class="ti ti-grid-dots grip"></i><span class="bar"></span><span class="tx"><b>${L(d.en, d.ar)}</b>${s.k === 'text' && !D.ro ? `<input class="mini" data-text="${i}" data-p="${pid}" value="${esc(s.v || 'SUB')}" maxlength="6">` : s.k === 'loc' && !D.ro ? `<select class="mini" data-level="${i}" data-p="${pid}">${Object.entries(LEVEL).map(([k, v]) => `<option value="${k}"${(s.level || 'bldg') === k ? ' selected' : ''}>${L(v[0], v[1])} · ${SEG.loc.ex({}, {
        level: k
      })}</option>`).join('')}</select>` : `<code>${esc(d.ex(CTX0, s))}</code>`}</span><button class="x" data-rm="${i}" data-p="${pid}" title="${L('Remove', 'حذف')}"><i class="ti ti-x"></i></button></div>`;
    }).join('');
    const seq = `<span class="chip-arrow">${esc(p.sep)}</span><div class="chip-s lock tone-seq"><span class="bar"></span><span class="tx"><b>${L('Sequence', 'التسلسل')}</b><code>${'0'.repeat(p.digits - 1)}1</code></span><i class="ti ti-lock"></i></div>`;
    const avail = D.ro ? '' : `<div class="avail"><small>${L('Add segment', 'إضافة مقطع')}</small>${Object.entries(SEG).filter(([k]) => k === 'text' || !used.has(k)).map(([k, d]) => `<button class="add-s tone-${d.tone}" data-add="${k}" data-p="${pid}"${p.segs.length >= MAX ? ' disabled' : ''}><i class="d"></i>${L(d.en, d.ar)}<code>${esc(d.ex(CTX0, {
      level: 'bldg',
      v: 'SUB'
    }))}</code></button>`).join('')}</div>`;
    return `<div class="chips${D.ro ? ' ro' : ''}">${chips}${seq}</div>${avail}${warns(p, pid)}`;
  }
  function options(p, pid) {
    const sc = p.segs.filter(s => SEG[s.k].scope);
    return `<div class="opts">
  <div class="opt"><b>${L('Separator', 'الفاصل')}</b><span class="segx">${['-', '/'].map(x => `<button class="${p.sep === x ? 'on' : ''}" data-sep="${x}" data-p="${pid}"${D.ro ? ' disabled' : ''}>${x}</button>`).join('')}</span></div>
  <div class="opt"><b>${L('Sequence digits', 'عدد خانات التسلسل')}</b><span class="segx">${[3, 4, 5, 6, 7].map(n => `<button class="${p.digits === n ? 'on' : ''}" data-dig="${n}" data-p="${pid}"${D.ro ? ' disabled' : ''}>${n}</button>`).join('')}</span><small>${L('Zero-padded', 'مملوء بالأصفار')} · <span style="direction:ltr;unicode-bidi:isolate;font-family:var(--font-ui)">${'0'.repeat(p.digits - 1)}1 … ${'9'.repeat(p.digits)}</span></small></div>
  <div class="opt" style="grid-column:1/-1"><b>${L('Sequence scope — separate counters', 'نطاق التسلسل — عدّادات منفصلة')}</b><small>${L('Tick a segment to give each of its values its own counter.', 'حدّد مقطعًا ليحصل كل قيمة منه على عدّاد خاص بها.')}</small>
   <div class="scope">${sc.length ? sc.map(s => {
      const d = SEG[s.k],
        on = !!p.scope[s.k];
      return `<span class="sc tone-${d.tone}${on ? ' on' : ''}" data-scope="${s.k}" data-p="${pid}"><span class="bx">${on ? '<i class="ti ti-check"></i>' : ''}</span>${L('Per ', 'لكل ')}${L(d.en, d.ar).toLowerCase()}</span>`;
    }).join('') : `<span class="explain">${L('Add a Company, Trade, Type or Location segment to split counters.', 'أضف مقطع الشركة أو التخصص أو النوع أو الموقع لتقسيم العدّادات.')}</span>`}</div>
   <div class="explain">${p.scope.trade && p.segs.some(s => s.k === 'trade') ? L('Count separately for each Trade → <code>…EL…-001</code> and <code>…CV…-001</code> both exist.', 'عدّ منفصل لكل تخصص ← يوجد <code>…EL…-001</code> و <code>…CV…-001</code> معًا.') : L('One shared counter across trades → Electrical and Civil continue the same sequence.', 'عدّاد واحد مشترك لكل التخصصات ← تستمر الكهربائية والمدنية في نفس التسلسل.')}</div>
   <div class="cnt-ex">${SAMPLES.map(c => `<div>${L(c.en, c.ar)}<b>→ ${String(next(p, c)).padStart(p.digits, '0')}</b></div>`).join('')}</div>
  </div></div>`;
  }
  function preview() {
    const p = D.draft;
    const len = str(p, CTX0).length;
    return `<section class="card pv"><div class="card-hd"><div><h3>${L('Live preview', 'معاينة مباشرة')}</h3><p>${L('The next number for TMC Constructions · Electrical · Material Approval Request.', 'الرقم التالي لـ TMC · كهربائية · طلب اعتماد مواد.')}</p></div></div>
 <div class="card-bd"><div>${numHtml(p, CTX0, 1)}<div class="pv-leg">${[...new Set(p.segs.map(s => s.k))].map(k => `<span class="tone-${SEG[k].tone}"><i></i>${L(SEG[k].en, SEG[k].ar)}</span>`).join('')}<span class="tone-seq"><i></i>${L('Sequence', 'التسلسل')}</span></div><div class="pv-len${len > 30 ? ' warn' : ''}">${L('Length', 'الطول')}: <b>${len}</b> / 30</div></div>
 <div class="samples"><h6>${L('Next numbers', 'الأرقام التالية')}</h6>${SAMPLES.map(c => `<div class="smp"><span>${L(c.en, c.ar)}</span><code>${esc(str(p, c))}</code></div>`).join('')}</div></div></section>`;
  }
  function overrides() {
    return `<section class="card"><div class="card-hd"><div><h3>${L('Per work item type', 'حسب نوع العنصر')}</h3><p>${L('Each type uses the Project default unless you override it.', 'كل نوع يستخدم الإعداد الافتراضي للمشروع ما لم تتجاوزه.')}</p></div></div><div class="card-bd" style="padding:14px 0 0"><div style="overflow-x:auto"><table class="ot"><thead><tr><th>${L('Type', 'النوع')}</th><th>${L('Pattern', 'النمط')}</th><th>${L('Next number', 'الرقم التالي')}</th><th></th></tr></thead><tbody>
 ${TYPES.map(([k, e, a]) => {
      const o = D.over[k],
        p = o || D.draft,
        ctx = {
          ...CTX0,
          type: k
        };
      return `<tr><td><span class="ty"><span class="doc">${k}</span><b>${L(e, a)}</b></span></td><td>${o ? `<span class="badge cus"><i class="ti ti-edit"></i>${L('Custom', 'مخصص')}</span>` : `<span class="badge def">${L('Uses Project default', 'يستخدم الافتراضي')}</span>`}</td><td><code>${esc(str(p, ctx))}</code></td><td><span class="acts">${D.ro ? '' : o ? `<button class="cb sm" data-ovr="${k}"><i class="ti ti-edit"></i>${L('Edit', 'تعديل')}</button><button class="cb ter sm" data-reset="${k}">${L('Reset', 'إعادة ضبط')}</button>` : `<button class="cb sm" data-ovr="${k}">${L('Override', 'تخصيص')}</button>`}</span></td></tr>`;
    }).join('')}
 </tbody></table></div></div></section>`;
  }
  function revision() {
    return `<section class="card"><div class="card-hd"><div><h3>${L('Revision suffix', 'لاحقة المراجعة')}</h3><p>${L('Revisions keep the same number and add Rev 1, Rev 2… This can’t be changed, so the register stays traceable.', 'تحتفظ المراجعات بنفس الرقم مع إضافة Rev 1 و Rev 2… ولا يمكن تغيير ذلك للحفاظ على تتبّع السجل.')}</p></div><span class="r"><span class="ro-note"><i class="ti ti-lock"></i>${L('Fixed', 'ثابت')}</span></span></div><div class="card-bd"><div class="revrow">${[0, 1, 2].map(n => `<code>${esc(str(D.draft, CTX0))}${n ? `<em> Rev ${n}</em>` : ''}</code>`).join('<i class="ti ti-arrow-right" style="color:var(--ui-faint)"></i>')}</div></div></section>`;
  }
  function drawer() {
    if (!D.drawer) return '';
    const k = D.drawer,
      t = TYPES.find(x => x[0] === k),
      p = D.overDraft,
      ctx = {
        ...CTX0,
        type: k
      };
    return `<div class="scrim" data-close="drawer"><div class="drawer" data-stop><div class="dr-hd"><span class="doc" style="display:inline-flex;height:22px;padding:0 7px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--doctype-ring);color:var(--doctype-fg);font:700 11px var(--font-ui);align-items:center">${k}</span><div><h3>${L('Override pattern', 'تخصيص النمط')} · ${L(t[1], t[2])}</h3><small>${L('Only this type changes. Others keep the Project default.', 'يتغير هذا النوع فقط، وتبقى الأنواع الأخرى على الإعداد الافتراضي.')}</small></div><button class="cb ter ic x" data-close="drawer"><i class="ti ti-x"></i></button></div>
 <div class="dr-bd"><section class="card"><div class="card-bd">${numHtml(p, ctx, 1)}</div></section><section class="card"><div class="card-hd"><div><h3>${L('Segments', 'المقاطع')}</h3></div></div><div class="card-bd">${builder(p, 'ovr')}</div></section><section class="card"><div class="card-bd">${options(p, 'ovr')}</div></section></div>
 <div class="dr-ft"><button class="cb ter" data-copydef>${L('Start from Project default', 'البدء من الافتراضي')}</button><span class="sp"></span><button class="cb" data-close="drawer">${L('Cancel', 'إلغاء')}</button><button class="cb pri" data-applyovr><i class="ti ti-check"></i>${L('Apply override', 'تطبيق التخصيص')}</button></div></div></div>`;
  }
  function modal() {
    if (!D.modal) return '';
    return `<div class="scrim" data-close="modal"><div class="modal" data-stop><div class="md-bd"><span class="md-ic"><i class="ti ti-alert-triangle"></i></span><h3>${L('Save numbering changes?', 'حفظ تغييرات الترقيم؟')}</h3><p>${L('Changes apply <b>only to new items</b>. Existing document numbers never change.', 'تنطبق التغييرات <b>على العناصر الجديدة فقط</b>. أرقام المستندات الحالية لن تتغير أبدًا.')}</p>
 <div class="ba"><small>${L('Before', 'قبل')}</small><code>${esc(str(D.saved, CTX0))}</code><i class="ti ti-arrow-down arrow"></i><small>${L('After', 'بعد')}</small><code class="new">${esc(str(D.draft, CTX0))}</code></div>
 <div class="md-li"><span><i class="ti ti-circle-check"></i>${L('The official register keeps every issued number.', 'يحتفظ السجل الرسمي بكل رقم صادر.')}</span><span><i class="ti ti-circle-check"></i>${L('Revisions of existing items keep their original number.', 'مراجعات العناصر الحالية تحتفظ برقمها الأصلي.')}</span>${Object.keys(D.over).length ? `<span><i class="ti ti-circle-check"></i>${L(`${Object.keys(D.over).length} type override(s) are saved with it.`, `يتم حفظ ${Object.keys(D.over).length} تخصيص معه.`)}</span>` : ''}</div></div>
 <div class="md-ft"><button class="cb" data-close="modal">${L('Cancel', 'إلغاء')}</button><button class="cb pri" data-confirm><i class="ti ti-check"></i>${L('Save for new items', 'حفظ للعناصر الجديدة')}</button></div></div></div>`;
  }
  function nav() {
    const items = [['general', 'ti-settings', 'General', 'عام'], ['participants', 'ti-users', 'Participants', 'المشاركون'], ['visibility', 'ti-eye', 'Visibility', 'الظهور'], ['positions', 'ti-user-circle', 'Positions', 'المناصب'], ['trades', 'ti-map-pin', 'Trades & Locations', 'التخصصات والمواقع'], ['stages', 'ti-list-check', 'Stages', 'المراحل'], ['numbering', 'ti-list', 'Document Numbering', 'ترقيم المستندات'], ['workflows', 'ti-refresh', 'Workflows', 'سير العمل'], ['forms', 'ti-clipboard-text', 'Forms', 'النماذج'], ['suppliers', 'ti-building', 'Approved Suppliers', 'الموردون المعتمدون'], ['activity', 'ti-clock', 'Activity', 'النشاط']];
    return `<nav class="st-nav"><h6>${L('Project settings', 'إعدادات المشروع')}</h6>${items.map(i => `<button class="${i[0] === D.nav ? 'on' : ''}" data-snav="${i[0]}"><i class="ti ${i[1]}"></i>${L(i[2], i[3])}</button>`).join('')}</nav>`;
  }
  function view() {
    const ro = D.ro;
    return `<div class="st-wrap">${nav()}<div class="st-main">
 <div class="st-hd"><div><h1>${L('Document Numbering', 'ترقيم المستندات')}</h1><p>${L('Build how Document Numbers are generated the first time a work item leaves Draft. Applies to new items only.', 'حدّد طريقة إنشاء أرقام المستندات عند خروج العنصر من المسودة لأول مرة. ينطبق على العناصر الجديدة فقط.')}</p></div>
  <div class="act">${ro ? `<span class="ro-note"><i class="ti ti-lock"></i>${L('Only Project Admins can change this', 'يمكن لمسؤولي المشروع فقط تغيير ذلك')}</span>` : ''}<span class="segx" title="${L('Demo: view as', 'عرض توضيحي: العرض بصفة')}"><button class="${ro ? '' : 'on'}" data-ro="0" style="font-family:inherit">${L('Admin', 'مسؤول')}</button><button class="${ro ? 'on' : ''}" data-ro="1" style="font-family:inherit">${L('Member', 'عضو')}</button></span></div></div>
 ${preview()}
 <section class="card"><div class="card-hd"><div><h3>${L('Pattern — Project default', 'النمط — الافتراضي للمشروع')}</h3><p>${ro ? L('Current segments, in order.', 'المقاطع الحالية بالترتيب.') : L('Drag to reorder. Up to 6 segments; the sequence is always last.', 'اسحب لإعادة الترتيب. حتى 6 مقاطع، والتسلسل دائمًا في النهاية.')}</p></div><span class="r" style="font:600 12px var(--font-ui);color:var(--ui-muted)">${D.draft.segs.length} / ${MAX}</span></div><div class="card-bd">${builder(D.draft, 'def')}</div></section>
 <section class="card"><div class="card-hd"><div><h3>${L('Sequence', 'التسلسل')}</h3></div></div><div class="card-bd">${options(D.draft, 'def')}</div></section>
 ${overrides()}${revision()}
 </div></div>
 ${dirty() && !ro ? `<div class="savebar"><i class="ti ti-alert-circle"></i>${L('Unsaved changes', 'تغييرات غير محفوظة')}<button class="cb ter sm" data-discard>${L('Discard', 'تجاهل')}</button><button class="cb pri sm" data-save>${L('Review & save', 'مراجعة وحفظ')}</button></div>` : ''}
 ${drawer()}${modal()}${D.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${D.toast}</div>` : ''}`;
  }
  function P(pid) {
    return pid === 'ovr' ? D.overDraft : D.draft;
  }
  function bind(root, render) {
    let tt;
    const flash = m => {
      D.toast = m;
      render();
      clearTimeout(tt);
      tt = setTimeout(() => {
        D.toast = null;
        render();
      }, 2200);
    };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-add],[data-rm],[data-sep],[data-dig],[data-scope],[data-ovr],[data-reset],[data-close],[data-save],[data-confirm],[data-discard],[data-applyovr],[data-copydef],[data-ro],[data-snav]');
      if (!b) return;
      const d = b.dataset;
      if (d.close) {
        if (e.target.closest('[data-stop]') && !e.target.closest('button[data-close]')) return;
        D.drawer = null;
        D.modal = false;
        return render();
      }
      if (d.ro !== undefined) {
        D.ro = d.ro === '1';
        return render();
      }
      if (d.snav) {
        if (d.snav === 'workflows' || d.snav === 'types') {
          location.href = 'settings-workflows.html';
          return;
        }
        if (d.snav !== 'numbering') return flash(L('This settings page is not designed yet.', 'لم تُصمَّم صفحة الإعدادات هذه بعد.'));
        return;
      }
      if (D.ro) return;
      const p = d.p ? P(d.p) : null;
      if (d.add) {
        if (p.segs.length >= MAX || b.disabled) return;
        const s = {
          k: d.add
        };
        if (d.add === 'loc') s.level = 'bldg';
        if (d.add === 'text') s.v = 'SUB';
        p.segs.push(s);
        if (SEG[d.add].scope && d.add === 'company') p.scope.company = 1;
        return render();
      }
      if (d.rm !== undefined) {
        const s = p.segs.splice(+d.rm, 1)[0];
        if (!p.segs.some(x => x.k === s.k)) delete p.scope[s.k];
        return render();
      }
      if (d.sep) {
        p.sep = d.sep;
        return render();
      }
      if (d.dig) {
        p.digits = +d.dig;
        return render();
      }
      if (d.scope) {
        p.scope[d.scope] = p.scope[d.scope] ? 0 : 1;
        return render();
      }
      if (d.ovr) {
        D.drawer = d.ovr;
        D.overDraft = clone(D.over[d.ovr] || D.draft);
        return render();
      }
      if (d.reset !== undefined && d.reset) {
        delete D.over[d.reset];
        return render();
      }
      if (d.copydef !== undefined) {
        D.overDraft = clone(D.draft);
        return render();
      }
      if (d.applyovr !== undefined) {
        D.over[D.drawer] = clone(D.overDraft);
        D.drawer = null;
        return render();
      }
      if (d.save !== undefined) {
        D.modal = true;
        return render();
      }
      if (d.discard !== undefined) {
        D.draft = clone(D.saved);
        D.over = clone(D.savedOver);
        return render();
      }
      if (d.confirm !== undefined) {
        D.saved = clone(D.draft);
        D.savedOver = clone(D.over);
        D.modal = false;
        return flash(L('Numbering saved — applies to new items', 'تم حفظ الترقيم — ينطبق على العناصر الجديدة'));
      }
    });
    root.addEventListener('input', e => {
      const i = e.target;
      if (i.dataset.text !== undefined) {
        P(i.dataset.p).segs[+i.dataset.text].v = i.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const pos = i.selectionStart;
        render();
        const n = root.querySelector(`[data-text="${i.dataset.text}"][data-p="${i.dataset.p}"]`);
        if (n) {
          n.focus();
          n.setSelectionRange(pos, pos);
        }
      }
    });
    root.addEventListener('change', e => {
      const i = e.target;
      if (i.dataset.level !== undefined) {
        P(i.dataset.p).segs[+i.dataset.level].level = i.value;
        render();
      }
    });
    let drag = null;
    root.addEventListener('dragstart', e => {
      const c = e.target.closest('[data-chip]');
      if (!c || D.ro) return;
      if (e.target.closest('input,select')) return e.preventDefault();
      drag = {
        i: +c.dataset.chip,
        p: c.dataset.p
      };
      c.classList.add('drag');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'x');
    });
    root.addEventListener('dragover', e => {
      if (!drag) return;
      const c = e.target.closest('[data-chip]');
      if (!c || c.dataset.p !== drag.p) return;
      e.preventDefault();
      root.querySelectorAll('.chip-s.over').forEach(x => x.classList.remove('over'));
      c.classList.add('over');
      const to = +c.dataset.chip;
      if (to !== drag.i) {
        const p = P(drag.p);
        const [m] = p.segs.splice(drag.i, 1);
        p.segs.splice(to, 0, m);
        drag.i = to;
        render();
        const n = root.querySelector(`[data-chip="${to}"][data-p="${drag.p}"]`);
        n && n.classList.add('drag');
      }
    });
    root.addEventListener('drop', e => {
      if (drag) {
        e.preventDefault();
        drag = null;
        render();
      }
    });
    root.addEventListener('dragend', () => {
      drag = null;
      root.querySelectorAll('.drag,.over').forEach(x => x.classList.remove('drag', 'over'));
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && (D.drawer || D.modal)) {
        D.drawer = null;
        D.modal = false;
        render();
      }
    });
  }
  window.DN = {
    D,
    view,
    bind
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/settings/numbering.js", error: String((e && e.message) || e) }); }

// ui_kits/app/shell/pages.js
try { (() => {
// Rabaed SaaS pages. Exposes window.RP[page](ctx) → {title, sub, html}
(function () {
  const {
    esc,
    av
  } = RS;
  const L = (e, a) => RS.S.lang === 'ar' ? a : e;
  const PROJECTS = [{
    id: 'dmt',
    l: 'D',
    c: '#f8552f',
    n: 'Dubai Marina Tower – Phase 2',
    na: 'برج دبي مارينا – المرحلة ٢',
    co: 'Al Futtaim Construction Co.',
    coa: 'شركة الفطيم للمقاولات',
    p: 62,
    st: 'ok',
    sub: 48,
    mine: 6,
    snag: 12,
    due: 'Mar 2027'
  }, {
    id: 'yas',
    l: 'Y',
    c: '#3d6db5',
    n: 'Yas Bay Residences',
    na: 'مساكن ياس باي',
    co: 'Aldar Properties',
    coa: 'الدار العقارية',
    p: 35,
    st: 'pend',
    sub: 31,
    mine: 3,
    snag: 4,
    due: 'Nov 2027'
  }, {
    id: 'shj',
    l: 'S',
    c: '#1fae66',
    n: 'Sharjah Waterfront Mall',
    na: 'مول واجهة الشارقة المائية',
    co: 'Arada',
    coa: 'أرادَ',
    p: 81,
    st: 'ok',
    sub: 112,
    mine: 1,
    snag: 27,
    due: 'Jan 2027'
  }, {
    id: 'rak',
    l: 'R',
    c: '#6b5ad8',
    n: 'RAK Hospital Extension',
    na: 'توسعة مستشفى رأس الخيمة',
    co: 'RAK Health',
    coa: 'رأس الخيمة الصحية',
    p: 12,
    st: 'sub',
    sub: 9,
    mine: 2,
    snag: 0,
    due: 'Aug 2028'
  }, {
    id: 'alq',
    l: 'A',
    c: '#e98b45',
    n: 'Al Qudra Villas – Cluster B',
    na: 'فلل القدرة – المجموعة ب',
    co: 'Meraas',
    coa: 'مِراس',
    p: 100,
    st: 'mut',
    sub: 204,
    mine: 0,
    snag: 0,
    due: 'Handed over'
  }];
  const STL = {
    ok: ['On track', 'ضمن الجدول'],
    pend: ['At risk', 'معرّض للتأخير'],
    sub: ['Mobilising', 'قيد التجهيز'],
    rej: ['Delayed', 'متأخر'],
    mut: ['Completed', 'مكتمل']
  };
  const pill = (k, txt) => `<span class="pill p-${k}"><span class="d"></span>${txt}</span>`;
  const stp = k => pill(k, L(STL[k][0], STL[k][1]));
  const hd = (h1, p, act) => `<div class="pg-hd"><div><h1>${h1}</h1>${p ? `<p>${p}</p>` : ''}</div>${act ? `<div class="act">${act}</div>` : ''}</div>`;
  const prjCard = p => `<button class="prj" data-project="${p.id}"><div class="prj-t"><span class="l" style="background:${p.c}">${p.l}</span><div><b>${esc(L(p.n, p.na))}</b><small>${esc(L(p.co, p.coa))}</small></div>${stp(p.st)}</div>
 <div><div class="prj-m" style="margin-bottom:6px"><span>${L('Progress', 'نسبة الإنجاز')}</span><b>${p.p}%</b></div><div class="bar"><i style="width:${p.p}%"></i></div></div>
 <div class="prj-s"><span><i class="ti ti-file-text"></i>${p.sub} ${L('submittals', 'تقديم')}</span><span><i class="ti ti-user-circle"></i>${p.mine} ${L('need my action', 'بحاجة لإجرائي')}</span><span><i class="ti ti-calendar"></i>${esc(p.due)}</span></div></button>`;
  const RP = {
    PROJECTS
  };
  RP.home = () => ({
    title: L('Home', 'الرئيسية'),
    sub: L('Thursday, 26 September 2026', 'الخميس، ٢٦ سبتمبر ٢٠٢٦'),
    html: hd(L('Good morning, Mohamed', 'صباح الخير، محمد'), L('Here’s what needs you across your projects today.', 'إليك ما يحتاج إلى إجرائك في مشاريعك اليوم.'), `<button class="bp" data-nav="projects"><i class="ti ti-plus"></i>${L('New project', 'مشروع جديد')}</button>`) + `<div class="grid g4" style="margin-bottom:18px">
  <div class="pc kpi"><span class="ic" style="background:var(--tone-tomato-tint);color:var(--tone-tomato-solid)"><i class="ti ti-buildings"></i></span><b>5</b><span>${L('Active projects', 'مشاريع نشطة')}</span></div>
  <div class="pc kpi"><span class="ic" style="background:var(--tone-blue-tint);color:var(--tone-blue-solid)"><i class="ti ti-user-circle"></i></span><b>12</b><span>${L('Submittals need my action', 'تقديمات بحاجة لإجرائي')}</span></div>
  <div class="pc kpi"><span class="ic" style="background:var(--tone-amber-tint);color:var(--tone-amber-solid)"><i class="ti ti-clipboard-list"></i></span><b>3</b><span>${L('Payment requests pending', 'طلبات دفع معلّقة')}</span></div>
  <div class="pc kpi"><span class="ic" style="background:var(--tone-red-tint);color:var(--tone-red-solid)"><i class="ti ti-clock"></i></span><b>4</b><span>${L('Overdue 8+ days', 'متأخرة ٨+ أيام')}</span></div>
 </div>
 <div class="grid g21">
  <div class="pc"><div class="pc-hd"><h3>${L('Needs my action', 'بحاجة لإجرائي')}</h3><button class="ln" data-project="dmt">${L('Open board', 'فتح اللوحة')}</button></div><div class="pc-bd" style="padding-top:4px;padding-bottom:4px">
   ${[['Fire Suppression System', 'نظام إطفاء الحريق', '12789331 · R2', 'dmt', pill('pend', L('Pending approval', 'بانتظار الاعتماد'))], ['HVAC Ducting', 'مجاري التكييف', '12789319', 'dmt', pill('rej', L('Overdue', 'متأخر'))], ['Basement Waterproofing', 'العزل المائي للقبو', '12789332 · R1', 'yas', pill('sub', L('Resubmitted', 'معاد تقديمه'))], ['Payment request #PR-0142', 'طلب دفع رقم PR-0142', 'AED 1,240,000', 'shj', pill('pend', L('Awaiting review', 'بانتظار المراجعة'))]].map(r => `<div class="act-it"><span class="ic"><i class="ti ti-file-text"></i></span><div><b>${esc(L(r[0], r[1]))}</b><small class="num" style="font-family:var(--font-ui)">${r[2]} · ${esc(L(PROJECTS.find(p => p.id === r[3]).n, PROJECTS.find(p => p.id === r[3]).na))}</small></div><span class="r">${r[4]}</span></div>`).join('')}
  </div></div>
  <div class="pc"><div class="pc-hd"><h3>${L('Recent activity', 'آخر النشاطات')}</h3></div><div class="pc-bd" style="padding-top:4px;padding-bottom:4px">
   ${[['Sarah Al Mansoori', '#b5455a', L('approved Lighting Fixtures (Code B)', 'اعتمدت وحدات الإنارة (Code B)'), '10m'], ['Nasser Al Kaabi', '#e98b45', L('resubmitted Fire Suppression System', 'أعاد تقديم نظام إطفاء الحريق'), '1h'], ['Khalid Al Dhaheri', '#6b5ad8', L('rejected Non-Compliant Materials', 'رفض مواد غير مطابقة'), '3h'], ['Omar Al Blooshi', '#1fae66', L('requested to join Al Futtaim', 'طلب الانضمام إلى الفطيم'), '5h']].map(a => `<div class="act-it">${av(a[0], a[1], 34)}<div><b style="font-weight:500">${esc(a[0])} <span style="color:var(--mut)">${a[2]}</span></b><small class="num">${a[3]} ${L('ago', 'مضت')}</small></div></div>`).join('')}
  </div></div>
 </div>
 <div class="pg-hd" style="margin:28px 0 14px"><div><h1 style="font-size:18px">${L('Your projects', 'مشاريعك')}</h1></div><div class="act"><button class="bs bsm" data-nav="projects">${L('View all', 'عرض الكل')}</button></div></div>
 <div class="grid g3">${PROJECTS.slice(0, 3).map(prjCard).join('')}</div>`
  });
  RP.projects = () => {
    const f = RP._pf || 'all';
    const list = PROJECTS.filter(p => f === 'all' || (f === 'active' ? p.st !== 'mut' : p.st === 'mut'));
    return {
      title: L('Projects', 'المشاريع'),
      sub: L('5 projects · Al Futtaim Construction Co.', '٥ مشاريع · شركة الفطيم للمقاولات'),
      html: hd(L('Projects', 'المشاريع'), L('All projects you are a member of.', 'جميع المشاريع التي أنت عضو فيها.'), `<button class="bp"><i class="ti ti-plus"></i>${L('New project', 'مشروع جديد')}</button>`) + `<div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;align-items:center"><label class="fin"><i class="ti ti-search"></i><input placeholder="${L('Search projects', 'ابحث في المشاريع')}"></label>${[['all', 'All', 'الكل'], ['active', 'Active', 'نشطة'], ['done', 'Completed', 'مكتملة']].map(c => `<button class="chipf${f === c[0] ? ' on' : ''}" data-pf="${c[0]}">${L(c[1], c[2])}</button>`).join('')}</div>
 <div class="grid g3">${list.map(prjCard).join('')}</div>`
    };
  };
  RP.payments = () => ({
    title: L('Payment Requests', 'طلبات الدفع'),
    sub: L('Interim payment applications across projects', 'طلبات الدفع المرحلية لجميع المشاريع'),
    html: hd(L('Payment Requests', 'طلبات الدفع'), L('Track interim payment applications from submission to certification.', 'تتبّع طلبات الدفع المرحلية من التقديم حتى الاعتماد.'), `<button class="bs"><i class="ti ti-download"></i>${L('Export', 'تصدير')}</button><button class="bp"><i class="ti ti-plus"></i>${L('New request', 'طلب جديد')}</button>`) + `<div class="pc"><div class="tbar"><label class="fin"><i class="ti ti-search"></i><input placeholder="${L('Search by reference or project', 'ابحث بالمرجع أو المشروع')}"></label>${[['All', 'الكل', 1], ['Pending', 'معلّقة'], ['Certified', 'معتمدة'], ['Returned', 'مُعادة']].map(c => `<button class="chipf${c[2] ? ' on' : ''}">${L(c[0], c[1])}</button>`).join('')}</div>
 <div class="ovx"><table class="tbl"><thead><tr><th>${L('Reference', 'المرجع')}</th><th>${L('Project', 'المشروع')}</th><th>${L('Period', 'الفترة')}</th><th>${L('Amount (AED)', 'المبلغ (درهم)')}</th><th>${L('Status', 'الحالة')}</th><th>${L('Submitted', 'تاريخ التقديم')}</th></tr></thead><tbody>
 ${[['PR-0142', 'shj', 'Aug 2026', '1,240,000', 'pend', 'Awaiting review', 'بانتظار المراجعة', '22 Sep 2026'], ['PR-0141', 'dmt', 'Aug 2026', '3,815,500', 'ok', 'Certified', 'معتمد', '15 Sep 2026'], ['PR-0139', 'yas', 'Jul 2026', '960,250', 'rej', 'Returned', 'مُعاد', '02 Sep 2026'], ['PR-0137', 'dmt', 'Jul 2026', '2,904,000', 'ok', 'Certified', 'معتمد', '14 Aug 2026'], ['PR-0135', 'rak', 'Jul 2026', '418,700', 'sub', 'Submitted', 'مُقدَّم', '09 Aug 2026']].map(r => {
      const p = PROJECTS.find(x => x.id === r[1]);
      return `<tr><td class="num" style="font-weight:600">${r[0]}</td><td>${esc(L(p.n, p.na))}</td><td class="num">${r[2]}</td><td class="num" style="font-weight:600">${r[3]}</td><td>${pill(r[4], L(r[5], r[6]))}</td><td class="num" style="color:var(--mut)">${r[7]}</td></tr>`;
    }).join('')}
 </tbody></table></div></div>`
  });
  RP.map = () => ({
    title: L('Map View', 'عرض الخريطة'),
    sub: L('Project locations', 'مواقع المشاريع'),
    html: hd(L('Map View', 'عرض الخريطة'), '') + `<div class="map-ph"><i class="ti ti-map"></i><b style="color:var(--ink)">${L('Map view', 'عرض الخريطة')}</b><span>${L('Not designed yet — placeholder.', 'لم يُصمَّم بعد — مساحة مؤقتة.')}</span></div>`
  });
  RP.profile = () => ({
    title: L('Company Profile', 'ملف الشركة'),
    sub: L('My Company · general information for all modules', 'شركتي · معلومات عامة لجميع الوحدات'),
    html: `<div class="pc" style="margin-bottom:18px"><div class="co-hd"><span class="co-lg">AF</span><div><h2>${L('Al Futtaim Construction Co.', 'شركة الفطيم للمقاولات')}</h2><p>${L('Main contractor · Dubai, UAE · Member since 2024', 'مقاول رئيسي · دبي، الإمارات · عضو منذ ٢٠٢٤')}</p></div><div style="margin-inline-start:auto;display:flex;gap:10px"><button class="bs"><i class="ti ti-edit"></i>${L('Edit profile', 'تعديل الملف')}</button></div></div></div>
 <div class="grid g21"><div class="pc"><div class="pc-hd"><h3>${L('Company information', 'معلومات الشركة')}</h3></div><div class="pc-bd"><div class="kv">
  ${[['Legal name', 'الاسم القانوني', 'Al Futtaim Construction Co. LLC'], ['Trade licence', 'الرخصة التجارية', 'DED-704512'], ['TRN', 'الرقم الضريبي', '100 2345 6789 0003'], ['Company type', 'نوع الشركة', L('Main contractor', 'مقاول رئيسي')], ['Headquarters', 'المقر الرئيسي', L('Festival City, Dubai', 'دبي فستيفال سيتي')], ['Phone', 'الهاتف', '+971 4 213 4000'], ['Email', 'البريد الإلكتروني', 'projects@alfuttaim.ae'], ['Website', 'الموقع', 'alfuttaim.ae']].map(k => `<div><small>${L(k[0], k[1])}</small><b class="${/\d|@|\./.test(k[2]) ? 'num' : ''}">${esc(k[2])}</b></div>`).join('')}
 </div></div></div>
 <div class="pc"><div class="pc-hd"><h3>${L('Company documents', 'مستندات الشركة')}</h3><button class="ln">${L('Upload', 'رفع')}</button></div><div class="pc-bd" style="display:flex;flex-direction:column;gap:10px">
  ${[['Trade licence', 'الرخصة التجارية', 'PDF · 1.2 MB', 'ok', 'Valid', 'سارية'], ['VAT certificate', 'شهادة ضريبة القيمة المضافة', 'PDF · 640 KB', 'ok', 'Valid', 'سارية'], ['ISO 9001', 'ISO 9001', 'PDF · 2.1 MB', 'pend', 'Expires in 30d', 'تنتهي خلال ٣٠ يومًا']].map(d => `<div class="doc"><span class="ic"><i class="ti ti-file-text"></i></span><div><b>${L(d[0], d[1])}</b><small>${d[2]}</small></div>${pill(d[3], L(d[4], d[5]))}</div>`).join('')}
 </div></div></div>`
  });
  const ROLES = [['Contractor Engineer', 'مهندس المقاول', 'var(--tone-blue-solid)', 'var(--tone-blue-tint)', 14, [1, 1, 0, 1, 0]], ['Contractor Project Manager', 'مدير مشروع المقاول', 'var(--tone-violet-solid)', 'var(--tone-violet-tint)', 4, [1, 1, 1, 1, 1]], ['Consultant', 'الاستشاري', 'var(--tone-green-solid)', 'var(--tone-green-tint)', 6, [1, 0, 1, 0, 1]], ['Client Representative', 'ممثل المالك', 'var(--tone-orange-solid)', 'var(--tone-orange-tint)', 2, [1, 0, 1, 0, 0]], ['Company Admin', 'مسؤول الشركة', 'var(--tone-gray-fg)', 'var(--tone-gray-tint)', 1, [1, 1, 1, 1, 1]]];
  RP.roles = () => {
    const i = RP._role || 0,
      r = ROLES[i];
    const perms = [['View', 'عرض'], ['Create', 'إنشاء'], ['Approve', 'اعتماد'], ['Edit', 'تعديل'], ['Delete', 'حذف']];
    const mods = [['Submittals', 'التقديمات'], ['Packages', 'الحزم'], ['Daily Site Report', 'تقرير الموقع اليومي'], ['Snag List', 'قائمة الملاحظات'], ['Payment Requests', 'طلبات الدفع'], ['Files', 'الملفات']];
    return {
      title: L('Roles', 'الأدوار'),
      sub: L('My Company · who can do what, in every module', 'شركتي · من يستطيع ماذا في كل وحدة'),
      html: hd(L('Roles', 'الأدوار'), L('Roles apply to every project and module in the company.', 'تنطبق الأدوار على جميع المشاريع والوحدات في الشركة.'), `<button class="bp"><i class="ti ti-plus"></i>${L('New role', 'دور جديد')}</button>`) + `<div class="grid g-roles"><div class="pc"><div class="rl">${ROLES.map((x, j) => `<button class="${j === i ? 'on' : ''}" data-roleview="${j}"><span class="ic" style="background:${x[3]};color:${x[2]}"><i class="ti ti-shield"></i></span><div><b>${L(x[0], x[1])}</b><small>${x[4]} ${L('members', 'أعضاء')}</small></div></button>`).join('')}</div></div>
 <div class="pc"><div class="pc-hd"><h3>${L(r[0], r[1])}</h3><span class="pill p-mut">${r[4]} ${L('members', 'أعضاء')}</span><button class="ln">${L('Edit permissions', 'تعديل الصلاحيات')}</button></div><div class="pc-bd ovx"><table class="pm"><thead><tr><th>${L('Module', 'الوحدة')}</th>${perms.map(p => `<th>${L(p[0], p[1])}</th>`).join('')}</tr></thead><tbody>
 ${mods.map((m, mi) => `<tr><td>${L(m[0], m[1])}</td>${perms.map((p, pi) => {
        const on = pi === 0 || r[5][pi] && (mi + pi) % 4 !== 3;
        return `<td><i class="ti ${on ? 'ti-circle-check y' : 'ti-minus n'}"></i></td>`;
      }).join('')}</tr>`).join('')}
 </tbody></table></div></div></div>`
    };
  };
  RP._reqs = RP._reqs || [['Omar Al Blooshi', 'omar@arabtec.ae', '#1fae66', 'Consultant', 'الاستشاري', 'Arabtec', '2h'], ['Layla Al Qasimi', 'layla@alec.ae', '#b5455a', 'Contractor Engineer', 'مهندس المقاول', 'ALEC', '5h'], ['Hassan Al Marri', 'hassan@aldar.ae', '#3a3f4b', 'Client Representative', 'ممثل المالك', 'Aldar', '1d'], ['Fatima Al Mazrouei', 'fatima@alfuttaim.ae', '#e98b45', 'Contractor Engineer', 'مهندس المقاول', 'Al Futtaim', '2d'], ['Yousef Al Nuaimi', 'yousef@meraas.ae', '#3d6db5', 'Contractor Project Manager', 'مدير مشروع المقاول', 'Meraas', '3d']];
  RP.join = () => ({
    title: L('Request To Join', 'طلبات الانضمام'),
    sub: L('My Company · people asking to join your workspace', 'شركتي · أشخاص يطلبون الانضمام إلى مساحة العمل'),
    html: hd(L('Request To Join', 'طلبات الانضمام'), L('Approve to add them as users with the requested role.', 'وافق لإضافتهم كمستخدمين بالدور المطلوب.')) + `<div class="pc">${RP._reqs.length ? RP._reqs.map((q, i) => `<div class="req">${av(q[0], q[2], 42)}<div><b>${esc(q[0])}</b><small class="num">${q[1]}</small></div><div class="meta"><span><i class="ti ti-shield"></i>${L(q[3], q[4])}</span><span><i class="ti ti-building"></i>${q[5]}</span><span class="num" style="color:var(--mut)"><i class="ti ti-clock"></i>${q[6]}</span></div><div class="ac"><button class="bno" data-req="no:${i}">${L('Decline', 'رفض')}</button><button class="bok" data-req="ok:${i}"><i class="ti ti-check"></i>${L('Approve', 'موافقة')}</button></div></div>`).join('') : `<div class="empty"><div class="ic"><i class="ti ti-user-plus"></i></div><b>${L('No pending requests', 'لا توجد طلبات معلّقة')}</b>${L('New requests will appear here.', 'ستظهر الطلبات الجديدة هنا.')}</div>`}</div>`
  });
  RP.users = () => ({
    title: L('Users', 'المستخدمون'),
    sub: L('My Company · 27 users', 'شركتي · ٢٧ مستخدمًا'),
    html: hd(L('Users', 'المستخدمون'), L('Everyone in your company workspace.', 'جميع أعضاء مساحة عمل شركتك.'), `<button class="bp"><i class="ti ti-user-plus"></i>${L('Invite user', 'دعوة مستخدم')}</button>`) + `<div class="pc"><div class="tbar"><label class="fin"><i class="ti ti-search"></i><input placeholder="${L('Search by name or email', 'ابحث بالاسم أو البريد')}"></label></div><div class="ovx"><table class="tbl"><thead><tr><th>${L('Name', 'الاسم')}</th><th>${L('Role', 'الدور')}</th><th>${L('Projects', 'المشاريع')}</th><th>${L('Status', 'الحالة')}</th><th>${L('Last active', 'آخر نشاط')}</th></tr></thead><tbody>
 ${[['Mohamed Al Hashimi', 'mohamed@alfuttaim.ae', '#6b5ad8', 0, 5, 'ok', 'Active', 'نشط', 'Now'], ['Ahmed bin Said', 'ahmed@alfuttaim.ae', '#3d6db5', 0, 3, 'ok', 'Active', 'نشط', '12m'], ['Abdullah Al Saadi', 'abdullah@alfuttaim.ae', '#7a5c3a', 1, 4, 'ok', 'Active', 'نشط', '1h'], ['Nasser Al Kaabi', 'nasser@alfuttaim.ae', '#e98b45', 0, 2, 'ok', 'Active', 'نشط', '3h'], ['Sarah Al Mansoori', 'sarah@consult.ae', '#b5455a', 2, 2, 'pend', 'Invited', 'مدعو', '—'], ['Khalid Al Dhaheri', 'khalid@alfuttaim.ae', '#6b5ad8', 0, 1, 'mut', 'Deactivated', 'معطّل', '30d']].map(u => `<tr><td><div class="who">${av(u[0], u[2], 36)}<div><b>${esc(u[0])}</b><small>${u[1]}</small></div></div></td><td>${L(ROLES[u[3]][0], ROLES[u[3]][1])}</td><td class="num">${u[4]}</td><td>${pill(u[5], L(u[6], u[7]))}</td><td class="num" style="color:var(--mut)">${u[8]}</td></tr>`).join('')}
 </tbody></table></div></div>`
  });
  RP.subs = () => ({
    title: L('Subscription Management', 'إدارة الاشتراك'),
    sub: L('My Company · plan, usage and billing', 'شركتي · الخطة والاستخدام والفوترة'),
    html: hd(L('Subscription', 'الاشتراك'), '') + `<div class="pc plan" style="margin-bottom:18px"><div><div class="tag">${L('Current plan', 'الخطة الحالية')}</div><h2>${L('Business', 'الأعمال')}</h2><p>${L('Renews on 01 Jan 2027 · billed yearly', 'تتجدد في ٠١ يناير ٢٠٢٧ · فوترة سنوية')}</p></div><div class="pr"><b>AED 18,000</b><small>${L('per year', 'سنويًا')}</small></div><div style="display:flex;gap:10px"><button class="bs">${L('Manage billing', 'إدارة الفوترة')}</button><button class="bp">${L('Upgrade', 'ترقية')}</button></div></div>
 <div class="grid g21"><div class="pc"><div class="pc-hd"><h3>${L('Usage', 'الاستخدام')}</h3></div><div class="pc-bd" style="display:flex;flex-direction:column;gap:18px">
  ${[['Projects', 'المشاريع', 5, 10], ['Users', 'المستخدمون', 27, 50], ['Storage', 'التخزين', 64, 100, 'GB']].map(u => `<div class="use"><div class="h"><span>${L(u[0], u[1])}</span><b>${u[2]} / ${u[3]}${u[4] ? ' ' + u[4] : ''}</b></div><div class="bar"><i style="width:${u[2] / u[3] * 100}%"></i></div></div>`).join('')}
 </div></div>
 <div class="pc"><div class="pc-hd"><h3>${L('Billing history', 'سجل الفواتير')}</h3></div><div class="pc-bd" style="padding-top:4px;padding-bottom:4px">
  ${[['INV-2026-001', '01 Jan 2026', '18,000'], ['INV-2025-001', '01 Jan 2025', '15,000']].map(b => `<div class="act-it"><span class="ic"><i class="ti ti-file-text"></i></span><div><b class="num">${b[0]}</b><small class="num">${b[1]}</small></div><span class="r num" style="font-weight:600">AED ${b[2]}</span></div>`).join('')}
 </div></div></div>`
  });
  RP.project = (p, tab) => {
    const tn = RS.t('tabs')[tab];
    if (tab === 0) return `<div class="grid g4" style="margin-bottom:18px">${[[L('Progress', 'الإنجاز'), p.p + '%'], [L('Submittals', 'التقديمات'), p.sub], [L('Need my action', 'بحاجة لإجرائي'), p.mine], [L('Open snags', 'ملاحظات مفتوحة'), p.snag]].map(k => `<div class="pc kpi"><span>${k[0]}</span><b>${k[1]}</b></div>`).join('')}</div><div class="pc"><div class="pc-hd"><h3>${L('Project details', 'تفاصيل المشروع')}</h3>${stp(p.st)}</div><div class="pc-bd"><div class="kv">${[[L('Client', 'المالك'), L(p.co, p.coa)], [L('Main contractor', 'المقاول الرئيسي'), L('Al Futtaim Construction Co.', 'شركة الفطيم للمقاولات')], [L('Completion', 'الإنجاز المتوقع'), p.due], [L('Location', 'الموقع'), L('Dubai, UAE', 'دبي، الإمارات')]].map(k => `<div><small>${k[0]}</small><b>${esc(k[1])}</b></div>`).join('')}</div></div></div>`;
    if (tab === 1) return `<div class="pc"><div class="empty"><div class="ic"><i class="ti ti-layout-grid"></i></div><b>${tn}</b>${L('The Kanban board is designed separately.', 'لوحة كانبان مصممة بشكل منفصل.')}<div style="margin-top:16px"><a class="bp" href="submittals-kanban.html" target="_blank" style="text-decoration:none"><i class="ti ti-external-link"></i>${L('Open Submittals board', 'فتح لوحة التقديمات')}</a></div></div></div>`;
    return `<div class="pc"><div class="empty"><div class="ic"><i class="ti ti-file-text"></i></div><b>${tn}</b>${L('Module not designed yet.', 'لم تُصمَّم هذه الوحدة بعد.')}</div></div>`;
  };
  window.RP = RP;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/shell/pages.js", error: String((e && e.message) || e) }); }

// ui_kits/app/shell/shell.js
try { (() => {
// ?bg=warm → warm canvas option (#fdf9f5) for background comparison
(function () {
  const b = new URLSearchParams(location.search).get('bg') || (((window.name || '') + location.hash).match(/bg=(\w+)/) || [])[1];
  if (b !== 'warm' && b !== 'inv' && b !== 'br') return;
  const st = document.createElement('style');
  st.textContent = ':root{--ui-canvas:#fdf9f5;--ui-surface-2:#fcf7f2;--ui-hover:#f9f2eb;--ui-press:#f3eae1;--ui-border:#efe6dd;--ui-border-2:#f3ece5;--ui-border-strong:#e3d8cd;--ui-text:#2a221d;--ui-text-2:#4a403a;--ui-muted:#7a6d62;--ui-faint:#a8998c;--btn-sec:#f4ede6;--btn-sec-h:#ece3da;--btn-sec-p:#e3d8cd;--btn-sec-fg:#2a221d;--btn-ter-h:#f4ede6;--btn-ter-p:#ece3da;--btn-ter-fg:#4a403a;--btn-dis:#f4ede6;--btn-dis-fg:#b8aa9d;--tone-gray-tint:#f2eae2;--tone-gray-fg:#6f6258;--tone-gray-solid:#a3958a;--status-draft-bg:#f2eae2;--status-draft-fg:#6f6258;--status-notstarted-bg:#f2eae2;--status-notstarted-fg:#6f6258;--fld-fill:#f8f2ec;--fld-bd:#e3d8cd;--fld-mut:#8a7c70;--ctl-off:#d8ccc1;--menu-bd:#ece2d8;--menu-hov:#f9f2eb;--doctype-ring:#e3d8cd;--doctype-fg:#6f6258}\nhtml .rs:not(.light):not(.theme-dark){--sb-bg:#231b16;--sb-bd:#30261f;--sb-fg:#e6dcd2;--sb-ic:#ab9c8f;--sb-lbl:#8c7d70;--sb-hov:rgba(255,236,220,.06);--sb-press:rgba(255,236,220,.10);--sb-act:rgba(248,85,47,.18);--sb-card:#2e241e;--sb-div:#372c24}\nhtml .rs.light{--sb-bg:#fffcf9;--sb-bd:#efe6dd;--sb-fg:#4a403a;--sb-ic:#7a6d62;--sb-lbl:#a8998c;--sb-hov:#f9f2eb;--sb-press:#f3eae1;--sb-card:#f9f2eb;--sb-div:#efe6dd}\nhtml .rs:not(.theme-dark) .tip,html .rs:not(.theme-dark) .tip::before{background:#2a221d}\nhtml .rs:not(.theme-dark) .lang button.on,html .rs:not(.theme-dark) .chipf.on{background:#2a221d;border-color:#2a221d}\nhtml .rs:not(.theme-dark) .srch{background:#fcf7f2;border-color:#ece2d8}\nhtml .theme-dark{--ui-canvas:#16110e;--ui-surface:#1f1814;--ui-surface-2:#241c17;--ui-border:#3a2e26;--ui-border-2:#2f251f;--ui-border-strong:#4a3c32;--ui-text:#f4ede6;--ui-text-2:#d8ccc1;--ui-muted:#a5978b;--ui-faint:#7f7166;--ui-hover:#281f1a;--ui-press:#312720;--ui-overlay:rgba(10,6,4,.62);--focus-offset:#1f1814;--btn-sec:#2e241e;--btn-sec-h:#382c24;--btn-sec-p:#42342a;--btn-sec-fg:#f4ede6;--btn-ter-h:#2a211b;--btn-ter-p:#342920;--btn-ter-fg:#d8ccc1;--btn-dis:#281f1a;--btn-dis-fg:#66584d;--tone-gray-tint:rgba(214,196,180,.13);--tone-gray-fg:#c4b6aa;--tone-gray-solid:#8f8074;--status-draft-bg:rgba(214,196,180,.13);--status-draft-fg:#c4b6aa;--status-notstarted-bg:rgba(214,196,180,.13);--status-notstarted-fg:#c4b6aa;--doctype-fg:#c4b6aa;--doctype-ring:#4a3c32;--fld-bg:#241c17;--fld-bd:#45372e;--fld-fill:#2a211b;--fld-txt:#f4ede6;--fld-mut:#a5978b;--ctl-off:#54463b;--menu-bg:#241c17;--menu-bd:#3a2e26;--menu-hov:#2e241e;--surface-card:#1f1814;--surface-page:#16110e;--surface-board:#16110e;--surface-subtle:#241c17;--border-default:#4a3c32;--border-subtle:#3a2e26;--text-heading:#f4ede6;--text-body:#d8ccc1;--text-muted:#a5978b}\nhtml .rs.theme-dark{--sb-bg:#110d0a;--sb-bd:#2a211b;--sb-fg:#e6dcd2;--sb-ic:#a5978b;--sb-lbl:#85776b;--sb-hov:rgba(255,236,220,.06);--sb-press:rgba(255,236,220,.10);--sb-act:rgba(248,85,47,.20);--sb-card:#1f1814;--sb-div:#2a211b}\nhtml .rs.theme-dark .lang button.on,html .rs.theme-dark .chipf.on{background:#f4ede6;color:#16110e}\nbody[style*="0f1524"],body[style*="15, 21, 36"]{background:#16110e!important}' + (b === 'br' ? '\n:root{--ui-canvas:#fdf9f5;--ui-surface:#fffbf9;--ui-surface-2:#fdf1eb;--ui-hover:#fcece4;--ui-press:#f9e1d6;--ui-border:#f3e0d6;--ui-border-2:#f7e9e2;--ui-border-strong:#ebcfc1;--ui-muted:#7d6a60;--ui-faint:#ab968a;--btn-sec:#fbeae2;--btn-sec-h:#f7ddd1;--btn-sec-p:#f2cfbf;--btn-ter-h:#fbeae2;--btn-dis:#faeee8;--fld-bg:#ffffff;--fld-fill:#fdf1eb;--fld-bd:#ebd3c6;--menu-bd:#f0dccf;--menu-hov:#fcece4;--tone-gray-tint:#f8e9e1;--tone-gray-fg:#7d6358;--doctype-ring:#ebcfc1;--ctl-off:#e3c9bc}\nhtml .rs:not(.light):not(.theme-dark){--sb-bg:#2c1711;--sb-bd:#3b2018;--sb-fg:#f1dfd6;--sb-ic:#c29a8a;--sb-lbl:#a07b6c;--sb-hov:rgba(255,200,180,.07);--sb-press:rgba(255,200,180,.12);--sb-act:rgba(249,87,56,.24);--sb-card:#3a2019;--sb-div:#43261d}\nhtml .rs:not(.theme-dark) .hd,html .rs:not(.theme-dark) .tabs{background:#fff3ee;border-color:#f3dcd1}html .rs:not(.theme-dark) .srch{background:#fffbf9;border-color:#f0d8cc}\nhtml .rs:not(.theme-dark) .kc,html .rs:not(.theme-dark) .skc{background:#ffffff}\nhtml .theme-dark{--ui-canvas:#150e0b;--ui-surface:#1f1410;--ui-surface-2:#261914;--ui-border:#3d2820;--ui-border-2:#301f19;--ui-hover:#2a1b15;--ui-press:#34221a}html .rs.theme-dark{--sb-bg:#1a0e0a;--sb-div:#2e1b14;--sb-card:#261713}html .rs.theme-dark .hd,html .rs.theme-dark .tabs{background:#221612}' : '') + (b === 'inv' ? '\n:root{--ui-canvas:#ffffff;--ui-surface:#fdf9f5;--ui-surface-2:#f8f1ea;--ui-hover:#f5ece3;--ui-press:#efe4d9;--ui-border:#ebe0d5;--ui-border-2:#f0e7de;--ui-border-strong:#dfd2c5;--btn-sec:#f3eae1;--btn-sec-h:#ebe0d5;--btn-ter-h:#f3eae1;--fld-bg:#ffffff;--fld-fill:#f8f1ea;--tone-gray-tint:#f1e7dd}\nhtml .rs:not(.theme-dark) .kc,html .rs:not(.theme-dark) .skc{background:#ffffff}\nhtml .rs:not(.theme-dark) .srch{background:#ffffff;border-color:#ebe0d5}' : '');
  document.head.appendChild(st);
})();
// Rabaed SaaS shell — data, i18n and renderers. Exposes window.RS.
(function () {
  const I = {
    en: {
      ws: 'Rabaed',
      wsSub: 'Construction SaaS',
      modules: 'Modules',
      company: 'My Company',
      companyNote: 'General — applies to all modules',
      home: 'Home',
      projects: 'Projects',
      payments: 'Payment Requests',
      map: 'Map View',
      myCompany: 'My Company',
      profile: 'Company Profile',
      roles: 'Roles',
      join: 'Request To Join',
      users: 'Users',
      subs: 'Subscription Management',
      search: 'Search',
      searchPh: 'Search pages, projects, submittals…',
      collapse: 'Collapse sidebar',
      expand: 'Expand sidebar',
      switchWs: 'Switch workspace',
      addWs: 'Add workspace',
      roleAs: 'Your role in this project',
      profileM: 'My profile',
      account: 'Account settings',
      theme: 'Sidebar theme',
      language: 'Language',
      appearance: 'Appearance',
      dark: 'Dark',
      light: 'Light',
      signout: 'Sign out',
      help: 'Help & support',
      pages: 'Pages',
      projectsG: 'Projects',
      subsG: 'Submittals',
      noRes: 'No results',
      nav: 'to navigate',
      open: 'to open',
      close: 'to close',
      tabs: ['Overview', 'Submittals', 'Packages', 'Reports', 'Snag List', 'Approved Suppliers', 'Files', 'Activity', 'Settings', 'Multiple View'],
      mv: {
        floor: 'Floor View',
        map: 'Map View',
        plan: 'Plan View'
      },
      roleList: ['Contractor Engineer', 'Contractor Project Manager', 'Consultant', 'Client Representative']
    },
    ar: {
      ws: 'ربائد',
      wsSub: 'منصة إدارة البناء',
      modules: 'الوحدات',
      company: 'شركتي',
      companyNote: 'عام — ينطبق على جميع الوحدات',
      home: 'الرئيسية',
      projects: 'المشاريع',
      payments: 'طلبات الدفع',
      map: 'عرض الخريطة',
      myCompany: 'شركتي',
      profile: 'ملف الشركة',
      roles: 'الأدوار',
      join: 'طلبات الانضمام',
      users: 'المستخدمون',
      subs: 'إدارة الاشتراك',
      search: 'بحث',
      searchPh: 'ابحث في الصفحات والمشاريع والتقديمات…',
      collapse: 'طي الشريط الجانبي',
      expand: 'توسيع الشريط الجانبي',
      switchWs: 'تبديل مساحة العمل',
      addWs: 'إضافة مساحة عمل',
      roleAs: 'دورك في هذا المشروع',
      profileM: 'ملفي الشخصي',
      account: 'إعدادات الحساب',
      theme: 'مظهر الشريط الجانبي',
      language: 'اللغة',
      appearance: 'المظهر',
      dark: 'داكن',
      light: 'فاتح',
      signout: 'تسجيل الخروج',
      help: 'المساعدة والدعم',
      pages: 'الصفحات',
      projectsG: 'المشاريع',
      subsG: 'التقديمات',
      noRes: 'لا توجد نتائج',
      nav: 'للتنقل',
      open: 'للفتح',
      close: 'للإغلاق',
      tabs: ['نظرة عامة', 'التقديمات', 'الحزم', 'التقارير', 'قائمة الملاحظات', 'الموردون المعتمدون', 'الملفات', 'النشاط', 'الإعدادات', 'عروض متعددة'],
      mv: {
        floor: 'عرض الطوابق',
        map: 'عرض الخريطة',
        plan: 'عرض المخطط'
      },
      roleList: ['مهندس المقاول', 'مدير مشروع المقاول', 'الاستشاري', 'ممثل المالك']
    }
  };
  const TAB_IC = ['ti-calendar', '', '', '', '', '', '', '', 'ti-settings'];
  const MODULES = [{
    id: 'home',
    ic: 'ti-home'
  }, {
    id: 'projects',
    ic: 'ti-buildings'
  }, {
    id: 'payments',
    ic: 'ti-clipboard-list'
  }];
  const COMPANY = [{
    id: 'profile',
    ic: 'ti-building'
  }, {
    id: 'roles',
    ic: 'ti-shield'
  }, {
    id: 'join',
    ic: 'ti-user-plus',
    badge: 'join'
  }, {
    id: 'users',
    ic: 'ti-users'
  }, {
    id: 'subs',
    ic: 'ti-settings'
  }];
  const WS = [{
    n: 'Al Futtaim Construction Co.',
    a: 'شركة الفطيم للمقاولات',
    c: '#f8552f'
  }, {
    n: 'Arabtec Holding',
    a: 'أرابتك القابضة',
    c: '#3d6db5'
  }, {
    n: 'ALEC Engineering',
    a: 'ألك للهندسة',
    c: '#1fae66'
  }];
  const S = {
    mode: 'light',
    lang: 'en',
    col: false,
    theme: 'dark',
    page: 'home',
    project: null,
    tab: 0,
    role: 0,
    open: {
      company: true
    },
    menu: null,
    pal: false,
    palQ: '',
    palSel: 0,
    joinCount: 5,
    ws: 0
  };
  const t = k => I[S.lang][k];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const ini = n => n.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const av = (n, c, s) => `<span class="av" style="width:${s}px;height:${s}px;font-size:${Math.round(s * .38)}px;background:${c}">${ini(n)}</span>`;
  function item(it, st, sub) {
    const on = st.page === it.id && !st.project;
    const b = it.badge === 'join' && st.joinCount ? `<span class="bd">${st.joinCount}</span>` : '';
    return `<button class="it${on ? ' on' : ''}" data-nav="${it.id}"><i class="ti ${it.ic}"></i><span class="lb">${t(it.id)}</span>${b}<span class="tip">${t(it.id)}</span></button>`;
  }
  function sidebar(st) {
    st = st || S;
    const ws = WS[st.ws];
    const inCo = COMPANY.some(c => c.id === st.page);
    return `<aside class="sb">
 <div class="sb-ws"><button class="ws-btn" data-menu="ws"><span class="ws-mark"><img src="${window.__resources && window.__resources.markSvg || RS.base + 'assets/brand/rabaed-mark.svg'}" alt=""></span><span class="ws-tx"><b>${t('ws')}</b><small>${esc(st.lang === 'ar' ? ws.a : ws.n)}</small></span><i class="ti ti-arrows-sort"></i></button>${st.menu === 'ws' ? wsMenu(st) : ''}</div>
 <nav class="sb-nav">
  <div class="sb-lbl">${t('modules')}</div>
  ${MODULES.map(m => item(m, st)).join('')}
  <div class="sb-div"></div>
  <div class="sb-lbl" title="${t('companyNote')}">${t('company')}</div>
  <div class="grp${st.open.company ? ' open' : ''}">
   <button class="it${inCo && st.col ? ' on' : ''}" data-toggle="company"><i class="ti ti-building-skyscraper"></i><span class="lb">${t('myCompany')}</span>${st.joinCount && !st.open.company ? `<span class="bd">${st.joinCount}</span>` : ''}<i class="ti ti-chevron-down chev"></i></button>
   <div class="sub">${COMPANY.map(c => item(c, st, 1)).join('')}</div>
   <div class="fly"><h6>${t('myCompany')}</h6>${COMPANY.map(c => `<button data-nav="${c.id}" class="${st.page === c.id ? 'on' : ''}"><i class="ti ${c.ic}"></i>${t(c.id)}${c.badge && st.joinCount ? `<span class="bd">${st.joinCount}</span>` : ''}</button>`).join('')}</div>
  </div>
 </nav>
 <div class="sb-ft"><div class="uc">${av('Mohamed', '#6b5ad8', 38)}<div class="uc-tx"><b>Mohamed</b><small>${t('roleList')[st.role]}</small></div><button class="cbtn" data-act="collapse" title="${st.col ? t('expand') : t('collapse')}"><i class="ti ti-chevron-left"></i></button></div></div>
 </aside>`;
  }
  function wsMenu(st) {
    return `<div class="menu start" style="top:calc(100% - 6px);inset-inline-start:14px;width:250px"><h6>${t('switchWs')}</h6>${WS.map((w, i) => `<button class="mi${i === st.ws ? ' on' : ''}" data-ws="${i}"><span class="av" style="width:26px;height:26px;border-radius:7px;font-size:11px;background:${w.c}">${ini(w.n)}</span>${esc(st.lang === 'ar' ? w.a : w.n)}${i === st.ws ? '<i class="ti ti-check ck"></i>' : ''}</button>`).join('')}<div class="sep"></div><button class="mi"><i class="ti ti-plus"></i>${t('addWs')}</button></div>`;
  }
  function header(st, ctx) {
    st = st || S;
    ctx = ctx || {};
    const title = ctx.project ? `<button class="hd-back" data-act="back"><i class="ti ti-arrow-left"></i></button><span class="hd-pav">${ctx.project.l}</span><div class="hd-tt"><b>${esc(ctx.project.n)}</b><small>${esc(ctx.project.c)}</small></div>` : `<div class="hd-tt"><b>${esc(ctx.title || '')}</b><small>${esc(ctx.sub || '')}</small></div>`;
    return `<header class="hd">${title}<div class="hd-sp"></div>
  <button class="srch" data-act="pal"><i class="ti ti-search"></i><span>${t('search')}</span><kbd>⌘K</kbd></button>
  ${ctx.project ? `<span class="role-tag" title="${t('roleAs')}"><i class="ti ti-user-circle"></i>${t('roleList')[st.role]}</span>` : ''}
  <div class="lang mode" title="${t('appearance')}"><button class="${st.mode !== 'dark' ? 'on' : ''}" data-mode="light">${t('light')}</button><button class="${st.mode === 'dark' ? 'on' : ''}" data-mode="dark">${t('dark')}</button></div>
  <button class="bell"><i class="ti ti-bell"></i></button>
  <div class="me"><button class="me-btn" data-menu="me">${av('Mohamed', '#6b5ad8', 36)}<span class="nm">Mohamed</span><i class="ti ti-chevron-down"></i></button>${st.menu === 'me' ? meMenu(st) : ''}</div>
 </header>`;
  }
  function meMenu(st) {
    return `<div class="menu" style="width:260px"><div class="mhd">${av('Mohamed', '#6b5ad8', 40)}<div><b>Mohamed Al Hashimi</b><small>mohamed@alfuttaim.ae</small></div></div><div class="sep"></div>
 <button class="mi"><i class="ti ti-user"></i>${t('profileM')}</button><button class="mi"><i class="ti ti-settings"></i>${t('account')}</button><button class="mi"><i class="ti ti-help-circle"></i>${t('help')}</button>
 <div class="sep"></div><h6>${t('language')}</h6><div class="seg2"><button class="${st.lang === 'ar' ? 'on' : ''}" data-lang="ar">عربي</button><button class="${st.lang === 'en' ? 'on' : ''}" data-lang="en">English</button></div><h6>${t('appearance')}</h6><div class="seg2"><button class="${st.mode !== 'dark' ? 'on' : ''}" data-mode="light">${t('light')}</button><button class="${st.mode === 'dark' ? 'on' : ''}" data-mode="dark">${t('dark')}</button></div>${st.mode === 'dark' ? '' : `<h6>${t('theme')}</h6>`}${st.mode === 'dark' ? '' : `<div class="seg2"><button class="${st.theme === 'dark' ? 'on' : ''}" data-theme="dark">${t('dark')}</button><button class="${st.theme === 'light' ? 'on' : ''}" data-theme="light">${t('light')}</button></div>`}
 <div class="sep"></div><button class="mi danger"><i class="ti ti-logout"></i>${t('signout')}</button></div>`;
  }
  const TAB_ORDER = [0, 9, 1, 2, 3, 4, 6, 8];
  const MV = [['floor', 'ti-stairs'], ['map', 'ti-map'], ['plan', 'ti-vector']];
  function tabs(st) {
    st = st || S;
    const T = t('tabs'),
      mv = t('mv');
    const html = TAB_ORDER.map(i => i === 9 ? `<button class="tab tab-mv${st.tab === 9 ? ' on' : ''}" data-menu="mv">${T[9]}${st.tab === 9 && st.mv ? `<span class="tab-sub">· ${mv[st.mv]}</span>` : ''}<i class="ti ti-chevron-down" style="font-size:15px"></i></button>` : i === 3 ? `<a class="tab${i === st.tab ? ' on' : ''}" href="reports.html" style="text-decoration:none">${T[i]}</a>` : i === 4 ? `<a class="tab${i === st.tab ? ' on' : ''}" href="snag-list.html" style="text-decoration:none">${T[i]}</a>` : `<button class="tab${i === st.tab ? ' on' : ''}" data-tab="${i}">${TAB_IC[i] ? `<i class="ti ${TAB_IC[i]}"></i>` : ''}${T[i]}</button>`).join('');
    const menu = st.menu === 'mv' ? `<div class="menu mvmenu" id="mvmenu"><h6>${T[9]}</h6>${MV.map(([k, ic]) => `<a class="mi${st.tab === 9 && st.mv === k ? ' on' : ''}" href="${{
      floor: 'floor-view.html',
      map: 'map-view.html',
      plan: 'plan-view.html'
    }[k]}"><i class="ti ${ic}"></i>${mv[k]}${st.tab === 9 && st.mv === k ? '<i class="ti ti-check ck"></i>' : ''}</a>`).join('')}</div>` : '';
    if (menu) setTimeout(() => {
      const b = document.querySelector('[data-menu=mv]'),
        m = document.getElementById('mvmenu');
      if (!b || !m) return;
      const r = b.getBoundingClientRect();
      m.style.top = r.bottom + 6 + 'px';
      if (document.documentElement.dir === 'rtl') {
        m.style.right = innerWidth - r.right + 'px';
        m.style.left = 'auto';
      } else {
        m.style.left = r.left + 'px';
        m.style.right = 'auto';
      }
    }, 0);
    return `<div class="tabs">${html}</div>${menu}`;
  }
  window.RS = {
    I,
    S,
    t,
    esc,
    ini,
    av,
    MODULES,
    COMPANY,
    WS,
    sidebar,
    header,
    tabs,
    base: '../../'
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/shell/shell.js", error: String((e && e.message) || e) }); }

// ui_kits/app/snag/data.js
try { (() => {
// Snag List — sample data. Exposes window.SD.
(function () {
  const STG = {
    open: {
      en: 'Open',
      ar: 'مفتوح',
      tone: 'orange'
    },
    prog: {
      en: 'In Progress',
      ar: 'قيد التنفيذ',
      tone: 'blue'
    },
    hold: {
      en: 'On Hold',
      ar: 'معلّق',
      tone: 'gray'
    },
    res: {
      en: 'Resolved',
      ar: 'تم الحل',
      tone: 'violet'
    },
    closed: {
      en: 'Closed',
      ar: 'مغلق',
      tone: 'green'
    }
  };
  const SORDER = ['open', 'prog', 'hold', 'res', 'closed'];
  const TYP = {
    snag: {
      en: 'Snag',
      ar: 'ملاحظة',
      pl: ['Snags', 'الملاحظات'],
      ic: 'ti-alert-triangle',
      tone: 'red',
      code: 'SNG'
    },
    cmt: {
      en: 'Comment',
      ar: 'تعليق',
      pl: ['Comments', 'التعليقات'],
      ic: 'ti-message-circle',
      tone: 'blue',
      code: 'CMT'
    },
    qst: {
      en: 'Question',
      ar: 'سؤال',
      pl: ['Questions', 'الأسئلة'],
      ic: 'ti-help-circle',
      tone: 'violet',
      code: 'QST'
    }
  };
  const TR = {
    EL: ['Electrical', 'كهرباء', 'cyan'],
    AR: ['Finishes', 'تشطيبات', 'violet'],
    FS: ['Firestopping', 'عزل الحريق', 'orange'],
    PL: ['Plumbing', 'سباكة', 'blue'],
    CV: ['Civil', 'مدني', 'amber']
  };
  const CO = {
    tmc: ['TMC Constructions', 'تي إم سي للمقاولات', '#f8552f', 'TMC', 'Contractor', 'مقاول'],
    gdl: ['Gulf Dryliners', 'الخليج للألواح الجافة', '#7a5af0', 'GDL', 'Subcontractor · TMC', 'مقاول باطن · TMC'],
    fss: ['FireSafe Systems', 'فاير سيف للأنظمة', '#e98b45', 'FSS', 'Contractor', 'مقاول'],
    dcl: ['Design Consultants LLC', 'ديزاين للاستشارات', '#3d6db5', 'DCL', 'Consultant', 'استشاري']
  };
  const PPL = {
    nasser: ['Nasser Al Kaabi', 'ناصر الكعبي', 'tmc', '#e98b45'],
    ahmed: ['Ahmed bin Said', 'أحمد بن سعيد', 'tmc', '#3d6db5'],
    omar: ['Omar Al Blooshi', 'عمر البلوشي', 'gdl', '#1fae66'],
    khalid: ['Khalid Al Dhaheri', 'خالد الظاهري', 'fss', '#6b5ad8'],
    shamsi: ['Mohammed Al Shamsi', 'محمد الشامسي', 'dcl', '#b5455a'],
    sara: ['Sara Al Mansoori', 'سارة المنصوري', 'dcl', '#7a5c3a']
  };
  const ROLES = {
    tmc: {
      en: 'Contractor · TMC Constructions',
      ar: 'مقاول · تي إم سي',
      co: 'tmc',
      me: 'nasser',
      sees: ['tmc', 'gdl'],
      can: ['start', 'hold', 'resolve']
    },
    dcl: {
      en: 'Consultant · Design Consultants',
      ar: 'استشاري · ديزاين',
      co: 'dcl',
      me: 'shamsi',
      sees: null,
      can: ['close', 'reopen', 'hold']
    },
    admin: {
      en: 'Project Admin',
      ar: 'مسؤول المشروع',
      co: 'dcl',
      me: 'sara',
      sees: null,
      can: ['start', 'hold', 'resolve', 'close', 'reopen']
    }
  };
  const LOCS = {
    '02': ['Floor 02', 'الطابق ٠٢'],
    '01': ['Floor 01', 'الطابق ٠١'],
    '03': ['Floor 03', 'الطابق ٠٣'],
    gf: ['Ground Floor', 'الطابق الأرضي'],
    rf: ['Roof', 'السطح']
  };
  const SPACES = [['Riser 01', 'الرايزر ٠١'], ['Corridor', 'الممر'], ['Apt 201', 'شقة 201'], ['Apt 203', 'شقة 203'], ['Lift lobby', 'بهو المصاعد'], ['Plant room', 'غرفة المعدات'], ['Apt 105', 'شقة 105']];
  const SRC = {
    mar041: {
      kind: 'sub',
      no: 'TWR-TMC-EL-MAR-041',
      t: ['Lighting Fixtures', 'وحدات الإنارة'],
      code: 'B',
      by: 'shamsi'
    },
    sar012: {
      kind: 'sub',
      no: 'TWR-TMC-EL-SAR-012',
      t: ['Cable Containment Shop Drawing', 'مخطط حوامل الكابلات'],
      code: 'B',
      by: 'sara'
    },
    mar038: {
      kind: 'sub',
      no: 'TWR-GDL-AR-MAR-038',
      t: ['Gypsum Board System', 'نظام ألواح الجبس'],
      code: 'C',
      by: 'shamsi'
    },
    ir045: {
      kind: 'insp',
      no: 'TWR-TMC-EL-IR-045',
      t: ['First-fix electrical — Floor 02', 'التمديدات الكهربائية الأولى — الطابق ٠٢'],
      failed: ['Earthing continuity', 'استمرارية التأريض'],
      by: 'sara'
    },
    ir051: {
      kind: 'insp',
      no: 'TWR-GDL-AR-IR-051',
      t: ['Ceiling boarding — Floor 01', 'ألواح السقف — الطابق ٠١'],
      failed: ['Board fixing centres', 'مسافات تثبيت الألواح'],
      by: 'shamsi'
    },
    dsr: {
      kind: 'dsr',
      no: 'DSR-2026-09-18',
      t: ['Daily Site Report · 18 Sep', 'تقرير الموقع اليومي · 18 سبتمبر'],
      by: 'sara'
    }
  };
  const I = [];
  let n = 0;
  const add = o => {
    n++;
    I.push(Object.assign({
      id: 's' + n,
      photos: 0,
      after: null,
      pin: null,
      chat: [],
      internal: [],
      d: n
    }, o));
  };
  // comments from MAR-041 (5: 3 closed)
  add({
    no: 'TWR-DCL-EL-CMT-003',
    type: 'cmt',
    t: ['Provide IP65 certificate for corridor fittings', 'تقديم شهادة IP65 لوحدات إنارة الممر'],
    q: ['Corridor fittings must be IP65 — submit the test certificate from the manufacturer.', 'يجب أن تكون وحدات الممر بدرجة IP65 — قدّم شهادة الاختبار من المصنّع.'],
    tr: 'EL',
    f: '02',
    sp: 1,
    co: 'tmc',
    who: 'nasser',
    stage: 'res',
    wk: 1,
    src: 'mar041',
    after: {
      note: ['IP65 certificate from Thorn uploaded (ref TH-IP65-2291).', 'تم رفع شهادة IP65 من Thorn (مرجع TH-IP65-2291).'],
      photos: 0,
      files: 1
    }
  });
  add({
    no: 'TWR-DCL-EL-CMT-004',
    type: 'cmt',
    t: ['Update luminaire schedule to Rev C', 'تحديث جدول وحدات الإنارة إلى Rev C'],
    q: ['Schedule still shows Rev B fittings for Level 02. Update to the Rev C lighting layout.', 'لا يزال الجدول يعرض وحدات Rev B للطابق ٠٢. حدّثه وفق مخطط الإنارة Rev C.'],
    tr: 'EL',
    f: '02',
    sp: 1,
    co: 'tmc',
    who: 'ahmed',
    stage: 'open',
    wk: 2,
    src: 'mar041'
  });
  add({
    no: 'TWR-DCL-EL-CMT-005',
    type: 'cmt',
    t: ['Confirm emergency lighting duration (3h)', 'تأكيد مدة إنارة الطوارئ (3 ساعات)'],
    q: ['Confirm emergency packs provide 3 hours duration per NFPA 101.', 'أكّد أن وحدات الطوارئ توفر 3 ساعات وفق NFPA 101.'],
    tr: 'EL',
    f: '02',
    sp: 4,
    co: 'tmc',
    who: 'nasser',
    stage: 'closed',
    wk: 1,
    src: 'mar041'
  });
  add({
    no: 'TWR-DCL-EL-CMT-006',
    type: 'cmt',
    t: ['Add photometric calc for lift lobby', 'إضافة حساب الإضاءة لبهو المصاعد'],
    q: ['Provide photometric calculation showing 200 lux at lift lobby floor level.', 'قدّم حساب الإضاءة الذي يبيّن 200 لوكس عند أرضية بهو المصاعد.'],
    tr: 'EL',
    f: '02',
    sp: 4,
    co: 'tmc',
    who: 'ahmed',
    stage: 'closed',
    wk: 1,
    src: 'mar041'
  });
  add({
    no: 'TWR-DCL-EL-CMT-007',
    type: 'cmt',
    t: ['Match finish colour to ID sample', 'مطابقة لون التشطيب لعينة التصميم الداخلي'],
    q: ['Trim finish to match approved ID sample RAL 9003.', 'يجب أن يطابق لون الإطار عينة التصميم المعتمدة RAL 9003.'],
    tr: 'EL',
    f: '02',
    sp: 2,
    co: 'tmc',
    who: 'nasser',
    stage: 'closed',
    wk: 1,
    src: 'mar041'
  });
  // named snags
  add({
    no: 'TWR-TMC-EL-SNG-014',
    type: 'snag',
    t: ['Cable tray not bonded', 'حامل الكابلات غير موصول بالتأريض'],
    desc: ['Bonding jumpers missing across 3 tray joints in Riser 01 between L02 and L03. Earth continuity test failed at 1.8 Ω.', 'وصلات التأريض مفقودة عبر 3 وصلات للحامل في الرايزر ٠١ بين الطابقين ٠٢ و٠٣. رسب اختبار الاستمرارية عند 1.8 أوم.'],
    tr: 'EL',
    f: '02',
    sp: 0,
    co: 'tmc',
    who: 'nasser',
    stage: 'open',
    wk: 3,
    photos: 2,
    src: 'ir045',
    pin: [712, 520]
  });
  add({
    no: 'TWR-GDL-AR-SNG-015',
    type: 'snag',
    t: ['Ceiling plasterboard – rework needed', 'ألواح الجبس في السقف – تتطلب إعادة عمل'],
    desc: ['Joints cracked along the corridor; boards fixed at 600 mm centres instead of 400 mm.', 'تشققات في الوصلات على طول الممر؛ الألواح مثبتة على 600 مم بدلًا من 400 مم.'],
    tr: 'AR',
    f: '01',
    sp: 1,
    co: 'gdl',
    who: 'omar',
    stage: 'prog',
    wk: 2,
    photos: 3,
    src: 'ir051',
    pin: [520, 400]
  });
  add({
    no: 'TWR-FSS-FS-SNG-016',
    type: 'snag',
    t: ['SVP firestopping – potential rework', 'عزل حريق أنبوب الصرف – قد يتطلب إعادة عمل'],
    desc: ['Collar looks undersized for 110 mm SVP. Waiting for manufacturer data before re-work.', 'الطوق يبدو أصغر من المطلوب لأنبوب 110 مم. بانتظار بيانات المصنّع قبل إعادة العمل.'],
    tr: 'FS',
    f: '02',
    sp: 0,
    co: 'fss',
    who: 'khalid',
    stage: 'hold',
    wk: 1,
    photos: 1,
    src: 'dsr',
    pin: [730, 560]
  });
  // more comments
  add({
    no: 'TWR-DCL-EL-CMT-008',
    type: 'cmt',
    t: ['Show tray separation from LV cables', 'توضيح فصل الحوامل عن كابلات الجهد المنخفض'],
    q: ['Section C–C: show 300 mm separation between power and data trays.', 'المقطع C–C: وضّح مسافة 300 مم بين حوامل الطاقة والبيانات.'],
    tr: 'EL',
    f: '03',
    sp: 1,
    co: 'tmc',
    who: 'nasser',
    stage: 'prog',
    wk: 1,
    src: 'sar012'
  });
  add({
    no: 'TWR-DCL-EL-CMT-009',
    type: 'cmt',
    t: ['Add support details at riser penetrations', 'إضافة تفاصيل الدعامات عند اختراقات الرايزر'],
    q: ['Provide support detail where trays pass through riser slab openings.', 'قدّم تفصيلة الدعم عند مرور الحوامل عبر فتحات بلاطة الرايزر.'],
    tr: 'EL',
    f: '03',
    sp: 0,
    co: 'tmc',
    who: 'ahmed',
    stage: 'open',
    wk: 4,
    src: 'sar012'
  });
  add({
    no: 'TWR-DCL-AR-CMT-010',
    type: 'cmt',
    t: ['Acoustic rating missing for party walls', 'تصنيف العزل الصوتي مفقود للجدران الفاصلة'],
    q: ['Party wall system must achieve Rw 55 — provide test report.', 'يجب أن يحقق نظام الجدار الفاصل Rw 55 — قدّم تقرير الاختبار.'],
    tr: 'AR',
    f: '01',
    sp: 6,
    co: 'gdl',
    who: 'omar',
    stage: 'open',
    wk: 2,
    src: 'mar038'
  });
  add({
    no: 'TWR-DCL-AR-CMT-011',
    type: 'cmt',
    t: ['Moisture-resistant board in wet areas', 'ألواح مقاومة للرطوبة في المناطق الرطبة'],
    q: ['Use MR board in all bathrooms and kitchens.', 'استخدم ألواح MR في جميع الحمامات والمطابخ.'],
    tr: 'AR',
    f: '01',
    sp: 6,
    co: 'gdl',
    who: 'omar',
    stage: 'res',
    wk: 1,
    src: 'mar038',
    after: {
      note: ['Board schedule updated — MR board for all wet areas.', 'تم تحديث جدول الألواح — ألواح MR لكل المناطق الرطبة.'],
      photos: 0,
      files: 1
    }
  });
  // questions
  add({
    no: 'TWR-TMC-EL-QST-002',
    type: 'qst',
    t: ['Socket height in kitchens — 1100 or 1200?', 'ارتفاع المقابس في المطابخ — 1100 أم 1200؟'],
    desc: ['ID drawing shows 1100 mm, MEP drawing 1200 mm. Please confirm.', 'يبين مخطط التصميم الداخلي 1100 مم ومخطط الكهروميكانيك 1200 مم. يرجى التأكيد.'],
    tr: 'EL',
    f: '02',
    sp: 2,
    co: 'tmc',
    who: 'ahmed',
    stage: 'open',
    wk: 1,
    src: null
  });
  add({
    no: 'TWR-FSS-FS-QST-001',
    type: 'qst',
    t: ['Approved sealant for PVC pipes?', 'المانع المعتمد لأنابيب PVC؟'],
    desc: ['Which sealant brand is approved for PVC penetrations at L02?', 'ما نوع المانع المعتمد لاختراقات PVC في الطابق ٠٢؟'],
    tr: 'FS',
    f: '02',
    sp: 0,
    co: 'fss',
    who: 'khalid',
    stage: 'prog',
    wk: 1,
    src: null
  });
  // generated snags
  const G = [['EL', 'Socket outlet loose', 'مقبس كهربائي غير مثبت', 'tmc', 'nasser'], ['EL', 'Missing cable labels', 'ملصقات الكابلات مفقودة', 'tmc', 'ahmed'], ['EL', 'Light fitting misaligned', 'وحدة إنارة غير مستقيمة', 'tmc', 'nasser'], ['AR', 'Paint drips on skirting', 'قطرات دهان على النعلة', 'gdl', 'omar'], ['AR', 'Door frame out of plumb', 'إطار الباب غير رأسي', 'gdl', 'omar'], ['PL', 'Leak at WC connector', 'تسرب عند وصلة المرحاض', 'tmc', 'ahmed'], ['FS', 'Firestopping incomplete at riser', 'عزل الحريق غير مكتمل عند الرايزر', 'fss', 'khalid'], ['EL', 'Conduit not capped', 'أنبوب التمديد غير مغلق', 'tmc', 'nasser'], ['AR', 'Tile lippage over 2 mm', 'بروز البلاط أكثر من 2 مم', 'gdl', 'omar'], ['CV', 'Honeycomb at column base', 'تعشيش عند قاعدة العمود', 'tmc', 'ahmed'], ['EL', 'DB door does not close', 'باب لوحة التوزيع لا يغلق', 'tmc', 'nasser'], ['AR', 'Ceiling access panel missing', 'لوحة وصول السقف مفقودة', 'gdl', 'omar'], ['FS', 'Fire damper access blocked', 'الوصول لمخمد الحريق مسدود', 'fss', 'khalid'], ['PL', 'Floor drain level wrong', 'منسوب مصرف الأرضية خاطئ', 'tmc', 'ahmed'], ['EL', 'Earth bar not labelled', 'قضيب التأريض غير مُعلَّم', 'tmc', 'nasser'], ['AR', 'Scratched glazing — Apt 203', 'خدش في الزجاج — شقة 203', 'gdl', 'omar'], ['CV', 'Slab edge spalling', 'تقشر حافة البلاطة', 'tmc', 'ahmed']];
  const st = ['open', 'open', 'prog', 'open', 'res', 'closed', 'open', 'prog', 'hold', 'open', 'closed', 'prog', 'open', 'res', 'open', 'open', 'closed'];
  const fls = ['02', '02', '01', '03', '01', '02', '02', 'gf', '01', 'rf', '02', '01', '03', '02', '02', '03', 'gf'];
  const seqs = {};
  G.forEach((g, i) => {
    const co = g[3],
      k = CO[co][3] + '-' + g[0];
    seqs[k] = (seqs[k] || 16) + 1 + i % 2;
    add({
      no: 'TWR-' + k + '-SNG-' + String(seqs[k]).padStart(3, '0'),
      type: 'snag',
      t: [g[1], g[2]],
      desc: [g[1] + '. Found during walkdown; fix and upload an after photo.', g[2] + '. تم رصدها أثناء الجولة؛ يرجى الإصلاح ورفع صورة بعد الإصلاح.'],
      tr: g[0],
      f: fls[i],
      sp: i % 7,
      co,
      who: g[4],
      stage: st[i],
      wk: 1 + i * 3 % 5,
      photos: i % 3 ? 1 + i % 3 : 0,
      src: i % 4 === 0 ? 'dsr' : null,
      pin: [160 + i * 97 % 880, 110 + i * 61 % 560],
      after: st[i] === 'res' ? {
        note: ['Fixed and re-checked on site.', 'تم الإصلاح وإعادة الفحص في الموقع.'],
        photos: 1
      } : null
    });
  });
  // sample chat + history for key items
  const H = it => {
    const base = [{
      a: 'create',
      by: it.src && SRC[it.src].kind === 'sub' ? SRC[it.src].by : it.src === 'ir045' || it.src === 'ir051' ? SRC[it.src].by : 'sara',
      w: it.wk + 1
    }];
    if (['prog', 'hold', 'res', 'closed'].includes(it.stage)) base.push({
      a: 'prog',
      by: it.who,
      w: it.wk + 0.5
    });
    if (it.stage === 'hold') base.push({
      a: 'hold',
      by: it.who,
      w: it.wk
    });
    if (['res', 'closed'].includes(it.stage)) base.push({
      a: 'res',
      by: it.who,
      w: it.wk
    });
    if (it.stage === 'closed') base.push({
      a: 'closed',
      by: 'shamsi',
      w: it.wk - 0.5
    });
    return base;
  };
  I.forEach(it => {
    it.hist = H(it);
  });
  I.find(x => x.no === 'TWR-TMC-EL-SNG-014').chat = [{
    by: 'sara',
    t: ['Earth continuity failed at 1.8 Ω on the L02–L03 run. Please add bonding jumpers at each joint.', 'رسب اختبار الاستمرارية عند 1.8 أوم على مسار ٠٢–٠٣. يرجى إضافة وصلات تأريض عند كل وصلة.'],
    w: 3
  }, {
    by: 'nasser',
    t: ['Noted — jumpers ordered, install planned for Sunday.', 'تمت الملاحظة — تم طلب الوصلات والتركيب مخطط يوم الأحد.'],
    w: 2
  }];
  I.find(x => x.no === 'TWR-TMC-EL-SNG-014').internal = [{
    by: 'ahmed',
    t: ['Charge the jumpers to the containment sub — their install.', 'تُحمّل تكلفة الوصلات على مقاول الحوامل — من تركيبهم.'],
    w: 2
  }];
  I.find(x => x.no === 'TWR-DCL-EL-CMT-004').chat = [{
    by: 'ahmed',
    t: ['Rev C schedule is with the supplier, expect it next week.', 'جدول Rev C لدى المورّد، متوقع الأسبوع القادم.'],
    w: 1
  }];
  window.SD = {
    STG,
    SORDER,
    TYP,
    TR,
    CO,
    PPL,
    ROLES,
    LOCS,
    SPACES,
    SRC,
    I
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/snag/data.js", error: String((e && e.message) || e) }); }

// ui_kits/app/snag/mobile.js
try { (() => {
// Snag List — mobile (one-handed).
(function () {
  const S = RS.S;
  try {
    Object.assign(S, JSON.parse(localStorage.getItem('rb-shell-v1') || '{}'));
  } catch (e) {}
  const {
    STG,
    SORDER,
    TYP,
    TR,
    CO,
    PPL,
    LOCS,
    SPACES,
    SRC,
    I
  } = SD;
  const {
    L,
    T,
    ty,
    stp,
    trc,
    cdb,
    age,
    av,
    loc,
    srcShort,
    visible,
    esc
  } = SN;
  const M = {
    scr: 'list',
    type: 'all',
    st: new Set(),
    mine: false,
    sheet: false,
    det: null,
    flow: null,
    toast: null,
    sw: null
  };
  const ROLE = 'tmc';
  const ls = () => I.filter(i => visible(i, ROLE) && (M.type === 'all' || i.type === M.type) && (!M.st.size || M.st.has(i.stage)) && (!M.mine || i.who === 'nasser')).sort((a, b) => SORDER.indexOf(a.stage) - SORDER.indexOf(b.stage) || b.wk - a.wk);
  const photo = (it, h) => `<div class="sm-ph" style="height:${h}px">${it.img ? `<img src="${it.img}" alt="">` : `<i class="ti ${it.photos ? 'ti-photo' : 'ti-photo-off'}"></i>${it.photos ? `<span>${it.photos}</span>` : ''}`}</div>`;
  function card(it) {
    const can = ['open', 'prog', 'hold'].includes(it.stage);
    return `<div class="sm-sw" data-sw="${it.id}">${can ? `<div class="sm-acts"><button data-mres="${it.id}" style="background:var(--tone-violet-solid)"><i class="ti ti-circle-check"></i>${L('Resolve', 'حل')}</button><button data-mhold="${it.id}" style="background:var(--tone-gray-solid)"><i class="ti ti-player-pause"></i>${L('Hold', 'تعليق')}</button></div>` : ''}<div class="sm-card" data-mopen="${it.id}" style="${M.sw === it.id ? 'transform:translateX(var(--swx))' : ''}">${photo(it, 86)}<div class="tx"><div class="r1"><i class="ti ${TYP[it.type].ic}" style="color:var(--tone-${TYP[it.type].tone}-solid)"></i><span class="num">${it.no.replace('TWR-', '')}</span></div><b>${T(it.t)}</b><div class="r2">${stp(it.stage)}${age(it.wk)}</div><small>${loc(it)}</small></div></div></div>`;
  }
  function list() {
    const a = ls();
    return `<div class="sm-hd"><button class="m-btn bk"><i class="ti ti-arrow-left"></i></button><div><b>${L('Snag List', 'قائمة الملاحظات')}</b><small>${L('Tower 1 · TMC Constructions', 'البرج ١ · تي إم سي')}</small></div><button class="m-btn" data-m="filters"><i class="ti ti-adjustments-horizontal"></i>${M.st.size + (M.mine ? 1 : 0) ? `<span class="n">${M.st.size + (M.mine ? 1 : 0)}</span>` : ''}</button></div>
 <div class="m-chips" style="padding-top:4px">${['all', 'snag', 'cmt', 'qst'].map(k => `<button class="m-chip${M.type === k ? ' on' : ''}" data-mt="${k}">${k === 'all' ? L('All', 'الكل') : `<i class="ti ${TYP[k].ic}"></i>${L(TYP[k].pl[0], TYP[k].pl[1])}`}</button>`).join('')}<button class="m-chip${M.mine ? ' on' : ''}" data-m="mine"><i class="ti ti-user-circle"></i>${L('Mine', 'لي')}</button></div>
 <div class="sm-hint"><i class="ti ti-arrow-back-up"></i>${L('Swipe a card to Resolve or Hold', 'اسحب البطاقة للحل أو التعليق')}</div>
 <div class="sm-list">${a.map(card).join('') || `<div class="empty2" style="border:0"><span class="ic"><i class="ti ti-circle-check"></i></span><h2>${L('No snags. Nice work.', 'لا توجد ملاحظات. عمل رائع.')}</h2></div>`}</div>
 <button class="m-fab" data-m="new" style="bottom:34px"><i class="ti ti-plus"></i></button>
 ${M.sheet ? `<div class="sm-scrim" data-m="closesheet"></div><div class="m-sheet" style="height:430px"><div class="m-grab" data-m="closesheet"><i></i></div><div class="m-sh-hd"><b>${L('Filters', 'التصفية')}</b></div><div class="m-body"><div class="m-fld"><label>${L('Stage', 'المرحلة')}</label><div class="m-tr">${SORDER.map(k => `<button class="${M.st.has(k) ? 'on' : ''}" data-mst="${k}"><i style="border-radius:50%;background:var(--tone-${STG[k].tone}-solid)"></i>${L(STG[k].en, STG[k].ar)}</button>`).join('')}</div></div><label style="display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;min-height:48px" data-m="mine"><span class="swc${M.mine ? ' on' : ''}" style="width:44px;height:26px;border-radius:13px"></span>${L('Assigned to me', 'مسند إليّ')}</label><button class="m-big pri" data-m="closesheet">${L(`Show ${a.length} items`, `عرض ${a.length} عنصر`)}</button></div></div>` : ''}`;
  }
  function detail() {
    const it = I.find(x => x.id === M.det);
    const s = it.src && SRC[it.src];
    const can = ['open', 'prog', 'hold'].includes(it.stage);
    return `<div class="sm-hd"><button class="m-btn bk" data-m="back"><i class="ti ti-arrow-left"></i></button><div><small class="num" style="font-weight:700">${it.no}</small></div><span></span></div><div class="sm-det">
 ${photo(it, 190)}<div class="row">${ty(it.type)}${stp(it.stage)}${age(it.wk, 1)}</div><h2>${T(it.t)}</h2>${it.desc ? `<p>${T(it.desc)}</p>` : ''}
 <div class="m-kv"><span>${L('Trade', 'التخصص')}</span><b>${trc(it.tr)}</b><span>${L('Location', 'الموقع')}</span><b>${loc(it)}</b><span>${L('Assigned', 'مسند')}</span><b>${av(it.who, 22)}${T(PPL[it.who])}</b></div>
 ${s ? `<div class="box" style="padding:12px"><h6><i class="ti ti-link"></i>${L('Raised from', 'المصدر')}</h6><div style="display:flex;align-items:center;gap:8px"><span class="num" style="font-size:12.5px;font-weight:700;color:var(--tone-blue-fg)">${srcShort(s)}</span><span style="flex:1;font-size:13.5px">${T(s.t)}</span>${s.code ? cdb(s.code) : ''}</div>${it.q ? `<blockquote class="quote">“${T(it.q)}”</blockquote>` : s.failed ? `<div class="failed"><i class="ti ti-x"></i>${T(s.failed)}</div>` : ''}</div>` : ''}
 ${it.after ? `<div class="fnote">${T(it.after.note)}</div>` : ''}</div>
 ${can ? `<div class="m-drop"><button class="m-big sec" data-mhold="${it.id}"><i class="ti ti-player-pause"></i></button><button class="m-big pri" data-mres="${it.id}" style="flex:1"><i class="ti ti-circle-check"></i>${L('Mark Resolved', 'تحديد كمحلول')}</button></div>` : `<div class="m-drop"><div class="m-big sec" style="flex:1;cursor:default">${it.stage === 'res' ? L('Waiting for consultant', 'بانتظار الاستشاري') : L('Closed', 'مغلقة')}</div></div>`}`;
  }
  const STEPS = ['cam', 'pin', 'title', 'assign'];
  function flow() {
    const f = M.flow,
      i = STEPS.indexOf(f.step);
    const dots = `<div class="sm-steps">${STEPS.map((s, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</div>`;
    const draft = `<span class="sm-draft"><i class="ti ti-check"></i>${L('Draft saved', 'تم حفظ المسودة')}</span>`;
    if (f.step === 'cam') return `<div class="m-cam"><div class="vf">${f.shot ? `<img src="${f.shot}" alt="">` : `<div class="grid"></div><div class="lbl"><i class="ti ti-camera"></i>${L('Point at the defect', 'وجّه الكاميرا نحو العيب')}</div>`}<div class="top"><button data-m="cancelflow"><i class="ti ti-x"></i></button><span>${L('New snag · 1 of 4', 'ملاحظة جديدة · 1 من 4')}</span><button><i class="ti ti-bolt"></i></button></div></div><div class="bar"><button data-m="lib"><span class="lib"><i class="ti ti-photo"></i></span>${L('Library', 'المعرض')}</button><button data-m="shoot"><span class="shut"></span></button><button data-m="next"><span class="lib"><i class="ti ti-arrow-right"></i></span>${f.shot ? L('Next', 'التالي') : L('Skip', 'تخطي')}</button></div></div>`;
    const hd = t => `<div class="sm-hd"><button class="m-btn bk" data-m="prev"><i class="ti ti-arrow-left"></i></button><div><b>${t}</b>${dots}</div>${draft}</div>`;
    if (f.step === 'pin') return `${hd(L('Where is it?', 'أين هي؟'))}<div class="sm-det"><div class="m-tr">${Object.keys(LOCS).map(k => `<button class="${f.f === k ? 'on' : ''}" data-mf="${k}">${L(LOCS[k][0], LOCS[k][1])}</button>`).join('')}</div><div class="sm-plan" data-mpin="1">${PD.drawing({
      no: 'A-102',
      en: 'Plan',
      rev: 'C',
      date: ''
    })}${f.pin ? `<span class="mp" style="left:${f.pin[0]}%;top:${f.pin[1]}%"></span>` : ''}</div><small style="color:var(--ui-muted);text-align:center">${f.pin ? L('Pinned. Tap again to move.', 'تم التثبيت. انقر مجددًا للنقل.') : L('Tap the plan to pin it.', 'انقر على المخطط للتثبيت.')}</small></div><div class="m-drop"><button class="m-big pri" data-m="next" style="flex:1">${L('Next', 'التالي')}</button></div>`;
    if (f.step === 'title') return `${hd(L('What’s wrong?', 'ما المشكلة؟'))}<div class="sm-det">${f.shot ? `<div class="sm-ph" style="height:120px"><img src="${f.shot}" alt=""></div>` : ''}<div class="m-fld"><input id="mt" class="${f.err ? 'err' : ''}" value="${esc(f.title)}" placeholder="${L('e.g. Cable tray not bonded', 'مثال: حامل الكابلات غير موصول')}"></div><div class="m-chips" style="padding:0;flex-wrap:wrap">${['Cable tray not bonded', 'Socket outlet loose', 'Missing cable labels'].map(s => `<button class="m-chip" data-msug="${s}">${s}</button>`).join('')}</div><div class="m-fld"><label>${L('Trade', 'التخصص')}</label><div class="m-tr">${Object.keys(TR).map(k => `<button class="${f.tr === k ? 'on' : ''}" data-mtr="${k}"><i style="background:var(--tone-${TR[k][2]}-solid)"></i>${L(TR[k][0], TR[k][1])}</button>`).join('')}</div></div></div><div class="m-drop"><button class="m-big pri" data-m="next" style="flex:1">${L('Next', 'التالي')}</button></div>`;
    return `${hd(L('Assign to', 'إسناد إلى'))}<div class="sm-det"><div class="m-types">${['tmc', 'gdl'].map(k => `<button class="m-type${f.co === k ? ' on' : ''}" data-mco="${k}" style="${f.co === k ? 'box-shadow:inset 0 0 0 2px var(--btn-pri)' : ''}"><span class="av" style="width:34px;height:34px;font-size:12px;background:${CO[k][2]}">${CO[k][3]}</span><span><b style="display:block">${L(CO[k][0], CO[k][1])}</b><small style="font-size:12px;color:var(--ui-muted)">${L(CO[k][4], CO[k][5])}</small></span></button>`).join('')}</div><small style="color:var(--ui-muted)">${L('You can only assign within your company and its subcontractors.', 'يمكنك الإسناد فقط داخل شركتك ومقاوليها من الباطن.')}</small></div><div class="m-drop"><button class="m-big pri" data-m="save" style="flex:1"><i class="ti ti-check"></i>${L('Save snag', 'حفظ الملاحظة')}</button></div>`;
  }
  function screen() {
    return `<div class="notch"></div><div class="sbar" style="background:var(--ui-surface)"><span>9:41</span><span class="ic"><i class="ti ti-antenna-bars-5"></i><i class="ti ti-wifi"></i><i class="ti ti-battery-3"></i></span></div><div class="sm-root">${M.flow ? flow() : M.det ? detail() : list()}</div>${M.toast ? `<div class="m-toast"><i class="ti ti-circle-check"></i>${M.toast}</div>` : ''}<div class="m-home"></div>`;
  }
  function render() {
    const el = document.getElementById('scr');
    const l = el.querySelector('.sm-list');
    const y = l ? l.scrollTop : 0;
    el.innerHTML = screen();
    const n = el.querySelector('.sm-list');
    if (n) n.scrollTop = y;
  }
  function all() {
    document.documentElement.lang = S.lang;
    document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('scr').className = 'scr' + (S.mode === 'dark' ? ' theme-dark' : '');
    document.getElementById('demo').innerHTML = `<span class="segv">${[['list', L('List', 'القائمة')], ['det', L('Detail', 'التفاصيل')], ['new', L('Create flow', 'إنشاء')]].map(s => `<button data-demo="${s[0]}">${s[1]}</button>`).join('')}</span><span class="segv"><button class="${S.lang === 'en' ? 'on' : ''}" data-lang="en">EN</button><button class="${S.lang === 'ar' ? 'on' : ''}" data-lang="ar">عربي</button></span><a class="cb" href="snag-list.html" style="text-decoration:none"><i class="ti ti-device-desktop"></i>${L('Desktop', 'سطح المكتب')}</a>`;
    render();
  }
  let tt;
  const flash = m => {
    M.toast = m;
    render();
    clearTimeout(tt);
    tt = setTimeout(() => {
      M.toast = null;
      render();
    }, 2000);
  };
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.style.display = 'none';
  document.body.appendChild(file);
  file.addEventListener('change', () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      M.flow.shot = rd.result;
      render();
    };
    rd.readAsDataURL(f);
  });
  const keep = () => {
    const t = document.getElementById('mt');
    if (t && M.flow) M.flow.title = t.value;
  };
  const setSt = (id, st) => {
    const it = I.find(x => x.id === id);
    it.stage = st;
    it.wk = 0.2;
    if (st === 'res' && !it.after) it.after = {
      note: ['Fixed on site — photo attached.', 'تم الإصلاح في الموقع — الصورة مرفقة.'],
      photos: 1
    };
    M.sw = null;
    flash(L(`${it.no.replace('TWR-', '')} → ${STG[st].en}`, `${it.no.replace('TWR-', '')} ← ${STG[st].ar}`));
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-m],[data-mt],[data-mst],[data-mopen],[data-mres],[data-mhold],[data-mf],[data-mpin],[data-mtr],[data-mco],[data-msug],[data-demo],[data-lang]');
    if (!b) return;
    const d = b.dataset;
    keep();
    if (d.lang) {
      S.lang = d.lang;
      try {
        const o = JSON.parse(localStorage.getItem('rb-shell-v1') || '{}');
        o.lang = d.lang;
        localStorage.setItem('rb-shell-v1', JSON.stringify(o));
      } catch (x) {}
      return all();
    }
    if (d.demo) {
      M.flow = null;
      M.det = null;
      M.sheet = false;
      if (d.demo === 'det') M.det = I.find(x => x.no === 'TWR-TMC-EL-SNG-014').id;
      if (d.demo === 'new') M.flow = {
        step: 'cam',
        shot: null,
        f: '02',
        pin: null,
        title: '',
        tr: 'EL',
        co: 'tmc'
      };
      return render();
    }
    if (d.mt) {
      M.type = d.mt;
      return render();
    }
    if (d.mst) {
      M.st.has(d.mst) ? M.st.delete(d.mst) : M.st.add(d.mst);
      return render();
    }
    if (d.mopen) {
      if (M.sw) {
        M.sw = null;
        return render();
      }
      M.det = d.mopen;
      return render();
    }
    if (d.mres) return setSt(d.mres, 'res');
    if (d.mhold) return setSt(d.mhold, 'hold');
    if (d.mf) {
      M.flow.f = d.mf;
      return render();
    }
    if (d.mpin) {
      const r = b.getBoundingClientRect();
      M.flow.pin = [(e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100];
      return render();
    }
    if (d.mtr) {
      M.flow.tr = d.mtr;
      return render();
    }
    if (d.mco) {
      M.flow.co = d.mco;
      return render();
    }
    if (d.msug) {
      M.flow.title = d.msug;
      M.flow.err = false;
      return render();
    }
    const a = d.m;
    if (a === 'filters') {
      M.sheet = true;
      return render();
    }
    if (a === 'closesheet') {
      M.sheet = false;
      return render();
    }
    if (a === 'mine') {
      M.mine = !M.mine;
      return render();
    }
    if (a === 'back') {
      M.det = null;
      return render();
    }
    if (a === 'new') {
      M.flow = {
        step: 'cam',
        shot: null,
        f: '02',
        pin: null,
        title: '',
        tr: 'EL',
        co: 'tmc'
      };
      return render();
    }
    if (a === 'cancelflow') {
      M.flow = null;
      return flash(L('Draft kept — finish it any time', 'تم الاحتفاظ بالمسودة'));
    }
    if (a === 'shoot' || a === 'lib') {
      file.toggleAttribute('capture', a === 'shoot');
      if (a === 'shoot') file.setAttribute('capture', 'environment');
      return file.click();
    }
    if (a === 'prev') {
      const i = STEPS.indexOf(M.flow.step);
      M.flow.step = STEPS[Math.max(0, i - 1)];
      return render();
    }
    if (a === 'next') {
      if (M.flow.step === 'title' && !M.flow.title.trim()) {
        M.flow.err = true;
        return render();
      }
      const i = STEPS.indexOf(M.flow.step);
      M.flow.step = STEPS[i + 1];
      return render();
    }
    if (a === 'save') {
      const f = M.flow;
      const k = CO[f.co][3] + '-' + f.tr + '-SNG';
      const it = {
        id: 'm' + Date.now(),
        no: 'TWR-' + k + '-' + String(I.filter(i => i.no.startsWith('TWR-' + k)).length + 40).padStart(3, '0'),
        type: 'snag',
        t: [f.title, f.title],
        tr: f.tr,
        f: f.f,
        sp: 0,
        co: f.co,
        who: f.co === 'gdl' ? 'omar' : 'nasser',
        stage: 'open',
        wk: 0.2,
        photos: f.shot ? 1 : 0,
        img: f.shot,
        src: null,
        pin: f.pin,
        chat: [],
        internal: [],
        hist: []
      };
      I.unshift(it);
      M.flow = null;
      M.det = it.id;
      return flash(L(`${it.no.replace('TWR-', '')} saved`, `تم حفظ ${it.no.replace('TWR-', '')}`));
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'mt' && M.flow) {
      M.flow.title = e.target.value;
      if (M.flow.err) {
        M.flow.err = false;
        e.target.classList.remove('err');
      }
    }
  });
  // swipe
  let P = null;
  document.addEventListener('pointerdown', e => {
    const c = e.target.closest('.sm-card');
    if (!c) return;
    P = {
      id: c.closest('[data-sw]').dataset.sw,
      x: e.clientX,
      el: c,
      dx: 0
    };
  });
  addEventListener('pointermove', e => {
    if (!P) return;
    const rtl = document.documentElement.dir === 'rtl';
    let dx = e.clientX - P.x;
    dx = rtl ? Math.max(0, Math.min(170, dx)) : Math.min(0, Math.max(-170, dx));
    P.dx = dx;
    if (Math.abs(dx) > 6) {
      P.el.style.transition = 'none';
      P.el.style.transform = `translateX(${dx}px)`;
    }
  });
  addEventListener('pointerup', () => {
    if (!P) return;
    const p = P;
    P = null;
    p.el.style.transition = '';
    if (Math.abs(p.dx) > 70) {
      M.sw = p.id;
      document.getElementById('scr').style.setProperty('--swx', (document.documentElement.dir === 'rtl' ? 150 : -150) + 'px');
      p.el.style.transform = '';
      render();
      document.addEventListener('click', ev => {
        ev.stopPropagation();
      }, {
        once: true,
        capture: true
      });
    } else if (Math.abs(p.dx) > 6) {
      p.el.style.transform = '';
      document.addEventListener('click', ev => {
        ev.stopPropagation();
      }, {
        once: true,
        capture: true
      });
    } else p.el.style.transform = '';
  });
  window.SM = {
    M,
    all
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/snag/mobile.js", error: String((e && e.message) || e) }); }

// ui_kits/app/snag/snag.js
try { (() => {
// Snag List module (desktop) + shared helpers (SN).
(function () {
  const S = RS.S,
    {
      STG,
      SORDER,
      TYP,
      TR,
      CO,
      PPL,
      ROLES,
      LOCS,
      SPACES,
      SRC,
      I
    } = SD;
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  const T = x => esc(L(x[0], x[1]));
  /* ---- shared ---- */
  const ty = k => `<span class="ty" style="background:var(--tone-${TYP[k].tone}-tint);color:var(--tone-${TYP[k].tone}-fg)"><i class="ti ${TYP[k].ic}"></i>${L(TYP[k].en, TYP[k].ar)}</span>`;
  const stp = k => `<span class="stp" style="background:var(--tone-${STG[k].tone}-tint);color:var(--tone-${STG[k].tone}-fg)"><i></i>${L(STG[k].en, STG[k].ar)}</span>`;
  const trc = k => `<span class="chip" style="height:22px;font-size:11.5px;background:var(--tone-${TR[k][2]}-tint);color:var(--tone-${TR[k][2]}-fg)">${L(TR[k][0], TR[k][1])}</span>`;
  const CODE = {
    A: ['var(--tone-green-solid)', '#fff', 'ti-check'],
    B: ['var(--tone-green-tint)', 'var(--tone-green-fg)', 'ti-message-circle'],
    C: ['var(--tone-orange-tint)', 'var(--tone-orange-fg)', 'ti-refresh'],
    D: ['var(--tone-red-tint)', 'var(--tone-red-fg)', 'ti-x']
  };
  const cdb = c => `<span class="cdb" style="background:${CODE[c][0]};color:${CODE[c][1]}"><i class="ti ${CODE[c][2]}"></i>Code ${c}</span>`;
  const DOT = ['#9aa0ad', '#9aa0ad', '#ee964b', '#e5484d'];
  const age = (w, lbl) => {
    const n = Math.min(4, Math.max(1, Math.round(w)));
    const c = n >= 4 ? '#e5484d' : DOT[n - 1];
    return `<span class="age" title="${L(n + (n >= 4 ? '+' : '') + ' weeks at this step', n + ' أسابيع في هذه الخطوة')}">${[1, 2, 3, 4].map(i => `<i style="${i <= n ? `background:${c};box-shadow:none` : ''}"></i>`).join('')}${lbl ? `<em>${n}${n >= 4 ? '+' : ''}${L('w', 'أ')}</em>` : ''}</span>`;
  };
  const av = (p, s) => `<span class="av" style="width:${s || 24}px;height:${s || 24}px;font-size:${Math.round((s || 24) * .38)}px;background:${PPL[p][3]}">${RS.ini(PPL[p][0])}</span>`;
  const loc = it => L(LOCS[it.f][0], LOCS[it.f][1]) + ' · ' + T(SPACES[it.sp]);
  const srcShort = s => s.no.split('-').slice(-2).join('-');
  function visible(it, role) {
    const r = ROLES[role];
    return !r.sees || r.sees.includes(it.co);
  }
  const thm = it => `<span class="thm">${it.img ? `<img src="${it.img}" alt="">` : `<i class="ti ${it.photos ? 'ti-photo' : 'ti-photo-off'}"></i>`}${it.photos > 1 ? `<b>${it.photos}</b>` : ''}</span>`;
  window.SN = {
    L,
    T,
    ty,
    stp,
    trc,
    cdb,
    age,
    av,
    loc,
    srcShort,
    visible,
    thm,
    esc
  };
  /* ---- state ---- */
  const V = {
    fsel: {},
    gb: 'stage',
    role: 'admin',
    view: 'list',
    type: 'all',
    F: {
      tr: new Set(),
      fl: new Set(),
      co: new Set(),
      st: new Set(),
      mine: false,
      src: ''
    },
    q: '',
    open: {},
    sel: new Set(),
    menu: null,
    det: null,
    tab: 'det',
    act: null,
    draft: null,
    create: null,
    modal: null,
    empty: false,
    toast: null,
    cm: ''
  };
  const R0 = () => ROLES[V.role];
  function list() {
    if (V.empty) return [];
    const q = V.q.trim().toLowerCase();
    const F = V.fsel,
      has = (k, v) => !F[k] || !F[k].length || F[k].includes(v);
    return I.filter(it => visible(it, V.role) && has('type', it.type) && has('stage', it.stage) && has('tr', it.tr) && has('fl', it.f) && has('co', it.co) && has('src', it.src || 'manual') && (!F.age || !F.age.length || it.wk >= +F.age[0]) && (V.type === 'all' || it.type === V.type) && (!V.F.tr.size || V.F.tr.has(it.tr)) && (!V.F.fl.size || V.F.fl.has(it.f)) && (!V.F.co.size || V.F.co.has(it.co)) && (!V.F.st.size || V.F.st.has(it.stage)) && (!V.F.mine || it.who === R0().me || V.role === 'tmc' && it.who === 'nasser') && (!V.F.src || it.src === V.F.src) && (!q || (it.no + ' ' + it.t[0] + ' ' + it.t[1]).toLowerCase().includes(q)));
  }
  /* ---- toolbar ---- */
  function dd(key, label, opts) {
    const set = V.F[key];
    const n = set.size;
    return `<span class="rel"><button class="cb fbtn${n ? ' set' : ''}" data-menu="f-${key}">${label}<span class="v">${n ? ': ' + (n === 1 ? opts.find(o => set.has(o[0]))[1] : n) : ''}</span><i class="ti ti-chevron-down"></i></button>${V.menu === 'f-' + key ? `<div class="pop" data-stop style="min-width:220px"><h6>${label}</h6>${opts.map(o => `<button class="mi${set.has(o[0]) ? ' on' : ''}" data-fk="${key}:${o[0]}">${o[2] || ''}${o[1]}${set.has(o[0]) ? '<i class="ti ti-check ck"></i>' : ''}</button>`).join('')}</div>` : ''}</span>`;
  }
  const fc = () => Object.values(V.fsel).filter(v => v && v.length).length;
  function fields() {
    const r = R0(),
      all = I.filter(it => visible(it, V.role));
    const cos = Object.keys(CO).filter(k => !r.sees || r.sees.includes(k));
    const srcs = Object.keys(SRC).filter(k => all.some(i => i.src === k));
    return [{
      k: 'type',
      n: L('Type', 'النوع'),
      a: L('النوع', 'Type'),
      mark: 'ic',
      opts: Object.keys(TYP).map(k => [k, TYP[k].ic, 0, L(TYP[k].pl[0], TYP[k].pl[1])])
    }, {
      k: 'stage',
      n: L('Stage', 'المرحلة'),
      a: L('المرحلة', 'Stage'),
      mark: 'dot',
      opts: SORDER.map(k => [k, 'var(--tone-' + STG[k].tone + '-solid)', 0, L(STG[k].en, STG[k].ar)])
    }, {
      k: 'tr',
      n: L('Trade', 'التخصص'),
      a: L('التخصص', 'Trade'),
      mark: 'chip',
      opts: Object.keys(TR).map(k => [k, TR[k][2], k, L(TR[k][0], TR[k][1])])
    }, {
      sep: 1
    }, {
      k: 'fl',
      n: L('Location', 'الموقع'),
      a: L('الموقع', 'Location'),
      mark: 'ic',
      opts: Object.keys(LOCS).map(k => [k, 'ti-stairs', 0, L('Tower 1 · ', 'البرج ١ · ') + L(LOCS[k][0], LOCS[k][1])])
    }, {
      k: 'co',
      n: L('Company', 'الشركة'),
      a: L('الشركة', 'Company'),
      mark: 'av',
      opts: cos.map(k => {
        const o = [k, CO[k][2], 0, L(CO[k][0], CO[k][1])];
        o.av = CO[k][0];
        return o;
      })
    }, {
      k: 'src',
      n: L('Raised from', 'المصدر'),
      a: L('المصدر', 'Source'),
      mark: 'ic',
      opts: [...srcs.map(k => [k, SRC[k].kind === 'sub' ? 'ti-file-text' : SRC[k].kind === 'insp' ? 'ti-clipboard-check' : 'ti-report', 0, srcShort(SRC[k]) + ' · ' + L(SRC[k].t[0], SRC[k].t[1]) + (SRC[k].code ? ' · Code ' + SRC[k].code : '')]), ['manual', 'ti-hand-finger', 0, L('Raised manually', 'يدوي')]]
    }, {
      sep: 1
    }, {
      k: 'age',
      n: L('Weeks at step', 'الأسابيع في الخطوة'),
      a: L('العمر', 'Age'),
      single: 1,
      mark: 'days',
      opts: [['2', 'g___', 0, L('2+ weeks', '2+ أسابيع')], ['3', 'y___', 0, L('3+ weeks', '3+ أسابيع')], ['4', 'rrrr', 0, L('4+ weeks', '4+ أسابيع')]]
    }];
  }
  const SNSAVED = {
    starred: ['Code B comments · MAR-041', 'My open snags'],
    mine: ['Failed inspections', 'Floor 02 · Electrical', 'Stuck 3+ weeks']
  };
  const SNPRESET = {
    'Code B comments · MAR-041': {
      type: ['cmt'],
      src: ['mar041']
    },
    'My open snags': {
      type: ['snag'],
      stage: ['open', 'prog']
    },
    'Failed inspections': {
      src: ['ir045', 'ir051']
    },
    'Floor 02 · Electrical': {
      fl: ['02'],
      tr: ['EL']
    },
    'Stuck 3+ weeks': {
      age: ['3']
    }
  };
  function toolbar() {
    const r = R0();
    const GB = [['stage', L('Stage', 'المرحلة')], ['type', L('Type', 'النوع')], ['tr', L('Trade', 'التخصص')], ['none', L('No grouping', 'بدون تجميع')]];
    return `<div class="sn-bar"><button class="cb pri" data-act="new"><i class="ti ti-plus"></i>${L('New Snag', 'ملاحظة جديدة')}</button>
 <label class="fsrch"><i class="ti ti-search"></i><input id="snq" placeholder="${L('Search number or title', 'ابحث بالرقم أو العنوان')}" value="${esc(V.q)}"><kbd>/</kbd></label>
 <button class="cb${fc() ? ' on' : ''}" data-fpop="sn"><i class="ti ti-filter"></i>${L('Filter', 'تصفية')}${fc() ? `<span class="fcnt">${fc()}</span>` : ''}<i class="ti ti-chevron-down"></i></button>
 <span class="rel"><button class="cb ic" data-menu="gset" title="${L('Settings', 'الإعدادات')}"><i class="ti ti-settings"></i></button>${V.menu === 'gset' ? `<div class="pop" data-stop style="min-width:220px"><h6>${L('Group by', 'تجميع حسب')}</h6>${GB.map(g => `<button class="mi${V.gb === g[0] ? ' on' : ''}" data-gb="${g[0]}">${g[1]}${V.gb === g[0] ? '<i class="ti ti-check ck"></i>' : ''}</button>`).join('')}</div>` : ''}</span>
 <span class="tgl" data-act="mine"><span class="swc${V.F.mine ? ' on' : ''}"></span>${L('Assigned to me', 'مسند إليّ')}</span>
 ${fc() || V.q || V.F.mine ? `<button class="cb ter sm" data-act="clearf">${L('Clear', 'مسح')}</button>` : ''}
 <span class="sp"></span>
 <span class="rel"><button class="vis" data-menu="role"><i class="ti ti-eye"></i>${L(r.en, r.ar)}<i class="ti ti-chevron-down"></i></button>${V.menu === 'role' ? `<div class="pop end" data-stop style="min-width:280px"><h6>${L('Demo · view as', 'عرض توضيحي · العرض بصفة')}</h6>${Object.entries(ROLES).map(([k, x]) => `<button class="mi${V.role === k ? ' on' : ''}" data-role="${k}"><i class="ti ${k === 'admin' ? 'ti-shield' : k === 'dcl' ? 'ti-user-check' : 'ti-user-circle'}"></i>${L(x.en, x.ar)}</button>`).join('')}</div>` : ''}</span>
 <span class="segv"><button class="${V.view === 'list' ? 'on' : ''}" data-view="list"><i class="ti ti-list"></i>${L('List', 'قائمة')}</button><button class="${V.view === 'kanban' ? 'on' : ''}" data-view="kanban"><i class="ti ti-layout-grid"></i>${L('Kanban', 'كانبان')}</button><button data-view="plan"><i class="ti ti-vector"></i>${L('Plan', 'المخطط')}</button></span>
 <span class="rel"><button class="cb" data-menu="exp"><i class="ti ti-file-download"></i>${L('Export', 'تصدير')}<i class="ti ti-chevron-down"></i></button>${V.menu === 'exp' ? `<div class="pop end" data-stop><button class="mi" data-exp="pdf"><i class="ti ti-file-text"></i>${L('PDF snag report', 'تقرير الملاحظات PDF')}</button><button class="mi" data-exp="xls"><i class="ti ti-table"></i>Excel<small>.xls</small></button></div>` : ''}</span>
 <span class="rel"><button class="cb ic" data-menu="demo"><i class="ti ti-dots"></i></button>${V.menu === 'demo' ? `<div class="pop end" data-stop><h6>${L('Demo states', 'حالات العرض')}</h6><button class="mi" data-demo="cmt"><i class="ti ti-message-circle"></i>${L('Comment from Code B submittal', 'تعليق من تقديم Code B')}</button><button class="mi" data-demo="resolve"><i class="ti ti-circle-check"></i>${L('Contractor marks Resolved', 'المقاول يحدد كمحلول')}</button><button class="mi" data-demo="verify"><i class="ti ti-user-check"></i>${L('Consultant verifies', 'الاستشاري يتحقق')}</button><button class="mi" data-demo="panel"><i class="ti ti-file-text"></i>${L('Submittal page · comments panel', 'صفحة التقديم · لوحة التعليقات')}</button><button class="mi" data-demo="empty"><i class="ti ti-mood-smile"></i>${L('Empty state', 'الحالة الفارغة')}</button><div class="sep"></div><a class="mi" href="snag-list-mobile.html"><i class="ti ti-device-mobile"></i>${L('Mobile version', 'نسخة الجوال')}</a></div>` : ''}</span></div>`;
  }
  /* ---- list ---- */
  function srcCell(it) {
    if (!it.src) return `<span style="color:var(--ui-faint);font-size:12.5px">${L('Manual', 'يدوي')}</span>`;
    const s = SRC[it.src];
    return `<span style="display:inline-flex;gap:6px;align-items:center"><a class="src num" data-srcopen="${it.src}">${srcShort(s)}</a>${s.code ? cdb(s.code) : s.kind === 'insp' ? `<span class="cdb" style="background:var(--tone-red-tint);color:var(--tone-red-fg)"><i class="ti ti-x"></i>${L('Failed', 'راسب')}</span>` : ''}</span>`;
  }
  function row(it) {
    const on = V.sel.has(it.id),
      p = PPL[it.who];
    return `<tr class="${on ? 'sel' : ''}" data-open="${it.id}"><td class="c-chk"><span class="ck${on ? ' on' : ''}" data-sel="${it.id}">${on ? '<i class="ti ti-check"></i>' : ''}</span></td><td><span class="num" style="font-size:12.5px;color:var(--ui-muted);font-weight:600">${it.no}</span></td><td><span class="ttl">${T(it.t)}</span></td><td>${ty(it.type)}</td><td>${trc(it.tr)}</td><td style="font-size:12.5px;color:var(--ui-text-2)">${loc(it)}</td><td>${srcCell(it)}</td><td><span class="asg">${av(it.who)}<span><b>${T(p)}</b><small>${CO[it.co][3]}</small></span></span></td><td>${age(it.wk, 1)}</td><td>${thm(it)}</td></tr>`;
  }
  function listView(ls) {
    const g = {};
    const gk = it => V.gb === 'type' ? it.type : V.gb === 'tr' ? it.tr : V.gb === 'none' ? 'all' : it.stage;
    ls.forEach(it => (g[gk(it)] = g[gk(it)] || []).push(it));
    const GO = V.gb === 'type' ? Object.keys(TYP) : V.gb === 'tr' ? Object.keys(TR) : V.gb === 'none' ? ['all'] : SORDER;
    const ghead = k => V.gb === 'type' ? ty(k) : V.gb === 'tr' ? trc(k) : V.gb === 'none' ? `<b>${L('All items', 'كل العناصر')}</b>` : stp(k);
    const nsel = V.sel.size;
    return `<div class="tw">${nsel ? `<div class="bulk">${nsel} ${L('selected', 'محدد')}<span class="sp"></span><span class="rel"><button class="cb sm" data-menu="b-re"><i class="ti ti-user"></i>${L('Reassign', 'إعادة إسناد')}<i class="ti ti-chevron-down"></i></button>${V.menu === 'b-re' ? `<div class="pop end" data-stop><h6>${L('Within ', 'ضمن ')}${L(CO[R0().co === 'dcl' && V.role !== 'admin' ? 'dcl' : 'tmc'][0], CO[R0().co === 'dcl' && V.role !== 'admin' ? 'dcl' : 'tmc'][1])}</h6>${Object.keys(PPL).filter(k => PPL[k][2] === (V.role === 'dcl' ? 'dcl' : 'tmc')).map(k => `<button class="mi" data-bre="${k}">${av(k, 20)}${T(PPL[k])}</button>`).join('')}</div>` : ''}</span><span class="rel"><button class="cb sm" data-menu="b-st"><i class="ti ti-arrows-sort"></i>${L('Move stage', 'نقل المرحلة')}<i class="ti ti-chevron-down"></i></button>${V.menu === 'b-st' ? `<div class="pop end" data-stop>${SORDER.map(k => `<button class="mi" data-bst="${k}">${stp(k)}</button>`).join('')}</div>` : ''}</span><button class="cb sm" data-exp="xls"><i class="ti ti-file-download"></i>${L('Export', 'تصدير')}</button><button class="cb sm ter" data-act="clrsel">${L('Clear', 'مسح')}</button></div>` : ''}
 <div class="ts" style="max-height:none"><table class="lv"><thead><tr><th class="c-chk"><span class="ck${nsel && nsel === ls.length ? ' on' : ''}" data-act="selall">${nsel ? `<i class="ti ti-${nsel === ls.length ? 'check' : 'minus'}"></i>` : ''}</span></th><th style="min-width:180px">${L('Number', 'الرقم')}</th><th style="min-width:240px">${L('Title', 'العنوان')}</th><th>${L('Type', 'النوع')}</th><th>${L('Trade', 'التخصص')}</th><th style="min-width:160px">${L('Location', 'الموقع')}</th><th style="min-width:150px">${L('Raised from', 'المصدر')}</th><th style="min-width:170px">${L('Assigned to', 'مسند إلى')}</th><th>${L('Age', 'العمر')}</th><th>${L('Photo', 'صورة')}</th></tr></thead><tbody>
 ${GO.filter(k => g[k]).map(k => {
      const open = V.open[k] !== false;
      return `<tr class="gh${open ? ' open' : ''}" data-grp="${k}"><td colspan="10"><span class="ghi"><i class="ti ti-chevron-right"></i>${ghead(k)}<small>${g[k].length} ${L('items', 'عنصر')}</small></span></td></tr>${open ? g[k].map(row).join('') : ''}`;
    }).join('')}
 </tbody></table></div></div>`;
  }
  function card(it) {
    return `<div class="skc" data-open="${it.id}"><div class="r1"><i class="ti ${TYP[it.type].ic}" style="color:var(--tone-${TYP[it.type].tone}-solid);font-size:16px"></i><span class="num">${it.no}</span>${thm(it)}</div><b>${T(it.t)}</b><div class="r2"><span class="lc"><i class="ti ti-map-pin"></i>${loc(it)}</span>${trc(it.tr)}</div><div class="r3">${av(it.who, 22)}${T(PPL[it.who]).split(' ')[0]}${age(it.wk)}</div></div>`;
  }
  function kanban(ls) {
    return `<div class="skb">${SORDER.map(k => {
      const a = ls.filter(i => i.stage === k);
      return `<section class="kcol" data-colst="${k}"><div class="kch"><span class="d" style="background:var(--tone-${STG[k].tone}-solid)"></span>${L(STG[k].en, STG[k].ar)}<span class="n">${a.length}</span></div><div class="klist">${a.map(card).join('') || `<div class="kempty">${L('Nothing here', 'لا شيء هنا')}</div>`}</div></section>`;
    }).join('')}</div>`;
  }
  /* ---- detail ---- */
  const HA = {
    create: ['ti-plus', 'Raised', 'أُنشئت', 'gray'],
    prog: ['ti-player-play', 'Started work', 'بدأ العمل', 'blue'],
    hold: ['ti-player-pause', 'Put on hold', 'عُلّقت', 'gray'],
    res: ['ti-circle-check', 'Marked Resolved', 'حُدّدت كمحلولة', 'violet'],
    closed: ['ti-lock', 'Verified & closed', 'تم التحقق والإغلاق', 'green'],
    reopen: ['ti-refresh', 'Re-opened', 'أُعيد فتحها', 'orange']
  };
  function actions(it) {
    const c = R0().can,
      mine = V.role === 'admin' || R0().sees && R0().sees.includes(it.co);
    const b = [];
    if (it.stage === 'open' && c.includes('start') && mine) b.push(`<button class="cb" data-do="prog"><i class="ti ti-player-play"></i>${L('Start work', 'بدء العمل')}</button>`);
    if (['open', 'prog'].includes(it.stage) && c.includes('hold')) b.push(`<button class="cb" data-do="hold"><i class="ti ti-player-pause"></i>${L('Put On Hold', 'تعليق')}</button>`);
    if (it.stage === 'hold' && c.includes('start') && mine) b.push(`<button class="cb" data-do="prog"><i class="ti ti-player-play"></i>${L('Resume', 'استئناف')}</button>`);
    if (['open', 'prog', 'hold'].includes(it.stage) && c.includes('resolve') && mine) b.push(`<button class="cb pri" data-act="resolveform"><i class="ti ti-circle-check"></i>${L('Mark Resolved', 'تحديد كمحلول')}</button>`);
    if (it.stage === 'res' && c.includes('close')) b.push(`<button class="cb" data-act="reopenform"><i class="ti ti-refresh"></i>${L('Re-open', 'إعادة فتح')}</button><button class="cb pri" data-do="closed"><i class="ti ti-lock"></i>${L('Close', 'إغلاق')}</button>`);
    if (it.stage === 'closed' && c.includes('reopen')) b.push(`<button class="cb" data-act="reopenform"><i class="ti ti-refresh"></i>${L('Re-open', 'إعادة فتح')}</button>`);
    if (!b.length) return `<div class="wait"><i class="ti ti-clock"></i>${it.stage === 'res' ? L('Waiting for the consultant to verify.', 'بانتظار تحقق الاستشاري.') : it.stage === 'closed' ? L('Closed — no further action.', 'مغلقة — لا إجراء إضافي.') : L('Waiting for the contractor.', 'بانتظار المقاول.')}</div>`;
    return `<div class="acts">${b.join('')}</div>`;
  }
  const ph = (tag, c, src, i) => `<div class="ph">${src ? `<img src="${src}" alt="">` : `<i class="ti ti-photo"></i>${L('Photo', 'صورة')} ${i}`}${tag ? `<span class="tg" style="background:${c}">${tag}</span>` : ''}</div>`;
  function actForm(it) {
    if (V.act === 'resolve') {
      const d = V.draft;
      return `<div class="actf"><h4><i class="ti ti-circle-check" style="color:var(--btn-pri)"></i>${L('Mark as Resolved', 'تحديد كمحلول')}</h4><textarea id="fixnote" rows="3" class="${d.err ? 'err' : ''}" placeholder="${L('What did you fix? (required)', 'ما الذي تم إصلاحه؟ (مطلوب)')}">${esc(d.note)}</textarea><div class="ba"><div><small>${L('Before', 'قبل')}</small><div class="gal">${Array.from({
        length: Math.max(1, it.photos)
      }, (_, i) => ph('', 0, null, i + 1)).join('')}</div></div><div><small>${L('After', 'بعد')}</small><div class="gal">${d.photos.map(s => ph(L('After', 'بعد'), 'var(--tone-green-solid)', s)).join('')}<button class="phadd" data-act="afterphoto"><i class="ti ti-camera"></i>${L('Add after photo', 'إضافة صورة بعد')}</button></div></div></div><div class="row"><button class="cb" data-act="cancelact">${L('Cancel', 'إلغاء')}</button><button class="cb pri" data-act="doresolve"><i class="ti ti-check"></i>${L('Submit for verification', 'إرسال للتحقق')}</button></div></div>`;
    }
    if (V.act === 'reopen') {
      const d = V.draft;
      return `<div class="actf" style="border-color:var(--tone-orange-solid)"><h4><i class="ti ti-refresh" style="color:var(--tone-orange-solid)"></i>${L('Re-open with a note', 'إعادة الفتح مع ملاحظة')}</h4><textarea id="ronote" rows="3" class="${d.err ? 'err' : ''}" placeholder="${L('Tell the contractor what is still wrong (required)', 'أخبر المقاول بما لا يزال خاطئًا (مطلوب)')}">${esc(d.note)}</textarea><div class="row"><button class="cb" data-act="cancelact">${L('Cancel', 'إلغاء')}</button><button class="cb pri" data-act="doreopen" style="background:var(--tone-orange-solid)"><i class="ti ti-refresh"></i>${L('Re-open', 'إعادة فتح')}</button></div></div>`;
    }
    return '';
  }
  function raised(it) {
    if (!it.src) return `<div class="box"><h6>${L('Raised from', 'المصدر')}</h6><div style="font-size:13px;color:var(--ui-muted)">${L('Raised manually on site.', 'أُنشئت يدويًا في الموقع.')}</div></div>`;
    const s = SRC[it.src];
    if (s.kind === 'sub') return `<div class="box"><h6><i class="ti ti-link"></i>${L('Raised from submittal', 'مصدرها التقديم')}</h6><div class="rf"><span class="ic" style="background:var(--tone-green-tint);color:var(--tone-green-fg)"><i class="ti ti-file-text"></i></span><div class="tx"><span class="num">${s.no}</span><b>${T(s.t)}</b></div>${cdb(s.code)}</div>${it.q ? `<blockquote class="quote">“${T(it.q)}”<small>— ${T(PPL[s.by])} · ${L('Consultant review', 'مراجعة الاستشاري')}</small></blockquote>` : ''}<div><button class="cb sm" data-srcopen="${it.src}"><i class="ti ti-external-link"></i>${L('Open submittal', 'فتح التقديم')}</button></div></div>`;
    if (s.kind === 'insp') return `<div class="box"><h6><i class="ti ti-link"></i>${L('Raised from inspection', 'مصدرها الفحص')}</h6><div class="rf"><span class="ic" style="background:var(--tone-red-tint);color:var(--tone-red-fg)"><i class="ti ti-clipboard-check"></i></span><div class="tx"><span class="num">${s.no}</span><b>${T(s.t)}</b></div></div><div class="failed"><i class="ti ti-x"></i>${L('Failed checklist item: ', 'بند فحص راسب: ')}${T(s.failed)}</div><div class="gal">${ph(L('Inspection', 'الفحص'), 'var(--tone-red-solid)', null, 1)}</div><div><button class="cb sm" data-srcopen="${it.src}"><i class="ti ti-external-link"></i>${L('Open inspection', 'فتح الفحص')}</button></div></div>`;
    return `<div class="box"><h6><i class="ti ti-link"></i>${L('Raised from daily report', 'مصدرها التقرير اليومي')}</h6><div class="rf"><span class="ic" style="background:var(--tone-gray-tint);color:var(--ui-muted)"><i class="ti ti-report"></i></span><div class="tx"><span class="num">${s.no}</span><b>${T(s.t)}</b></div><button class="cb sm" data-srcopen="${it.src}">${L('Open', 'فتح')}</button></div></div>`;
  }
  function miniPlan(it) {
    return `<div class="mini">${PD.drawing({
      no: 'A-10' + (it.f === '02' ? 2 : 1),
      en: 'Plan',
      rev: 'C',
      date: ''
    })}${it.pin ? `<span class="mp" style="left:${it.pin[0] / 12}%;top:${it.pin[1] / 8}%"></span>` : ''}</div>`;
  }
  function detail() {
    const it = I.find(x => x.id === V.det);
    if (!it) return '';
    const p = PPL[it.who];
    const own = R0().co;
    const intl = it.internal.filter(m => PPL[m.by][2] === own || own === 'tmc' && PPL[m.by][2] === 'gdl' || V.role === 'admin' && false);
    let body = '';
    if (V.tab === 'det') body = `${actForm(it)}${raised(it)}
  ${it.after ? `<div class="box"><h6><i class="ti ti-circle-check"></i>${L('Contractor response', 'رد المقاول')}<span class="r">${av(it.who, 20)}</span></h6><div class="fnote">${T(it.after.note)}</div><div class="ba"><div><small>${L('Before', 'قبل')}</small><div class="gal">${it.photos ? Array.from({
      length: Math.min(2, it.photos)
    }, (_, i) => ph('', 0, null, i + 1)).join('') : `<div class="ph"><i class="ti ti-photo-off"></i></div>`}</div></div><div><small>${L('After', 'بعد')}</small><div class="gal">${(it.after.imgs || []).map(s => ph(L('After', 'بعد'), 'var(--tone-green-solid)', s)).join('') || (it.after.photos ? ph(L('After', 'بعد'), 'var(--tone-green-solid)', null, 1) : `<div class="ph" style="font-size:11.5px">${it.after.files ? L('Document attached', 'مستند مرفق') : L('No photo', 'لا صورة')}</div>`)}</div></div></div></div>` : ''}
  <div class="box"><h6>${L('Details', 'التفاصيل')}</h6>${it.desc ? `<div style="font-size:13.5px;line-height:1.55;color:var(--ui-text)">${T(it.desc)}</div>` : ''}<div class="kv2"><span>${L('Trade', 'التخصص')}</span><b>${trc(it.tr)}</b><span>${L('Assigned to', 'مسند إلى')}</span><b>${av(it.who, 20)}${T(p)} · ${L(CO[it.co][0], CO[it.co][1])}</b><span>${L('Stage', 'المرحلة')}</span><b>${stp(it.stage)}${age(it.wk, 1)}</b></div>
  <div class="locrow">${miniPlan(it)}<div class="kv2" style="grid-template-columns:auto 1fr;align-content:start"><span>${L('Zone', 'المنطقة')}</span><b>${L('Zone A – North Wing', 'المنطقة أ')}</b><span>${L('Building', 'المبنى')}</span><b>${L('Tower 1', 'البرج ١')}</b><span>${L('Floor', 'الطابق')}</span><b>${L(LOCS[it.f][0], LOCS[it.f][1])}</b><span>${L('Space', 'المساحة')}</span><b>${T(SPACES[it.sp])}</b><span></span><b><a class="src" href="plan-view.html?fl=${it.f}"><i class="ti ti-vector"></i>${L('Open on plan', 'فتح على المخطط')}</a></b></div></div></div>
  ${it.photos ? `<div class="box"><h6>${L('Photos', 'الصور')}<span class="r">${it.photos}</span></h6><div class="gal">${Array.from({
      length: it.photos
    }, (_, i) => it.img && i === 0 ? ph('', 0, it.img) : ph('', 0, null, i + 1)).join('')}</div></div>` : ''}
  <div class="box"><h6>${L('Attachments', 'المرفقات')}</h6><div class="files">${it.type === 'cmt' ? `<div class="fl"><i class="ti ti-file-text"></i>${L('Review comments sheet.pdf', 'ورقة ملاحظات المراجعة.pdf')}<small>240 KB</small></div>` : ''}${it.after && it.after.files ? `<div class="fl"><i class="ti ti-file-text"></i>TH-IP65-2291.pdf<small>1.1 MB</small></div>` : ''}${it.type !== 'cmt' && !(it.after && it.after.files) ? `<div style="font-size:12.5px;color:var(--ui-faint)">${L('No attachments', 'لا مرفقات')}</div>` : ''}</div></div>
  <div class="box"><h6>${L('History', 'السجل')}</h6><div class="hist">${it.hist.slice().reverse().map(h => {
      const a = HA[h.a];
      return `<div class="hi"><span class="dt" style="background:var(--tone-${a[3]}-solid)"><i class="ti ${a[0]}"></i></span><div class="tx"><b>${T(PPL[h.by])}</b> ${L(a[1].toLowerCase(), a[2])}${h.note ? `: “${esc(h.note)}”` : ''}<small>${h.w <= 0 ? L('Just now', 'الآن') : L(Math.round(h.w) + ' week' + (Math.round(h.w) === 1 ? '' : 's') + ' ago', 'منذ ' + Math.round(h.w) + ' أسابيع')} · ${L(CO[PPL[h.by][2]][0], CO[PPL[h.by][2]][1])}</small></div></div>`;
    }).join('')}</div></div>`;
    const msgs = a => `<div class="msgs">${a.map(m => `<div class="msg${m.by === R0().me ? ' me' : ''}">${av(m.by, 30)}<div class="bb"><small><b>${T(PPL[m.by])}</b> · ${m.w ? L(m.w + 'w ago', 'منذ ' + m.w + ' أ') : L('now', 'الآن')}</small>${m.t[0] === m.t[1] ? esc(m.t[0]) : T(m.t)}</div></div>`).join('') || `<div style="text-align:center;color:var(--ui-faint);font-size:13px;padding:30px">${L('No messages yet', 'لا رسائل بعد')}</div>`}</div>`;
    if (V.tab === 'chat') body = msgs(it.chat);
    if (V.tab === 'int') body = `<div class="lockb"><i class="ti ti-lock"></i>${L(`Only people at ${CO[own][0]} can see these notes.`, `هذه الملاحظات مرئية فقط لموظفي ${CO[own][1]}.`)}</div>${msgs(intl)}`;
    const WM = {
      open: 'o',
      prog: 'p',
      hold: 'p',
      res: 'c',
      closed: 'eA'
    };
    if (V.tab === 'wf') {
      const cur = WM[it.stage];
      const path = ['o', 'p', 'c', 'r'].slice(0, {
        o: 1,
        p: 2,
        c: 3,
        eA: 3
      }[cur] || 1);
      const sc = {},
        ec = {};
      Object.keys(WF.SNAGWF.S).forEach(k => sc[k] = k === cur ? 'cur' : path.includes(k) || cur === 'eA' ? 'done' : 'fade');
      Object.entries(WF.SNAGWF.T).forEach(([k, t]) => ec[k] = t.f === cur ? 'next info' : (path.includes(t.to) || cur === 'eA') && path.includes(t.f) ? 'done' : 'fade');
      body = `<div class="lockb" style="background:var(--tone-blue-tint);color:var(--tone-blue-fg)"><i class="ti ti-git-branch"></i><b>${L('Now: ', 'الآن: ')}${L(WF.SNAGWF.S[cur]?.en || 'Closed', WF.SNAGWF.S[cur]?.ar || 'مغلق')}</b> · ${L('Snag – fix & confirm · v1', 'الملاحظة – إصلاح وتأكيد · v1')}</div><div class="wcv" style="height:300px"><div class="wstage"><div style="transform:translate(4px,-60px) scale(.44);transform-origin:0 0">${WF.renderDiagram({
        L,
        S: WF.SNAGWF.S,
        T: WF.SNAGWF.T,
        scls: sc,
        ecls: ec,
        hideOut: 1
      })}</div></div></div>`;
    }
    return `<div class="scrim" data-close="1"><div class="drw" data-stop><div class="dh"><div class="t1">${ty(it.type)}<span class="num">${it.no}</span>${stp(it.stage)}${age(it.wk, 1)}<button class="cb ter sm ic x" data-close="1"><i class="ti ti-x"></i></button></div><h2>${T(it.t)}</h2>${actions(it)}<div class="dtabs">${[['det', L('Details', 'التفاصيل')], ['wf', L('Workflow', 'سير العمل')], ['chat', L('Chat', 'المحادثة'), it.chat.length], ['int', L('Internal Communication', 'التواصل الداخلي'), intl.length]].map(t => `<button class="${V.tab === t[0] ? 'on' : ''}" data-dtab="${t[0]}">${t[0] === 'int' ? '<i class="ti ti-lock" style="font-size:14px"></i>' : ''}${t[1]}${t[2] ? `<span class="n">${t[2]}</span>` : ''}</button>`).join('')}</div></div><div class="db" id="dbody">${body}</div>${V.tab === 'chat' || V.tab === 'int' ? `<div class="compose"><input id="cmsg" placeholder="${V.tab === 'int' ? L('Internal note — only your company sees this', 'ملاحظة داخلية — مرئية لشركتك فقط') : L('Message everyone on this item', 'رسالة لكل المشاركين في هذا العنصر')}" value="${esc(V.cm)}"><button class="cb pri" data-act="send"><i class="ti ti-send"></i></button></div>` : ''}</div></div>`;
  }
  /* ---- create ---- */
  function create() {
    const c = V.create;
    if (!c) return '';
    const r = R0();
    const cos = Object.keys(CO).filter(k => k !== 'dcl' && (!r.sees || r.sees.includes(k)));
    return `<div class="scrim" data-close="1"><div class="drw" data-stop><div class="dh" style="padding-bottom:12px"><div class="t1"><b style="font-size:17px">${L('New item', 'عنصر جديد')}</b><span style="font-size:12px;color:var(--ui-muted)">${c.saved ? `<i class="ti ti-check"></i> ${L('Draft saved', 'تم حفظ المسودة')}` : ''}</span><button class="cb ter sm ic x" data-close="1"><i class="ti ti-x"></i></button></div></div><div class="db"><div class="cf">
 <label>${L('Type', 'النوع')}<span class="chs">${Object.keys(TYP).map(k => `<button class="${c.type === k ? 'on' : ''}" data-ctype="${k}"><i class="ti ${TYP[k].ic}"></i>${L(TYP[k].en, TYP[k].ar)}</button>`).join('')}</span></label>
 <label>${L('Title', 'العنوان')} *<input id="ct" class="${c.err ? 'err' : ''}" value="${esc(c.title)}" placeholder="${L('e.g. Cable tray not bonded', 'مثال: حامل الكابلات غير موصول')}"></label>
 <label>${L('Description', 'الوصف')}<textarea id="cd" rows="3">${esc(c.desc)}</textarea></label>
 <label>${L('Trade', 'التخصص')}<span class="chs">${Object.keys(TR).map(k => `<button class="${c.tr === k ? 'on' : ''}" data-ctr="${k}"><i class="d" style="background:var(--tone-${TR[k][2]}-solid)"></i>${L(TR[k][0], TR[k][1])}</button>`).join('')}</span></label>
 <label>${L('Location', 'الموقع')}<span class="g3"><select><option>${L('Zone A – North Wing', 'المنطقة أ')}</option></select><select><option>${L('Tower 1', 'البرج ١')}</option></select><select id="cf">${Object.keys(LOCS).map(k => `<option value="${k}"${c.f === k ? ' selected' : ''}>${L(LOCS[k][0], LOCS[k][1])}</option>`).join('')}</select></span></label>
 <div class="pinb">${miniPlan({
      f: c.f,
      pin: c.pin
    })}<div style="flex:1;font-size:13px;color:var(--ui-text-2)">${c.pin ? L('Pinned on sheet A-102 Rev C', 'مثبّت على المخطط A-102 Rev C') : L('No pin yet — place it on the floor plan.', 'لا يوجد دبوس بعد — ضعه على مخطط الطابق.')}</div><button class="cb sm" data-act="pinit"><i class="ti ti-map-pin"></i>${c.pin ? L('Move pin', 'نقل الدبوس') : L('Pin on plan', 'تثبيت على المخطط')}</button></div>
 <label>${L('Photos', 'الصور')}<span class="gal">${c.photos.map(s => ph('', 0, s)).join('')}<button class="phadd" data-act="cphoto"><i class="ti ti-camera"></i>${L('Add photo', 'إضافة صورة')}</button></span></label>
 <label>${L('Assign to company', 'إسناد إلى شركة')}<select id="cco">${cos.map(k => `<option value="${k}"${c.co === k ? ' selected' : ''}>${L(CO[k][0], CO[k][1])} · ${L(CO[k][4], CO[k][5])}</option>`).join('')}</select></label>
 </div></div><div class="compose" style="justify-content:flex-end"><button class="cb" data-close="1">${L('Save as draft', 'حفظ كمسودة')}</button><button class="cb pri" data-act="save"><i class="ti ti-check"></i>${L('Create', 'إنشاء')}</button></div></div></div>`;
  }
  function panel() {
    if (V.modal !== 'panel') return '';
    const s = SRC.mar041;
    const cs = I.filter(i => i.src === 'mar041' && visible(i, V.role));
    const cl = cs.filter(i => i.stage === 'closed').length;
    return `<div class="scrim" data-close="1"><div class="mdl" data-stop><div class="mh"><i class="ti ti-file-text" style="color:var(--ui-muted)"></i><span class="num" style="font-size:12.5px;color:var(--ui-muted);font-weight:600">${s.no}</span><b>${T(s.t)}</b>${cdb('B')}<button class="cb ter sm ic x" data-close="1"><i class="ti ti-x"></i></button></div><div class="mb"><div class="fake box"><h6>${L('Submittal page (context)', 'صفحة التقديم (سياق)')}</h6>${[90, 70, 82, 60, 76, 40].map(w => `<span class="ln" style="width:${w}%"></span>`).join('')}</div>
 <div class="box"><h6><i class="ti ti-message-circle"></i>${L('Comments from Code B', 'التعليقات من Code B')}</h6><div style="display:flex;align-items:baseline;gap:8px"><b style="font:700 24px var(--font-ui)">${cl} ${L('of', 'من')} ${cs.length}</b><span style="font-size:13px;color:var(--ui-muted)">${L('closed', 'مغلقة')}</span></div><div class="pbar"><i style="width:${cs.length ? cl / cs.length * 100 : 0}%"></i></div>
 <div>${cs.map(i => `<div class="cl" data-open="${i.id}"><i class="ti ti-message-circle" style="color:var(--tone-blue-solid)"></i><span class="t">${T(i.t)}</span>${stp(i.stage)}</div>`).join('')}</div><button class="cb sm" data-src="mar041" data-act="closemodal"><i class="ti ti-list"></i>${L('Open in Snag List', 'فتح في قائمة الملاحظات')}</button></div></div></div></div>`;
  }
  function view() {
    const ls = list();
    const empty = !ls.length;
    return `${toolbar()}${empty ? V.empty || !I.some(i => visible(i, V.role)) ? `<div class="empty2"><span class="ic"><i class="ti ti-circle-check"></i></span><h2>${L('No snags. Nice work.', 'لا توجد ملاحظات. عمل رائع.')}</h2><p>${L('Snags and comments appear here when they’re raised on site, from failed inspections or from Code B reviews.', 'تظهر الملاحظات والتعليقات هنا عند تسجيلها في الموقع أو من الفحوصات الراسبة أو من مراجعات Code B.')}</p><div style="display:flex;gap:8px"><button class="cb pri" data-act="new"><i class="ti ti-plus"></i>${L('New Snag', 'ملاحظة جديدة')}</button>${V.empty ? `<button class="cb" data-act="unempty">${L('Show sample data', 'عرض البيانات التجريبية')}</button>` : ''}</div></div>` : `<div class="empty2"><span class="ic" style="background:var(--tone-gray-tint);color:var(--ui-muted)"><i class="ti ti-filter"></i></span><h2>${L('Nothing matches these filters', 'لا شيء يطابق التصفية')}</h2><button class="cb" data-act="clearf">${L('Clear filters', 'مسح التصفية')}</button></div>` : V.view === 'kanban' ? kanban(ls) : listView(ls)}${detail()}${create()}${panel()}${V.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>` : ''}`;
  }
  /* ---- bind ---- */
  function bind(root, R) {
    SNV.R = R;
    let tt;
    const flash = m => {
      V.toast = m;
      R();
      clearTimeout(tt);
      tt = setTimeout(() => {
        V.toast = null;
        R();
      }, 2400);
    };
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.multiple = true;
    file.style.display = 'none';
    document.body.appendChild(file);
    let fileT = null;
    file.addEventListener('change', () => {
      [...file.files].forEach(f => {
        const rd = new FileReader();
        rd.onload = () => {
          (fileT === 'after' ? V.draft.photos : V.create.photos).push(rd.result);
          R();
        };
        rd.readAsDataURL(f);
      });
      file.value = '';
    });
    const keep = () => {
      const g = id => document.getElementById(id);
      if (V.draft) {
        const n = g('fixnote') || g('ronote');
        if (n) V.draft.note = n.value;
      }
      if (V.create) {
        if (g('ct')) V.create.title = g('ct').value;
        if (g('cd')) V.create.desc = g('cd').value;
        if (g('cf')) V.create.f = g('cf').value;
        if (g('cco')) V.create.co = g('cco').value;
      }
      const m = g('cmsg');
      if (m) V.cm = m.value;
    };
    const hist = (it, a, note) => {
      it.hist.push({
        a,
        by: R0().me,
        w: 0,
        note
      });
      it.wk = 0.2;
    };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-menu],[data-fk],[data-type],[data-role],[data-view],[data-exp],[data-demo],[data-src],[data-act],[data-sel],[data-grp],[data-open],[data-close],[data-dtab],[data-do],[data-bre],[data-bst],[data-ctype],[data-ctr],[data-srcopen],[data-gb]');
      if (!b) {
        if (V.menu && !e.target.closest('[data-stop]')) {
          V.menu = null;
          R();
        }
        return;
      }
      if (b.closest('.hd,.tabs,.sb')) return;
      const d = b.dataset;
      keep();
      if (d.close !== undefined) {
        if (e.target.closest('[data-stop]') && !b.closest('button')) return;
        V.det = null;
        V.create = null;
        V.modal = null;
        V.act = null;
        return R();
      }
      if (d.menu) {
        e.stopPropagation();
        V.menu = V.menu === d.menu ? null : d.menu;
        return R();
      }
      if (d.fk) {
        const [k, v] = d.fk.split(':');
        V.F[k].has(v) ? V.F[k].delete(v) : V.F[k].add(v);
        return R();
      }
      if (d.type) {
        V.type = d.type;
        return R();
      }
      if (d.gb) {
        V.gb = d.gb;
        V.menu = null;
        return R();
      }
      if (d.role) {
        V.role = d.role;
        V.menu = null;
        V.sel.clear();
        V.F.co = new Set();
        return R();
      }
      if (d.view) {
        if (d.view === 'plan') {
          location.href = 'plan-view.html';
          return;
        }
        V.view = d.view;
        return R();
      }
      if (d.exp) {
        V.menu = null;
        if (d.exp === 'pdf') return flash(L('Snag report PDF is being prepared…', 'جارٍ إعداد تقرير الملاحظات PDF…'));
        const ls = V.sel.size ? list().filter(i => V.sel.has(i.id)) : list();
        const rows = [['Number', 'Title', 'Type', 'Trade', 'Location', 'Raised from', 'Assigned to', 'Company', 'Stage', 'Weeks'], ...ls.map(i => [i.no, i.t[0], TYP[i.type].en, TR[i.tr][0], LOCS[i.f][0] + ' / ' + SPACES[i.sp][0], i.src ? SRC[i.src].no : 'Manual', PPL[i.who][0], CO[i.co][0], STG[i.stage].en, Math.round(i.wk)])];
        const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Snag List"><Table>${rows.map(r => `<Row>${r.map(c => `<Cell><Data ss:Type="String">${x(c)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([xml], {
          type: 'application/vnd.ms-excel'
        }));
        a.download = 'rabaed-snag-list.xls';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return flash(L(`Exported ${ls.length} items`, `تم تصدير ${ls.length} عنصر`));
      }
      if (d.src !== undefined && !d.srcopen) {
        V.fsel = {
          src: d.src ? [d.src] : []
        };
        V.menu = null;
        if (d.act === 'closemodal') V.modal = null;
        return R();
      }
      if (d.srcopen) {
        e.stopPropagation();
        return flash(L(`Opening ${SRC[d.srcopen].no}…`, `جارٍ فتح ${SRC[d.srcopen].no}…`));
      }
      if (d.sel) {
        e.stopPropagation();
        V.sel.has(d.sel) ? V.sel.delete(d.sel) : V.sel.add(d.sel);
        return R();
      }
      if (d.grp) {
        V.open[d.grp] = V.open[d.grp] === false;
        return R();
      }
      if (d.open) {
        V.det = d.open;
        V.tab = 'det';
        V.act = null;
        V.modal = null;
        V.cm = '';
        return R();
      }
      if (d.dtab) {
        V.tab = d.dtab;
        V.cm = '';
        return R();
      }
      if (d.do) {
        const it = I.find(x => x.id === V.det);
        it.stage = d.do;
        hist(it, d.do);
        return flash(L(`${it.no} → ${STG[d.do].en}`, `${it.no} ← ${STG[d.do].ar}`));
      }
      if (d.bre) {
        V.menu = null;
        const n = V.sel.size;
        list().filter(i => V.sel.has(i.id)).forEach(i => {
          i.who = d.bre;
          i.co = PPL[d.bre][2];
        });
        V.sel.clear();
        return flash(L(`Reassigned ${n} to ${PPL[d.bre][0]}`, `تمت إعادة إسناد ${n} إلى ${PPL[d.bre][1]}`));
      }
      if (d.bst) {
        V.menu = null;
        const n = V.sel.size;
        list().filter(i => V.sel.has(i.id)).forEach(i => {
          i.stage = d.bst;
          hist(i, d.bst === 'open' ? 'reopen' : d.bst);
        });
        V.sel.clear();
        return flash(L(`Moved ${n} to ${STG[d.bst].en}`, `تم نقل ${n} إلى ${STG[d.bst].ar}`));
      }
      if (d.ctype) {
        V.create.type = d.ctype;
        return R();
      }
      if (d.ctr) {
        V.create.tr = d.ctr;
        return R();
      }
      if (d.demo) {
        V.menu = null;
        V.empty = false;
        const f = no => I.find(x => x.no === no).id;
        if (d.demo === 'cmt') {
          V.role = 'admin';
          V.det = f('TWR-DCL-EL-CMT-004');
          V.tab = 'det';
          V.act = null;
        }
        if (d.demo === 'resolve') {
          V.role = 'tmc';
          const it = I.find(x => x.no === 'TWR-TMC-EL-SNG-014');
          if (it.stage === 'res' || it.stage === 'closed') it.stage = 'open';
          V.det = it.id;
          V.tab = 'det';
          V.act = 'resolve';
          V.draft = {
            note: 'Bonding jumpers installed at all 3 joints; continuity re-tested at 0.05 Ω.',
            photos: [],
            err: false
          };
        }
        if (d.demo === 'verify') {
          V.role = 'dcl';
          V.det = f('TWR-DCL-EL-CMT-003');
          V.tab = 'det';
          V.act = null;
        }
        if (d.demo === 'panel') {
          V.modal = 'panel';
          V.det = null;
        }
        if (d.demo === 'empty') {
          V.empty = true;
          V.det = null;
        }
        return R();
      }
      const a = d.act;
      if (a === 'mine') {
        V.F.mine = !V.F.mine;
        return R();
      }
      if (a === 'clearf') {
        V.F = {
          tr: new Set(),
          fl: new Set(),
          co: new Set(),
          st: new Set(),
          mine: false,
          src: ''
        };
        V.fsel = {};
        V.type = 'all';
        V.q = '';
        FPop.close();
        return R();
      }
      if (a === 'selall') {
        const ls = list();
        if (V.sel.size === ls.length) V.sel.clear();else ls.forEach(i => V.sel.add(i.id));
        return R();
      }
      if (a === 'clrsel') {
        V.sel.clear();
        return R();
      }
      if (a === 'unempty') {
        V.empty = false;
        return R();
      }
      if (a === 'new') {
        V.create = {
          type: 'snag',
          title: '',
          desc: '',
          tr: 'EL',
          f: '02',
          pin: null,
          photos: [],
          co: R0().sees ? R0().sees[0] : 'tmc',
          err: false,
          saved: false
        };
        return R();
      }
      if (a === 'pinit') {
        V.create.pin = [300 + Math.round(Math.random() * 600), 120 + Math.round(Math.random() * 500)];
        V.create.saved = true;
        return R();
      }
      if (a === 'cphoto') {
        fileT = 'create';
        return file.click();
      }
      if (a === 'afterphoto') {
        fileT = 'after';
        return file.click();
      }
      if (a === 'save') {
        const c = V.create;
        if (!c.title.trim()) {
          c.err = true;
          R();
          document.getElementById('ct').focus();
          return;
        }
        const k = CO[c.co][3] + '-' + c.tr + '-' + TYP[c.type].code;
        const nn = I.filter(i => i.no.startsWith('TWR-' + k)).length + 30;
        const it = {
          id: 'n' + Date.now(),
          no: 'TWR-' + k + '-' + String(nn).padStart(3, '0'),
          type: c.type,
          t: [c.title, c.title],
          desc: c.desc ? [c.desc, c.desc] : null,
          tr: c.tr,
          f: c.f,
          sp: 0,
          co: c.co,
          who: Object.keys(PPL).find(p => PPL[p][2] === c.co),
          stage: 'open',
          wk: 0.2,
          photos: c.photos.length,
          img: c.photos[0],
          src: null,
          pin: c.pin,
          chat: [],
          internal: [],
          hist: [{
            a: 'create',
            by: R0().me,
            w: 0
          }]
        };
        I.unshift(it);
        V.create = null;
        V.det = it.id;
        V.tab = 'det';
        return flash(L(`${it.no} created`, `تم إنشاء ${it.no}`));
      }
      if (a === 'resolveform') {
        V.act = 'resolve';
        V.draft = {
          note: '',
          photos: [],
          err: false
        };
        return R();
      }
      if (a === 'reopenform') {
        V.act = 'reopen';
        V.draft = {
          note: '',
          err: false
        };
        return R();
      }
      if (a === 'cancelact') {
        V.act = null;
        return R();
      }
      if (a === 'doresolve') {
        if (!V.draft.note.trim()) {
          V.draft.err = true;
          return R();
        }
        const it = I.find(x => x.id === V.det);
        it.stage = 'res';
        it.after = {
          note: [V.draft.note, V.draft.note],
          photos: V.draft.photos.length,
          imgs: V.draft.photos
        };
        hist(it, 'res');
        V.act = null;
        return flash(L('Sent to the consultant for verification', 'أُرسلت للاستشاري للتحقق'));
      }
      if (a === 'doreopen') {
        if (!V.draft.note.trim()) {
          V.draft.err = true;
          return R();
        }
        const it = I.find(x => x.id === V.det);
        it.stage = 'open';
        hist(it, 'reopen', V.draft.note);
        it.chat.push({
          by: R0().me,
          t: [V.draft.note, V.draft.note],
          w: 0
        });
        V.act = null;
        return flash(L(`${it.no} re-opened`, `أُعيد فتح ${it.no}`));
      }
      if (a === 'send') {
        if (!V.cm.trim()) return;
        const it = I.find(x => x.id === V.det);
        (V.tab === 'int' ? it.internal : it.chat).push({
          by: R0().me,
          t: [V.cm, V.cm],
          w: 0
        });
        V.cm = '';
        R();
        const db = document.getElementById('dbody');
        if (db) db.scrollTop = db.scrollHeight;
        return;
      }
    });
    root.addEventListener('input', e => {
      if (e.target.id === 'snq') {
        V.q = e.target.value;
        const p = e.target.selectionStart;
        R();
        const n = document.getElementById('snq');
        n.focus();
        n.setSelectionRange(p, p);
      }
      if (e.target.id === 'ct' && V.create) {
        V.create.saved = true;
      }
    });
    root.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id === 'cmsg') {
        keep();
        root.querySelector('[data-act=send]')?.click();
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && (V.det || V.create || V.modal || V.menu)) {
        V.det = null;
        V.create = null;
        V.modal = null;
        V.menu = null;
        R();
      }
    });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-fpop="sn"]');
    if (!b) return;
    e.stopPropagation();
    if (FPop.isOpen()) {
      FPop.close();
      return;
    }
    FPop.open(b, {
      L,
      fields: fields(),
      saved: SNSAVED,
      preset: SNPRESET,
      sel: JSON.parse(JSON.stringify(V.fsel)),
      onChange: sel => {
        V.fsel = JSON.parse(JSON.stringify(sel));
        V.sel.clear();
        SNV.R && SNV.R();
        const nb = document.querySelector('[data-fpop="sn"]');
        if (nb) {
          FPop.btn = nb;
          FPop.place();
        }
      }
    });
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !(e.target.closest && e.target.closest('input,textarea'))) {
      const i = document.getElementById('snq');
      if (i) {
        e.preventDefault();
        i.focus();
      }
    }
  });
  window.SNV = {
    V,
    view,
    bind
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/snag/snag.js", error: String((e && e.message) || e) }); }

// ui_kits/app/wf/data.js
try { (() => {
// Workflows — data + diagram renderer. Exposes window.WF.
(function () {
  const STG = {
    drafts: ['Drafts', 'المسودات', 'gray'],
    internal: ['Internal Review', 'مراجعة داخلية', 'blue'],
    pending: ['Pending Approval', 'بانتظار الاعتماد', 'violet'],
    ends: ['Outcome', 'النتيجة', 'green']
  };
  const BANDS = [['drafts', 0, 250], ['internal', 250, 500], ['pending', 500, 1070], ['ends', 1070, 1320]];
  const END = {
    A: ['Approved', 'معتمد', 'green', 'ti-check'],
    C: ['Revise & Resubmit', 'مراجعة وإعادة تقديم', 'orange', 'ti-refresh'],
    D: ['Rejected', 'مرفوض', 'red', 'ti-x'],
    X: ['Cancelled', 'ملغى', 'gray', 'ti-ban']
  };
  const CO = {
    ctr: ['TMC Constructions', 'تي إم سي للمقاولات', 'Contractor', 'المقاول'],
    cns: ['Design Consultants LLC', 'ديزاين للاستشارات', 'Consultant', 'الاستشاري'],
    own: ['Al Futtaim PMC', 'الفطيم لإدارة المشاريع', 'Owner Representative', 'ممثل المالك']
  };
  const S0 = {
    s1: {
      en: 'Contractor Engineer',
      ar: 'مهندس المقاول',
      stage: 'drafts',
      co: 'ctr',
      perm: 'Create',
      out: 'none',
      x: 30,
      y: 250,
      ic: 'ti-user'
    },
    s2: {
      en: 'Contractor PM review',
      ar: 'مراجعة مدير مشروع المقاول',
      stage: 'internal',
      co: 'ctr',
      perm: 'Review',
      out: 'none',
      x: 280,
      y: 250,
      ic: 'ti-user-check'
    },
    s3: {
      en: 'Consultant Engineer review',
      ar: 'مراجعة مهندس الاستشاري',
      stage: 'pending',
      co: 'cns',
      perm: 'Review',
      out: 'recommend',
      x: 530,
      y: 130,
      ic: 'ti-user-search'
    },
    s4: {
      en: 'Consultant Manager decision',
      ar: 'قرار مدير الاستشاري',
      stage: 'pending',
      co: 'cns',
      perm: 'Approve',
      out: 'final',
      x: 810,
      y: 130,
      ic: 'ti-gavel'
    },
    s5: {
      en: 'Owner Representative approval',
      ar: 'اعتماد ممثل المالك',
      stage: 'pending',
      co: 'own',
      perm: 'Approve',
      out: 'none',
      x: 810,
      y: 420,
      ic: 'ti-building',
      cond: 1
    },
    eA: {
      end: 'A',
      x: 1110,
      y: 70
    },
    eC: {
      end: 'C',
      x: 1110,
      y: 230
    },
    eD: {
      end: 'D',
      x: 1110,
      y: 380
    },
    eX: {
      end: 'X',
      x: 1110,
      y: 540
    }
  };
  const T0 = {
    t1: {
      f: 's1',
      to: 's2',
      en: 'Send for Review',
      ar: 'إرسال للمراجعة',
      type: 'send'
    },
    t2: {
      f: 's2',
      to: 's1',
      en: 'Return',
      ar: 'إرجاع',
      type: 'return'
    },
    t3: {
      f: 's2',
      to: 's3',
      en: 'Submit',
      ar: 'تقديم',
      type: 'submit',
      sign: 1
    },
    t4: {
      f: 's3',
      to: 's4',
      en: 'Send to Manager',
      ar: 'إرسال للمدير',
      type: 'send'
    },
    t5: {
      f: 's4',
      to: 's3',
      en: 'Return to Engineer',
      ar: 'إرجاع للمهندس',
      type: 'return'
    },
    t6: {
      f: 's4',
      to: 'eA',
      en: 'Approve – Code A',
      ar: 'اعتماد – Code A',
      type: 'close',
      code: 'A',
      sign: 1
    },
    t7: {
      f: 's4',
      to: 'eA',
      en: 'Approve with Comments – Code B',
      ar: 'اعتماد مع ملاحظات – Code B',
      type: 'close',
      code: 'B',
      sign: 1
    },
    t8: {
      f: 's4',
      to: 'eC',
      en: 'Revise & Resubmit – Code C',
      ar: 'مراجعة وإعادة تقديم – Code C',
      type: 'close',
      code: 'C',
      sign: 1
    },
    t9: {
      f: 's4',
      to: 'eD',
      en: 'Reject – Code D',
      ar: 'رفض – Code D',
      type: 'close',
      code: 'D',
      sign: 1
    },
    t10: {
      f: 's4',
      to: 's5',
      en: 'Send to Owner Rep',
      ar: 'إرسال لممثل المالك',
      type: 'submit',
      sign: 1,
      cond: [{
        f: 'cost_impact',
        op: '>',
        v: '500000'
      }]
    },
    t11: {
      f: 's5',
      to: 'eA',
      en: 'Owner Approve',
      ar: 'اعتماد المالك',
      type: 'close',
      code: 'A',
      sign: 1
    },
    t12: {
      f: 's5',
      to: 's4',
      en: 'Owner Return',
      ar: 'إرجاع المالك',
      type: 'return'
    },
    t13: {
      f: 's1',
      to: 'eX',
      en: 'Cancel',
      ar: 'إلغاء',
      type: 'cancel'
    }
  };
  const FIELDS = ['cost_impact', 'trade', 'location', 'quantity', 'supplier'];
  const v1S = ['s1', 's2', 's4', 'eA', 'eC', 'eD', 'eX'],
    v1T = ['t1', 't2', 't3v1', 't6', 't7', 't8', 't9', 't13'];
  T0.t3v1 = Object.assign({}, T0.t3, {
    to: 's4'
  });
  const clone = o => JSON.parse(JSON.stringify(o));
  const pick = (ids, src) => Object.fromEntries(ids.map(i => [i, clone(src[i])]));
  const v2S = [...v1S, 's3'],
    v2T = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't13'];
  const v3S = [...v2S, 's5'],
    v3T = [...v2T, 't10', 't11', 't12'];
  const S1 = pick(v1S, S0);
  S1.s4.x = 530;
  S1.s4.y = 160;
  const VERS = [{
    v: 1,
    st: 'pub',
    by: 'Sara Al Mansoori',
    date: '11 Jan 2026',
    note: ['Initial workflow: Engineer → PM → Consultant Manager.', 'سير العمل الأولي: المهندس ← المدير ← مدير الاستشاري.'],
    run: 2,
    S: S1,
    T: pick(v1T, T0)
  }, {
    v: 2,
    st: 'pub',
    by: 'Sara Al Mansoori',
    date: '02 Apr 2026',
    note: ['Added Consultant Engineer review before the manager.', 'إضافة مراجعة مهندس الاستشاري قبل المدير.'],
    run: 14,
    S: pick(v2S, S0),
    T: pick(v2T, T0)
  }, {
    v: 3,
    st: 'pub',
    by: 'Mohammed Al Shamsi',
    date: '14 Aug 2026',
    note: ['Owner Representative approval when cost impact > 500,000 SAR.', 'اعتماد ممثل المالك عندما يتجاوز أثر التكلفة 500,000 ريال.'],
    run: 31,
    S: pick(v3S, S0),
    T: pick(v3T, T0)
  }];
  // v4 draft: seeded with issues for validation demo
  const d4 = {
    S: pick(v3S, S0),
    T: pick(v3T, T0)
  };
  d4.T.t11.sign = 0;
  d4.T.t10.cond = [{
    f: 'cost_impact_sar',
    op: '>',
    v: '500000'
  }];
  d4.S.s6 = {
    en: 'Consultant QA check',
    ar: 'تدقيق الجودة للاستشاري',
    stage: 'pending',
    co: 'cns',
    perm: 'Review',
    out: 'none',
    x: 530,
    y: 420,
    ic: 'ti-clipboard-check'
  };
  d4.T.t14 = {
    f: 's3',
    to: 's6',
    en: 'Send to QA',
    ar: 'إرسال للجودة',
    type: 'send'
  };
  d4.T.t15 = {
    f: 's2',
    to: 's3',
    en: 'Return to Consultant',
    ar: 'إرجاع للاستشاري',
    type: 'return'
  };
  VERS.push({
    v: 4,
    st: 'draft',
    by: 'Sara Al Mansoori',
    date: '—',
    note: ['', ''],
    run: 0,
    S: d4.S,
    T: d4.T
  });
  const LIB = {
    project: [{
      id: 'mat',
      en: 'Material Submittal – 2-tier review',
      ar: 'اعتماد المواد – مراجعة على مستويين',
      types: ['MAR', 'SAR'],
      runs: [2, 14, 31],
      draft: 4,
      by: 'Mohammed Al Shamsi',
      date: '14 Aug 2026',
      live: 1
    }, {
      id: 'doc',
      en: 'Document Review – single tier',
      ar: 'مراجعة المستندات – مستوى واحد',
      types: ['DAR'],
      runs: [0, 9],
      by: 'Sara Al Mansoori',
      date: '03 Jun 2026'
    }, {
      id: 'ir',
      en: 'Inspection Request – site inspection',
      ar: 'طلب الفحص – فحص الموقع',
      types: ['IR'],
      runs: [22],
      by: 'Sara Al Mansoori',
      date: '20 Feb 2026'
    }],
    company: [{
      id: 'c1',
      en: 'Material Submittal – 2-tier review',
      ar: 'اعتماد المواد – مراجعة على مستويين',
      types: [],
      runs: [],
      by: 'Sara Al Mansoori',
      date: '14 Aug 2026',
      lib: 1
    }, {
      id: 'c2',
      en: 'Shop Drawing – with Owner sign-off',
      ar: 'المخططات التنفيذية – مع توقيع المالك',
      types: [],
      runs: [],
      by: 'Ahmed bin Said',
      date: '09 Jul 2026',
      lib: 1
    }],
    rabaed: [{
      id: 'r1',
      en: 'Submittal – single consultant review',
      ar: 'تقديم – مراجعة استشاري واحدة',
      types: [],
      runs: [],
      by: 'Rabaed',
      date: '—',
      ro: 1
    }, {
      id: 'r2',
      en: 'Submittal – 2-tier review',
      ar: 'تقديم – مراجعة على مستويين',
      types: [],
      runs: [],
      by: 'Rabaed',
      date: '—',
      ro: 1
    }, {
      id: 'r3',
      en: 'Inspection Request – standard',
      ar: 'طلب فحص – قياسي',
      types: [],
      runs: [],
      by: 'Rabaed',
      date: '—',
      ro: 1
    }, {
      id: 'r4',
      en: 'Snag – fix & verify',
      ar: 'ملاحظة – إصلاح وتحقق',
      types: [],
      runs: [],
      by: 'Rabaed',
      date: '—',
      ro: 1
    }]
  };
  /* ---------- renderer ---------- */
  const W = 1320,
    H = 660,
    CW = 200,
    CH = 78,
    EW = 170,
    EH = 46;
  const box = s => s.end ? {
    w: EW,
    h: EH
  } : {
    w: CW,
    h: CH
  };
  function renderDiagram(o) {
    const L = o.L,
      S = o.S,
      T = o.T,
      rtl = o.rtl;
    const fx = (x, w) => rtl ? W - x - w : x;
    const hidden = o.hide || {};
    const grp = o.groups || [];
    const pos = id => {
      const g = grp.find(g => g.ids.includes(id));
      if (g) return {
        x: g.x,
        y: g.y,
        w: g.w,
        h: g.h
      };
      const s = S[id],
        b = box(s);
      return {
        x: fx(s.x, b.w),
        y: s.y,
        w: b.w,
        h: b.h
      };
    };
    const bands = BANDS.map(([k, a, b]) => {
      const c = STG[k][2];
      const x = rtl ? W - b : a;
      return `<div class="wb" style="left:${x}px;width:${b - a}px;background:var(--tone-${c}-tint)"><span style="color:var(--tone-${c}-fg)">${L(STG[k][0], STG[k][1])}</span></div>`;
    }).join('');
    const pairs = {};
    const edges = [],
      labels = [];
    Object.entries(T).forEach(([id, t]) => {
      if (!S[t.f] || !S[t.to]) return;
      if (hidden[id]) return;
      const a = pos(t.f),
        b = pos(t.to);
      const k = [t.f, t.to].sort().join('|');
      const n = (pairs[k] = (pairs[k] || 0) + 1) - 1;
      const back = rtl ? a.x < b.x : a.x > b.x;
      const same = Math.abs(a.x - b.x) < 5;
      let d, lx, ly;
      const off = n * 24;
      if (same) {
        const x1 = a.x + a.w / 2,
          y1 = a.y + (a.y < b.y ? a.h : 0),
          x2 = b.x + b.w / 2,
          y2 = b.y + (a.y < b.y ? 0 : b.h);
        d = `M${x1 + (n ? 20 : 0)} ${y1} L${x2 + (n ? 20 : 0)} ${y2}`;
        lx = x1 + (n ? 20 : 0);
        ly = (y1 + y2) / 2;
      } else if (!back) {
        const x1 = rtl ? a.x : a.x + a.w,
          y1 = a.y + a.h / 2 + off - (n ? 12 : 0),
          x2 = rtl ? b.x + b.w : b.x,
          y2 = b.y + b.h / 2 + (n ? off / 2 : 0);
        const m = (x1 + x2) / 2;
        d = `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;
        lx = m;
        ly = (y1 + y2) / 2;
      } else {
        const x1 = a.x + a.w / 2,
          y1 = a.y + a.h,
          x2 = b.x + b.w / 2,
          y2 = b.y + b.h;
        const yy = Math.max(y1, y2) + 44 + off;
        d = `M${x1} ${y1} C${x1} ${yy} ${x2} ${yy} ${x2} ${y2}`;
        lx = (x1 + x2) / 2;
        ly = yy - 10;
      }
      const cl = o.ecls && o.ecls[id] || '';
      const sel = o.sel === id ? ' sel' : '';
      const col = t.type === 'return' ? 'var(--tone-orange-solid)' : t.type === 'submit' ? 'var(--btn-pri)' : t.code ? `var(--tone-${t.code === 'C' ? 'orange' : t.code === 'D' ? 'red' : 'green'}-solid)` : t.type === 'cancel' ? 'var(--tone-gray-solid)' : 'var(--ui-text-2)';
      edges.push(`<path class="we ${cl}${sel}" d="${d}" style="--ec:${col}" marker-end="url(#wa)"${t.type === 'return' ? ' stroke-dasharray="6 4"' : ''}></path><path class="wh" d="${d}" data-t="${id}"></path>`);
      labels.push(`<button class="wl ${cl}${sel}" data-t="${id}" style="left:${lx}px;top:${ly}px;--ec:${col}">${t.sign ? '<i class="ti ti-signature"></i>' : ''}${t.cond ? '<i class="ti ti-filter"></i>' : ''}${esc(L(t.en, t.ar))}</button>`);
    });
    const cards = Object.entries(S).map(([id, s]) => {
      if (grp.some(g => g.ids.includes(id)) || hidden[id]) return '';
      const p = pos(id);
      const cl = (o.scls && o.scls[id] || '') + (o.sel === id ? ' sel' : '');
      const an = o.annot && o.annot[id];
      if (s.end) {
        const e = END[s.end];
        return `<div class="wn wend ${cl}" data-s="${id}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--nc:var(--tone-${e[2]}-solid);--nt:var(--tone-${e[2]}-tint)"><i class="ti ${e[3]}"></i>${L(e[0], e[1])}${an ? `<small>${an}</small>` : ''}</div>`;
      }
      return `<div class="wn ${cl}" data-s="${id}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;min-height:${p.h}px;--nc:var(--tone-${STG[s.stage][2]}-solid)"><span class="ic"><i class="ti ${s.ic || 'ti-user'}"></i></span><div class="tx"><b>${esc(L(s.en, s.ar))}</b><small>${L(CO[s.co][2], CO[s.co][3])} · ${s.perm}</small>${s.out !== 'none' && !o.hideOut ? `<span class="om">${s.out === 'recommend' ? L('Recommends code', 'يوصي بالرمز') : s.out === 'final' ? L('Issues final code', 'يصدر الرمز النهائي') : L('Inspection result', 'نتيجة الفحص')}</span>` : ''}${an ? `<div class="an">${an}</div>` : ''}</div>${s.cond ? '<span class="cd"><i class="ti ti-filter"></i></span>' : ''}</div>`;
    }).join('');
    const gh = grp.map(g => `<div class="wn wgrp ${g.cls || ''}" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px"><span class="ic"><i class="ti ti-lock"></i></span><div class="tx"><b>${esc(g.title)}</b><small>${esc(g.sub)}</small>${g.an ? `<div class="an">${g.an}</div>` : ''}</div></div>`).join('');
    return `<div class="wworld" style="width:${W}px;height:${H}px">${bands}<svg class="wsvg" viewBox="0 0 ${W} ${H}"><defs><marker id="wa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"></path></marker></defs>${edges.join('')}</svg>${gh}${cards}${labels.join('')}</div>`;
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // Snag + Daily Site Report workflows
  const SNAGWF = {
    S: {
      o: {
        en: 'Open',
        ar: 'مفتوح',
        stage: 'drafts',
        co: 'ctr',
        perm: 'Fix',
        out: 'none',
        x: 30,
        y: 250,
        ic: 'ti-alert-triangle'
      },
      p: {
        en: 'In Progress',
        ar: 'قيد التنفيذ',
        stage: 'internal',
        co: 'ctr',
        perm: 'Fix',
        out: 'none',
        x: 280,
        y: 250,
        ic: 'ti-tool'
      },
      c: {
        en: 'Done · under confirmation',
        ar: 'منجز · قيد التأكيد',
        stage: 'pending',
        co: 'cns',
        perm: 'Verify',
        out: 'none',
        x: 560,
        y: 250,
        ic: 'ti-user-check'
      },
      r: {
        en: 'Reopened',
        ar: 'أعيد فتحه',
        stage: 'pending',
        co: 'ctr',
        perm: 'Fix',
        out: 'none',
        x: 560,
        y: 470,
        ic: 'ti-refresh'
      },
      eA: {
        end: 'A',
        x: 1110,
        y: 266
      }
    },
    T: {
      a: {
        f: 'o',
        to: 'p',
        en: 'Start work',
        ar: 'بدء العمل',
        type: 'send'
      },
      b: {
        f: 'p',
        to: 'c',
        en: 'Mark done',
        ar: 'تحديد كمنجز',
        type: 'submit',
        sign: 1
      },
      c: {
        f: 'c',
        to: 'eA',
        en: 'Confirm & close',
        ar: 'تأكيد وإغلاق',
        type: 'close',
        sign: 1
      },
      d: {
        f: 'c',
        to: 'r',
        en: 'Reopen',
        ar: 'إعادة فتح',
        type: 'return'
      },
      e: {
        f: 'r',
        to: 'p',
        en: 'Resume work',
        ar: 'استئناف العمل',
        type: 'send'
      }
    }
  };
  const DSRWF = {
    S: {
      d: {
        en: 'Site Engineer · draft',
        ar: 'مهندس الموقع · مسودة',
        stage: 'drafts',
        co: 'ctr',
        perm: 'Create',
        out: 'none',
        x: 30,
        y: 250,
        ic: 'ti-report'
      },
      r1: {
        en: 'Site Manager review',
        ar: 'مراجعة مدير الموقع',
        stage: 'internal',
        co: 'ctr',
        perm: 'Review',
        out: 'none',
        x: 280,
        y: 250,
        ic: 'ti-user-check'
      },
      r2: {
        en: 'Consultant review',
        ar: 'مراجعة الاستشاري',
        stage: 'pending',
        co: 'cns',
        perm: 'Review',
        out: 'none',
        x: 560,
        y: 170,
        ic: 'ti-user-search'
      },
      r3: {
        en: 'Owner Rep review',
        ar: 'مراجعة ممثل المالك',
        stage: 'pending',
        co: 'own',
        perm: 'Review',
        out: 'none',
        x: 810,
        y: 330,
        ic: 'ti-building'
      },
      eA: {
        end: 'A',
        x: 1110,
        y: 266
      }
    },
    T: {
      a: {
        f: 'd',
        to: 'r1',
        en: 'Send for review',
        ar: 'إرسال للمراجعة',
        type: 'send'
      },
      b: {
        f: 'r1',
        to: 'r2',
        en: 'Submit',
        ar: 'تقديم',
        type: 'submit',
        sign: 1
      },
      c: {
        f: 'r2',
        to: 'r3',
        en: 'Reviewed',
        ar: 'تمت المراجعة',
        type: 'submit'
      },
      d: {
        f: 'r3',
        to: 'eA',
        en: 'Reviewed · file',
        ar: 'تمت المراجعة · أرشفة',
        type: 'close',
        sign: 1
      },
      e: {
        f: 'r1',
        to: 'd',
        en: 'Return',
        ar: 'إرجاع',
        type: 'return'
      }
    }
  };
  LIB.project.push({
    id: 'snag',
    en: 'Snag – fix & confirm',
    ar: 'الملاحظة – إصلاح وتأكيد',
    types: ['SNG', 'CMT'],
    runs: [38],
    by: 'Sara Al Mansoori',
    date: '10 Mar 2026',
    wf: SNAGWF
  }, {
    id: 'dsr',
    en: 'Daily Site Report – review chain',
    ar: 'تقرير الموقع اليومي – سلسلة مراجعة',
    types: ['DSR'],
    runs: [112],
    by: 'Sara Al Mansoori',
    date: '10 Mar 2026',
    wf: DSRWF
  });
  window.WF = {
    SNAGWF,
    DSRWF,
    STG,
    BANDS,
    END,
    CO,
    S0,
    T0,
    FIELDS,
    VERS,
    LIB,
    W,
    H,
    CW,
    CH,
    renderDiagram,
    clone,
    box
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/wf/data.js", error: String((e && e.message) || e) }); }

// ui_kits/app/wf/view.js
try { (() => {
// Part B — View workflow inside a submittal. Exposes window.WV.
(function () {
  const S = RS.S,
    {
      END,
      CO,
      VERS,
      W,
      H,
      renderDiagram,
      box
    } = WF;
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  const P = {
    hafiz: ['Hafiz Hamdan', 'حافظ حمدان', 'ctr', 'Contractor Engineer', 'مهندس المقاول'],
    ali: ['Ali Sonour', 'علي سنور', 'ctr', 'Contractor PM', 'مدير مشروع المقاول'],
    ahmed: ['Ahmed bin Said', 'أحمد بن سعيد', 'cns', 'Consultant Engineer', 'مهندس الاستشاري'],
    shamsi: ['Mohammed Al Shamsi', 'محمد الشامسي', 'cns', 'Consultant Manager', 'مدير الاستشاري'],
    hassan: ['Hassan Al Marri', 'حسن المري', 'own', 'Owner Representative', 'ممثل المالك']
  };
  const VIEW = {
    ctrpm: {
      en: 'Contractor PM (Ali)',
      ar: 'مدير المقاول (علي)',
      co: 'ctr',
      me: 'ali'
    },
    ctr: {
      en: 'Contractor Engineer',
      ar: 'مهندس المقاول',
      co: 'ctr',
      me: 'hafiz'
    },
    cns: {
      en: 'Consultant Manager',
      ar: 'مدير الاستشاري',
      co: 'cns',
      me: 'shamsi'
    },
    own: {
      en: 'Owner Rep',
      ar: 'ممثل المالك',
      co: 'own',
      me: 'hassan'
    }
  };
  // scenarios: path = [{s, by, t (transition taken out of s), at, sign, rec}]
  const SC = {
    internal: {
      no: 'TWR-TMC-EL-MAR-052',
      t: ['Cable Trays & Supports', 'حوامل ودعامات الكابلات'],
      rev: 0,
      v: 3,
      stage: ['Internal Review', 'مراجعة داخلية', 'blue'],
      path: [{
        s: 's1',
        by: 'hafiz',
        t: 't1',
        at: '23/09/2026 10:02'
      }],
      cur: 's2',
      holder: 'ali',
      wk: 1
    },
    pending: {
      no: 'TWR-TMC-EL-MAR-041',
      t: ['Lighting Fixtures', 'وحدات الإنارة'],
      rev: 1,
      v: 2,
      stage: ['Pending Approval', 'بانتظار الاعتماد', 'violet'],
      path: [{
        s: 's1',
        by: 'hafiz',
        t: 't1',
        at: '12/06/2025 09:14'
      }, {
        s: 's2',
        by: 'ali',
        t: 't2',
        at: '15/06/2025 11:40',
        ret: 1
      }, {
        s: 's1',
        by: 'hafiz',
        t: 't1',
        at: '17/06/2025 08:55'
      }, {
        s: 's2',
        by: 'ali',
        t: 't3',
        at: '19/06/2025 16:19',
        sign: 1
      }, {
        s: 's3',
        by: 'ahmed',
        t: 't4',
        at: '24/06/2025 13:05',
        rec: 'B'
      }],
      cur: 's4',
      pool: ['shamsi', 'ahmed'],
      wk: 2
    },
    closed: {
      no: 'TWR-TMC-EL-MAR-041',
      t: ['Lighting Fixtures', 'وحدات الإنارة'],
      rev: 0,
      v: 2,
      stage: ['Revise & Resubmit', 'مراجعة وإعادة تقديم', 'orange'],
      path: [{
        s: 's1',
        by: 'hafiz',
        t: 't1',
        at: '02/06/2025 09:30'
      }, {
        s: 's2',
        by: 'ali',
        t: 't3',
        at: '04/06/2025 15:10',
        sign: 1
      }, {
        s: 's3',
        by: 'ahmed',
        t: 't4',
        at: '10/06/2025 12:00',
        rec: 'C'
      }, {
        s: 's4',
        by: 'shamsi',
        t: 't8',
        at: '21/06/2025 10:22',
        sign: 1
      }],
      cur: 'eC',
      wk: 0
    }
  };
  const X = {
    view: 'ctr',
    sc: 'pending',
    open: false,
    phone: false,
    peek: false,
    toast: null
  };
  const ageDots = w => {
    const n = Math.min(4, Math.max(1, Math.round(w)));
    const c = n >= 4 ? '#e5484d' : n === 3 ? '#ee964b' : '#9aa0ad';
    return `<span class="age">${[1, 2, 3, 4].map(i => `<i style="${i <= n ? `background:${c};box-shadow:none` : ''}"></i>`).join('')}</span>`;
  };
  const nm = p => L(P[p][0], P[p][1]),
    role = p => L(P[p][3], P[p][4]);
  const CODEC = {
    A: 'green',
    B: 'green',
    C: 'orange',
    D: 'red'
  };
  const cdb = c => `<span class="cdb" style="background:var(--tone-${CODEC[c]}-tint);color:var(--tone-${CODEC[c]}-fg)"><i class="ti ${c === 'B' ? 'ti-message-circle' : c === 'C' ? 'ti-refresh' : c === 'D' ? 'ti-x' : 'ti-check'}"></i>Code ${c}</span>`;
  function model() {
    const sc = SC[X.sc],
      vv = VIEW[X.view],
      ver = VERS.find(v => v.v === sc.v);
    const St = ver.S,
      T = ver.T,
      rtl = S.lang === 'ar';
    const other = id => {
      const s = St[id];
      return s && !s.end && s.co !== vv.co;
    };
    const cos = [...new Set(Object.keys(St).filter(other).map(id => St[id].co))];
    const groups = cos.map(co => {
      const ids = Object.keys(St).filter(id => other(id) && St[id].co === co);
      const xs = ids.map(i => St[i].x),
        ys = ids.map(i => St[i].y);
      let x = Math.min(...xs) - 10,
        y = Math.min(...ys) - 10,
        w = Math.max(...xs) + WF.CW + 10 - x,
        h = Math.max(...ys) + WF.CH + 10 - y;
      if (rtl) x = W - x - w;
      const inHere = ids.includes(sc.cur);
      const passed = sc.path.some(p => ids.includes(p.s));
      const fin = sc.path.find(p => ids.includes(p.s) && T[p.t] && St[T[p.t].to].end);
      let an = '';
      if (fin) an = `${cdb(T[fin.t].code)} ${L('issued', 'صدر')} · <span class="num">${fin.at.split(' ')[0]}</span> ✍ ${nm(fin.by)}, ${role(fin.by)}`;else if (inHere) an = `${L('In review', 'قيد المراجعة')} · ${ageDots(sc.wk)} ${L(sc.wk + ' weeks at this step', sc.wk + ' أسابيع في هذه الخطوة')}`;
      return {
        ids,
        x,
        y,
        w,
        h,
        co,
        title: co === 'ctr' ? L('TMC Constructions internal review', 'المراجعة الداخلية لـ تي إم سي') : co === 'cns' ? L('Design Consultants LLC review', 'مراجعة ديزاين للاستشارات') : L('Al Futtaim PMC review', 'مراجعة الفطيم لإدارة المشاريع'),
        sub: L(co === 'ctr' ? 'Drafts · Internal Review' : 'Pending Approval', co === 'ctr' ? 'المسودات · مراجعة داخلية' : 'بانتظار الاعتماد'),
        an,
        cls: inHere ? 'cur' : passed || fin ? 'done' : 'fade'
      };
    });
    const gOf = id => groups.find(g => g.ids.includes(id));
    const hide = {};
    Object.entries(T).forEach(([k, t]) => {
      const a = gOf(t.f),
        b = gOf(t.to);
      if (a && b && a === b) hide[k] = 1;else if (a && !sc.path.some(p => p.t === k) && !(k === Object.keys(T).find(x => T[x].f === t.f && !gOf(T[x].to) && false))) hide[k] = 1;
    });
    // keep edges entering a group
    Object.entries(T).forEach(([k, t]) => {
      if (!gOf(t.f) && gOf(t.to)) delete hide[k];
    });
    const scls = {},
      ecls = {},
      annot = {};
    const passed = new Set(sc.path.map(p => p.s));
    Object.keys(St).forEach(id => {
      scls[id] = passed.has(id) ? 'done' : 'fade';
    });
    scls[sc.cur] = 'cur';
    Object.keys(T).forEach(k => {
      ecls[k] = sc.path.some(p => p.t === k) ? 'done' : 'fade';
    });
    const holds = sc.holder === vv.me || sc.pool && sc.pool.includes(vv.me);
    if (!St[sc.cur].end) Object.entries(T).forEach(([k, t]) => {
      if (t.f === sc.cur && !hide[k]) ecls[k] = 'next' + (holds ? '' : ' info');
    });
    sc.path.forEach(p => {
      if (gOf(p.s)) return;
      const t = T[p.t];
      const ev = `${nm(p.by)} · ${role(p.by)} · ${p.ret ? L('Returned', 'أرجع') : esc(L(t.en, t.ar))} · <span class="num">${p.at}</span>${p.sign ? ' ✍' : ''}${p.rec && St[p.s].co === vv.co ? `<br>${L('Recommended', 'أوصى بـ')} ${cdb(p.rec)}` : ''}`;
      annot[p.s] = (annot[p.s] ? annot[p.s] + '<hr style="border:0;border-top:1px dashed var(--ui-border);margin:4px 0">' : '') + ev;
    });
    if (!St[sc.cur].end && !gOf(sc.cur)) annot[sc.cur] = (annot[sc.cur] ? annot[sc.cur] + '<hr style="border:0;border-top:1px dashed var(--ui-border);margin:4px 0">' : '') + `<b style="font-size:11px">${sc.holder ? nm(sc.holder) : L(`Pool: Design Consultants LLC (${sc.pool.length} people)`, `مجموعة: ديزاين للاستشارات (${sc.pool.length} أشخاص)`)}</b> · ${ageDots(sc.wk)} ${L(sc.wk + (sc.wk === 1 ? ' week' : ' weeks'), sc.wk + ' أسابيع')}`;
    if (St[sc.cur].end) {
      const last = sc.path[sc.path.length - 1];
      annot[sc.cur] = `<span class="num">${last.at.split(' ')[0]}</span>`;
    }
    return {
      sc,
      vv,
      ver,
      St,
      T,
      rtl,
      groups,
      hide,
      scls,
      ecls,
      annot,
      holds,
      gOf
    };
  }
  function diagram(m) {
    return renderDiagram({
      L,
      S: m.St,
      T: m.T,
      rtl: m.rtl,
      groups: m.groups,
      hide: m.hide,
      scls: m.scls,
      ecls: m.ecls,
      annot: m.annot,
      hideOut: 1
    });
  }
  function timeline(m) {
    const items = [];
    const seen = new Set();
    m.sc.path.forEach(p => {
      const g = m.gOf(p.s);
      if (g) {
        if (seen.has(g)) return;
        seen.add(g);
        items.push({
          g
        });
        return;
      }
      items.push({
        p
      });
    });
    if (!m.St[m.sc.cur].end && !m.gOf(m.sc.cur)) items.push({
      cur: 1
    });else if (m.gOf(m.sc.cur) && !seen.has(m.gOf(m.sc.cur))) items.push({
      g: m.gOf(m.sc.cur)
    });
    if (m.St[m.sc.cur].end) items.push({
      end: 1
    });
    return `<div class="ptl">${items.map(it => {
      if (it.g) return `<div class="pti ${it.g.cls}"><span class="d" style="background:var(--tone-violet-solid)"><i class="ti ti-lock"></i></span><div class="c"><b>${esc(it.g.title)}</b><small>${it.g.sub}</small>${it.g.an ? `<div class="an">${it.g.an}</div>` : ''}</div></div>`;
      if (it.p) {
        const s = m.St[it.p.s],
          t = m.T[it.p.t];
        return `<div class="pti done"><span class="d"><i class="ti ${it.p.ret ? 'ti-arrow-back-up' : 'ti-check'}"></i></span><div class="c"><b>${esc(L(s.en, s.ar))}</b><div class="an">${nm(it.p.by)} · ${it.p.ret ? L('Returned', 'أرجع') : esc(L(t.en, t.ar))}<br><span class="num">${it.p.at}</span>${it.p.sign ? ' ✍' : ''}</div></div></div>`;
      }
      if (it.end) {
        const e = END[m.St[m.sc.cur].end];
        return `<div class="pti done"><span class="d" style="background:var(--tone-${e[2]}-solid)"><i class="ti ${e[3]}"></i></span><div class="c"><b>${L(e[0], e[1])}</b></div></div>`;
      }
      const s = m.St[m.sc.cur];
      return `<div class="pti cur"><span class="d"><i class="ti ti-player-play"></i></span><div class="c"><b>${esc(L(s.en, s.ar))}</b><div class="an">${m.annot[m.sc.cur]}</div><div class="nx">${Object.entries(m.T).filter(([k, t]) => t.f === m.sc.cur && !m.hide[k]).map(([k, t]) => `<button class="cb sm${m.holds ? ' pri' : ''}" ${m.holds ? `data-do="${k}"` : 'disabled'}>${t.sign ? '<i class="ti ti-signature"></i>' : ''}${esc(L(t.en, t.ar))}</button>`).join('')}</div></div></div>`;
    }).join('')}</div>`;
  }
  function drawer() {
    if (!X.open) return '';
    const m = model(),
      sc = m.sc;
    const newer = sc.v < 3;
    return `<div class="scrim" data-close="1"><div class="wvd" data-stop>
 <div class="wvh"><div style="min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="num" style="font-size:12.5px;font-weight:700;color:var(--ui-muted)">${sc.no}</span><span class="vs pub">Rev ${sc.rev}</span></div><h3>${L('Material Submittal – 2-tier review', 'اعتماد المواد – مراجعة على مستويين')} · v${sc.v}</h3></div><span style="flex:1"></span>
 <span class="segv" title="${L('Demo · view as', 'عرض توضيحي · العرض بصفة')}">${Object.entries(VIEW).map(([k, v]) => `<button class="${X.view === k ? 'on' : ''}" data-vw="${k}">${L(v.en, v.ar)}</button>`).join('')}</span><span class="segv"><button class="${!X.phone ? 'on' : ''}" data-ph="0"><i class="ti ti-device-desktop"></i></button><button class="${X.phone ? 'on' : ''}" data-ph="1"><i class="ti ti-device-mobile"></i></button></span><button class="cb ter ic" data-close="1"><i class="ti ti-x"></i></button></div>
 <div class="wvb">${sc.rev ? `<div class="rch"><span>${L('Revisions', 'المراجعات')}</span><button data-sc="closed">Rev 0 ${cdb('C')}</button><i class="ti ti-chevron-right"></i><button class="on" data-sc="pending">Rev 1 · ${L('current', 'الحالي')}</button></div>` : sc.no.endsWith('041') ? `<div class="rch"><span>${L('Revisions', 'المراجعات')}</span><button class="on">Rev 0 ${cdb('C')}</button><i class="ti ti-chevron-right"></i><button data-sc="pending">Rev 1</button></div>` : ''}
 ${newer ? `<div class="lockb" style="background:var(--tone-blue-tint);color:var(--tone-blue-fg)"><i class="ti ti-info-circle"></i>${L(`This item follows v${sc.v}. The workflow was updated to v3.`, `يتبع هذا العنصر v${sc.v}. تم تحديث سير العمل إلى v3.`)}<a class="cb sm" style="margin-inline-start:auto;text-decoration:none" href="settings-workflows.html">${L('View v3', 'عرض v3')}</a></div>` : ''}
 ${X.phone ? `<div class="phone" style="margin:0 auto;height:720px"><div class="scr" style="background:var(--ui-canvas)"><div class="notch"></div><div class="sm-hd2"><b>${L('Workflow', 'سير العمل')}</b><small class="num">${sc.no} · v${sc.v}</small></div><div style="position:absolute;inset:100px 0 0;overflow:auto;padding:0 14px 30px">${m.groups.length ? note() : ''}${timeline(m)}</div><div class="m-home"></div></div></div>` : `<div class="wcv" style="flex:1;min-height:420px"><div class="wstage" id="wst">${diagram(m)}</div><div class="wctl"><button data-z="out"><i class="ti ti-zoom-out"></i></button><button data-z="in"><i class="ti ti-zoom-in"></i></button><button data-z="fit"><i class="ti ti-maximize"></i></button></div></div>${m.groups.length ? note() : ''}`}
 </div></div></div>`;
  }
  const note = () => `<div class="gnote"><i class="ti ti-info-circle"></i>${L('Some steps are grouped because they are internal to another company.', 'بعض الخطوات مجمّعة لأنها داخلية لشركة أخرى.')}</div>`;
  function page() {
    if (X.open) setTimeout(applyFit, 40);
    const m = model(),
      sc = m.sc,
      vv = m.vv;
    const g = m.gOf(sc.cur);
    const st = sc.stage;
    const holderTxt = m.St[sc.cur].end ? L('Closed', 'مغلق') : g ? esc(g.title) : sc.holder ? `${nm(sc.holder)} · ${role(sc.holder)}` : L(`Pool: Design Consultants LLC (${sc.pool.length})`, `مجموعة: ديزاين للاستشارات (${sc.pool.length})`);
    const log = sc.path.filter(p => !m.gOf(p.s) || m.T[p.t] && m.St[m.T[p.t].to].end).map(p => {
      const t = m.T[p.t];
      const fin = m.St[t.to].end;
      return `<div class="alog"><span class="av" style="width:28px;height:28px;font-size:10px;background:${P[p.by][2] === 'ctr' ? '#f8552f' : '#3d6db5'}">${RS.ini(P[p.by][0])}</span><div><b>${nm(p.by)}</b> <small>${role(p.by)}</small><div>${p.ret ? L('Returned', 'أرجع') : esc(L(t.en, t.ar))}${p.sign ? ' ✍' : ''}${fin ? ' ' + cdb(t.code) : ''}</div><small class="num">${p.at}</small></div></div>`;
    }).reverse().join('');
    return `<div class="sp-hd"><button class="cb ter sm"><i class="ti ti-arrow-left"></i></button><div style="min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="num" style="font-size:12.5px;font-weight:700;color:var(--ui-muted)">${sc.no}</span><span class="vs pub">Rev ${sc.rev}</span><span class="stp" style="background:var(--tone-${st[2]}-tint);color:var(--tone-${st[2]}-fg)"><i></i>${L(st[0], st[1])}</span></div><h1>${esc(L(sc.t[0], sc.t[1]))}</h1></div><span style="flex:1"></span><span class="segv" title="demo">${Object.entries(SC).map(([k, s]) => `<button class="${X.sc === k ? 'on' : ''}" data-sc="${k}">${k === 'internal' ? L('Internal Review', 'مراجعة داخلية') : k === 'pending' ? L('Pending Approval', 'بانتظار الاعتماد') : L('Closed · Code C', 'مغلق · Code C')}</button>`).join('')}</span><span class="rel"><button class="vis" data-menu="vw"><i class="ti ti-eye"></i>${L(vv.en, vv.ar)}<i class="ti ti-chevron-down"></i></button>${X.menu ? `<div class="pop end" data-stop>${Object.entries(VIEW).map(([k, v]) => `<button class="mi${X.view === k ? ' on' : ''}" data-vw="${k}">${L(v.en, v.ar)}</button>`).join('')}</div>` : ''}</span></div>
 <div class="sp-body"><div class="card" style="overflow:hidden"><div class="wtabs" style="padding:0 18px;margin:0">${[L('Submittal Details', 'تفاصيل التقديم'), L('Chat', 'المحادثة'), L('Internal Communication', 'التواصل الداخلي')].map((t, i) => `<button class="${i ? '' : 'on'}">${t}</button>`).join('')}</div><div style="padding:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 24px;font-size:13px">${[[L('Type', 'النوع'), 'MAR · Material Approval Request'], [L('Trade', 'التخصص'), L('Electrical', 'كهرباء')], [L('Location', 'الموقع'), L('Tower 1 · Floor 02', 'البرج ١ · الطابق ٠٢')], [L('Supplier', 'المورّد'), 'Thorn Lighting'], [L('Cost impact', 'أثر التكلفة'), '<span class="num">320,000 SAR</span>'], [L('Contractor', 'المقاول'), 'TMC Constructions']].map(k => `<div><div style="color:var(--ui-muted);margin-bottom:3px">${k[0]}</div><b>${k[1]}</b></div>`).join('')}</div></div>
 <aside style="display:flex;flex-direction:column;gap:12px"><div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:14px">${L('Status', 'الحالة')}</b><button class="cb sm" data-act="open" style="margin-inline-start:auto"><i class="ti ti-git-branch"></i>${L('View workflow', 'عرض سير العمل')}</button></div><span class="stp" style="align-self:flex-start;background:var(--tone-${st[2]}-tint);color:var(--tone-${st[2]}-fg)"><i></i>${L(st[0], st[1])}</span><div style="font-size:13px"><span style="color:var(--ui-muted)">${L('With', 'لدى')}</span> <b>${holderTxt}</b></div>${!m.St[sc.cur].end ? `<div style="font-size:12.5px;color:var(--ui-muted);display:flex;gap:8px;align-items:center">${ageDots(sc.wk)} ${L(sc.wk + (sc.wk === 1 ? ' week' : ' weeks') + ' at this step', sc.wk + ' أسابيع في هذه الخطوة')}</div>` : ''}${sc.v < 3 ? `<div style="font-size:12px;color:var(--tone-blue-fg);display:flex;gap:6px"><i class="ti ti-info-circle"></i>${L('Workflow updated to v3', 'تم تحديث سير العمل إلى v3')} · <a data-act="open" style="cursor:pointer;font-weight:600">${L('View new version', 'عرض الإصدار الجديد')}</a></div>` : ''}</div>
 <div class="card" style="padding:16px"><b style="font-size:14px">${L('Approvals Log', 'سجل الاعتمادات')}</b>${log || `<div style="font-size:12.5px;color:var(--ui-faint);margin-top:8px">—</div>`}</div></aside></div>${drawer()}${X.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${X.toast}</div>` : ''}`;
  }
  function applyFit() {
    const s = document.getElementById('wst');
    if (!s) return;
    const w = s.querySelector('.wworld');
    const r = s.getBoundingClientRect();
    const k = X.k || Math.min(r.width / W, r.height / (H + 30)) * .98;
    X.kk = k;
    w.style.transform = `translate(${(r.width - W * k) / 2 + (X.dx || 0)}px,${6 + (X.dy || 0)}px) scale(${k})`;
  }
  function bind(root, R) {
    let tt;
    const flash = m => {
      X.toast = m;
      R();
      clearTimeout(tt);
      tt = setTimeout(() => {
        X.toast = null;
        R();
      }, 2200);
    };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act],[data-vw],[data-sc],[data-ph],[data-close],[data-menu],[data-do],[data-z],.wl.next:not(.info)');
      if (!b) {
        if (X.menu) {
          X.menu = null;
          R();
        }
        return;
      }
      if (b.closest('.hd,.tabs,.sb')) return;
      const d = b.dataset;
      if (d.close !== undefined) {
        if (e.target.closest('[data-stop]') && !b.closest('button')) return;
        X.open = false;
        return R();
      }
      if (d.menu) {
        X.menu = !X.menu;
        return R();
      }
      if (d.vw) {
        X.view = d.vw;
        X.menu = null;
        X.k = 0;
        X.dx = X.dy = 0;
        return R();
      }
      if (d.sc) {
        X.sc = d.sc;
        if (d.sc === 'internal') X.view = 'ctrpm';
        X.k = 0;
        return R();
      }
      if (d.ph !== undefined) {
        X.phone = d.ph === '1';
        return R();
      }
      if (d.act === 'open') {
        X.open = true;
        X.k = 0;
        X.dx = X.dy = 0;
        return R();
      }
      if (d.z) {
        if (d.z === 'fit') {
          X.k = 0;
          X.dx = X.dy = 0;
        } else X.k = (X.kk || .7) * (d.z === 'in' ? 1.2 : 1 / 1.2);
        return applyFit();
      }
      const tid = d.do || d.t;
      if (tid) {
        const t = VERS.find(v => v.v === SC[X.sc].v).T[tid];
        return flash(L(`“${t.en}”${t.sign ? ' — signature & confirmation' : ''} would open here`, `«${t.ar}» سيُفتح هنا`));
      }
    });
    let D = null;
    root.addEventListener('pointerdown', e => {
      if (e.target.closest('#wst') && !e.target.closest('.wl')) D = {
        x: e.clientX,
        y: e.clientY,
        dx: X.dx || 0,
        dy: X.dy || 0
      };
    });
    addEventListener('pointermove', e => {
      if (!D) return;
      X.dx = D.dx + e.clientX - D.x;
      X.dy = D.dy + e.clientY - D.y;
      applyFit();
    });
    addEventListener('pointerup', () => D = null);
    addEventListener('resize', applyFit);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && X.open) {
        X.open = false;
        R();
      }
    });
  }
  window.WV = {
    X,
    page,
    bind,
    applyFit
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/wf/view.js", error: String((e && e.message) || e) }); }

// ui_kits/app/wf/wf.js
try { (() => {
// Settings → Workflows (Part A). Exposes window.WA.
(function () {
  const S = RS.S,
    {
      STG,
      END,
      CO,
      FIELDS,
      VERS,
      LIB,
      W,
      H,
      renderDiagram,
      clone
    } = WF;
  const L = (e, a) => S.lang === 'ar' ? a : e;
  const esc = RS.esc;
  const V = {
    page: 'list',
    tab: 'project',
    dtab: 'diagram',
    ver: 3,
    empty: false,
    menu: null,
    modal: null,
    toast: null,
    ed: null,
    sel: null,
    undo: [],
    redo: [],
    dirty: false,
    k: .72,
    tx: 14,
    ty: 14,
    sim: null,
    cost: 620000,
    types: {
      MAR: 'mat',
      SAR: 'mat',
      DAR: 'doc',
      IR: 'ir',
      SNG: 'snag',
      CMT: 'snag',
      DSR: 'dsr'
    },
    pubNote: '',
    noteErr: false
  };
  const draft = () => VERS.find(v => v.st === 'draft');
  const vsel = () => VERS.find(v => v.v === V.ver);
  /* ---- validation ---- */
  function validate(d) {
    const out = [];
    const {
      S: St,
      T
    } = d;
    Object.entries(St).forEach(([id, s]) => {
      if (s.end) return;
      if (!Object.values(T).some(t => t.f === id)) out.push({
        lv: 'err',
        id,
        msg: [`Step “${s.en}” has no way forward`, `الخطوة «${s.ar}» ليس لها مسار للأمام`]
      });
    });
    Object.entries(T).forEach(([id, t]) => {
      const a = St[t.f],
        b = St[t.to];
      if (!a || !b) return;
      if ((t.type === 'submit' || t.code) && !t.sign) out.push({
        lv: 'err',
        id,
        msg: [`“${t.en}” sets a hand-over or final code and must require signature`, `«${t.ar}» يجب أن يتطلب توقيعًا`]
      });
      if (t.type === 'return' && !b.end && a.co !== b.co) out.push({
        lv: 'err',
        id,
        msg: [`Return “${t.en}” crosses companies — Return can only go back within the same company`, `الإرجاع «${t.ar}» يعبر بين الشركات — مسموح داخل نفس الشركة فقط`]
      });
      if (t.type === 'send' && !b.end && a.co !== b.co) out.push({
        lv: 'err',
        id,
        msg: [`“${t.en}” is a Send but goes to another company — use Submit`, `«${t.ar}» إرسال إلى شركة أخرى — استخدم تقديم`]
      });
      (t.cond || []).forEach(c => {
        if (!FIELDS.includes(c.f)) out.push({
          lv: 'err',
          id,
          msg: [`Condition uses field “${c.f}” that doesn’t exist in the form`, `الشرط يستخدم الحقل «${c.f}» غير الموجود في النموذج`]
        });
      });
    });
    const byF = {};
    Object.entries(T).forEach(([id, t]) => {
      if (t.cond && t.cond.length) (byF[t.f] = byF[t.f] || []).push(id);
    });
    Object.values(byF).forEach(ids => {
      if (ids.length > 1) out.push({
        lv: 'warn',
        id: ids[1],
        msg: ['Two conditions from the same step can both match', 'شرطان من نفس الخطوة قد يتحققان معًا']
      });
    });
    return out;
  }
  /* ---- shared chrome ---- */
  function nav() {
    const it = [['general', 'ti-settings', 'General', 'عام'], ['participants', 'ti-users', 'Participants', 'المشاركون'], ['visibility', 'ti-eye', 'Visibility', 'الظهور'], ['positions', 'ti-user-circle', 'Positions', 'المناصب'], ['trades', 'ti-map-pin', 'Trades & Locations', 'التخصصات والمواقع'], ['stages', 'ti-list-check', 'Stages', 'المراحل'], ['numbering', 'ti-list', 'Document Numbering', 'ترقيم المستندات'], ['workflows', 'ti-refresh', 'Workflows', 'سير العمل'], ['types', 'ti-file-text', 'Work Item Types', 'أنواع العناصر'], ['forms', 'ti-clipboard-text', 'Forms', 'النماذج'], ['suppliers', 'ti-building', 'Approved Suppliers', 'الموردون المعتمدون'], ['activity', 'ti-clock', 'Activity', 'النشاط']];
    return `<nav class="st-nav"><h6>${L('Project settings', 'إعدادات المشروع')}</h6>${it.map(i => `<button class="${(V.page === 'types' ? 'types' : 'workflows') === i[0] ? 'on' : ''}" data-snav="${i[0]}"><i class="ti ${i[1]}"></i>${L(i[2], i[3])}</button>`).join('')}</nav>`;
  }
  const vst = w => w.ro ? `<span class="vs ro"><i class="ti ti-lock"></i>${L('Read-only', 'للقراءة فقط')}</span>` : w.lib ? `<span class="vs pub">${L('Library', 'المكتبة')}</span>` : `<span class="vs pub"><i class="ti ti-check"></i>${L('Published', 'منشور')} v${w.runs.length}</span>${w.draft ? ` <span class="vs draft"><i class="ti ti-pencil"></i>${L('Draft', 'مسودة')} v${w.draft}</span>` : ''}`;
  function list() {
    const rows = V.empty && V.tab === 'project' ? [] : LIB[V.tab];
    return `<div class="st-hd"><div><h1>${L('Workflows', 'سير العمل')}</h1><p>${L('Each Work Item Type follows one workflow. Publishing a new version never changes items already running.', 'يتبع كل نوع عنصر سير عمل واحدًا. نشر إصدار جديد لا يغيّر العناصر الجارية.')}</p></div><div class="act"><span class="rel"><button class="cb pri" data-menu="new"><i class="ti ti-plus"></i>${L('New workflow', 'سير عمل جديد')}<i class="ti ti-chevron-down"></i></button>${V.menu === 'new' ? `<div class="pop end" data-stop style="min-width:260px"><button class="mi" data-act="newblank"><i class="ti ti-file"></i>${L('Start blank', 'البدء من الصفر')}</button><button class="mi" data-tab="rabaed"><i class="ti ti-copy"></i>${L('Copy from Rabaed Default', 'نسخ من إعدادات ربائد')}</button><button class="mi" data-tab="company"><i class="ti ti-building"></i>${L('Copy from Company library', 'نسخ من مكتبة الشركة')}</button></div>` : ''}</span><button class="cb ic" data-act="toggleempty" title="${L('Demo: empty state', 'عرض: حالة فارغة')}"><i class="ti ti-dots"></i></button></div></div>
 <div class="wtabs">${[['project', L('In this project', 'في هذا المشروع'), LIB.project.length], ['company', L('Company library', 'مكتبة الشركة'), LIB.company.length], ['rabaed', L('Rabaed Defaults', 'إعدادات ربائد'), LIB.rabaed.length]].map(t => `<button class="${V.tab === t[0] ? 'on' : ''}" data-tab="${t[0]}">${t[1]}<span class="n" style="font:600 11px var(--font-ui);color:var(--ui-faint)">${t[2]}</span></button>`).join('')}</div>
 ${rows.length ? `<section class="card" style="overflow:hidden"><div style="overflow-x:auto"><div style="min-width:980px"><div class="wrow h"><span>${L('Workflow', 'سير العمل')}</span><span>${L('Version', 'الإصدار')}</span><span>${L('Used by', 'يستخدمه')}</span><span>${L('Items running', 'عناصر جارية')}</span><span>${L('Last published', 'آخر نشر')}</span><span></span></div>
 ${rows.map(w => `<div class="wrow"><span><b data-open="${w.id}">${esc(L(w.en, w.ar))}</b></span><span>${vst(w)}</span><span style="display:flex;gap:4px;flex-wrap:wrap">${w.types.map(t => `<span class="wtc">${t}</span>`).join('') || '<span style="color:var(--ui-faint)">—</span>'}</span><span class="runs">${w.runs.map((n, i) => `<span>v${i + 1}: <b>${n}</b></span>`).join('') || '<span style="background:none;box-shadow:none;color:var(--ui-faint)">—</span>'}</span><span style="font-size:12.5px;color:var(--ui-muted)">${w.date}<br>${esc(w.by)}</span><span style="display:flex;gap:4px;justify-content:flex-end">${w.ro || w.lib ? `<button class="cb sm" data-act="copy">${L('Use in project', 'استخدام في المشروع')}</button>` : `<button class="cb sm" data-open="${w.id}">${L('Open', 'فتح')}</button>`}<span class="rel"><button class="cb sm ter ic" data-menu="row-${w.id}"><i class="ti ti-dots"></i></button>${V.menu === 'row-' + w.id ? `<div class="pop end" data-stop><button class="mi" data-act="copy"><i class="ti ti-copy"></i>${L('Duplicate', 'تكرار')}</button><button class="mi" data-act="tolib"><i class="ti ti-building"></i>${L('Copy to company library', 'نسخ لمكتبة الشركة')}</button><div class="sep"></div><button class="mi" data-act="arch"><i class="ti ti-archive"></i>${L('Archive', 'أرشفة')}</button></div>` : ''}</span></span></div>`).join('')}</div></div></section>` : `<section class="card"><div class="empty" style="padding:56px 20px;text-align:center"><div style="width:56px;height:56px;border-radius:16px;background:var(--tone-tomato-tint);color:var(--btn-pri);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:26px"><i class="ti ti-refresh"></i></div><b style="display:block;font-size:17px;color:var(--ui-text)">${L('No custom workflows yet', 'لا يوجد سير عمل مخصص بعد')}</b><p style="color:var(--ui-muted);font-size:13.5px;max-width:420px;margin:6px auto 14px">${L('Your Work Item Types use Rabaed Defaults. Copy one to adjust steps, buttons and who holds each step.', 'تستخدم أنواع العناصر إعدادات ربائد. انسخ واحدًا لتعديل الخطوات والأزرار.')}</p><div style="display:flex;gap:8px;justify-content:center"><button class="cb pri" data-tab="rabaed"><i class="ti ti-copy"></i>${L('Copy a Rabaed Default', 'نسخ إعداد من ربائد')}</button><button class="cb" data-act="newblank">${L('Start blank', 'البدء من الصفر')}</button></div></div></section>`}
 <p style="font-size:12px;color:var(--ui-muted);display:flex;gap:6px;align-items:center"><i class="ti ti-info-circle"></i>${L('Using a workflow always makes a copy — it never stays linked to the library.', 'استخدام سير عمل ينشئ نسخة دائمًا — ولا يبقى مرتبطًا بالمكتبة.')}</p>`;
  }
  function types() {
    const T = [['MAR', 'Material Approval Request', 'طلب اعتماد مواد'], ['DSR', 'Daily Site Report', 'تقرير الموقع اليومي'], ['CMT', 'Comment', 'تعليق'], ['SAR', 'Shop Drawing', 'مخطط تنفيذي'], ['DAR', 'Document', 'مستند'], ['IR', 'Inspection Request', 'طلب فحص'], ['SNG', 'Snag', 'ملاحظة']];
    const opts = [...LIB.project.map(w => [w.id, L(w.en, w.ar)]), ['rabaed', L('Rabaed Default', 'الإعداد الافتراضي')]];
    return `<div class="st-hd"><div><h1>${L('Work Item Types', 'أنواع العناصر')}</h1><p>${L('Choose which workflow each type follows.', 'اختر سير العمل لكل نوع.')}</p></div></div><section class="card" style="overflow:hidden">${T.map(t => `<div class="wrow" style="grid-template-columns:70px minmax(0,1fr) 320px"><span class="wtc">${t[0]}</span><b style="cursor:default">${L(t[1], t[2])}</b><select data-wit="${t[0]}" style="height:34px;border:0;border-radius:6px;padding:0 9px;background:var(--fld-bg);box-shadow:inset 0 0 0 1px var(--fld-bd);font:inherit;font-size:13px;color:var(--fld-txt)">${opts.map(o => `<option value="${o[0]}"${V.types[t[0]] === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`).join('')}</section>`;
  }
  function detail() {
    const w = LIB.project.find(x => x.id === V.wid) || LIB.project[0];
    const v = w.wf ? {
      S: w.wf.S,
      T: w.wf.T,
      run: w.runs[0]
    } : vsel();
    const tabs = [['diagram', L('Diagram', 'المخطط')], ['versions', L('Versions & history', 'الإصدارات والسجل')], ['used', L('Used by', 'يستخدمه')], ['activity', L('Activity', 'النشاط')]];
    let body = '';
    if (V.dtab === 'diagram') body = `<div class="wcv" style="height:520px"><div class="wstage" id="wst"><div id="wwrap">${renderDiagram({
      L,
      S: v.S,
      T: v.T,
      rtl: S.lang === 'ar'
    })}</div></div>${ctl()}</div>`;
    if (V.dtab === 'versions' && w.wf) body = `<div class="tl"><div class="tli"><span class="dt" style="background:var(--tone-green-solid)">v1</span><div class="tx"><div style="flex:1;min-width:220px"><b style="font-size:14px">v1 <span class="vs pub">${L('Published', 'منشور')}</span></b><div style="font-size:12.5px;color:var(--ui-muted);margin-top:3px">${w.date} · ${esc(w.by)}</div><div style="font-size:13px;margin-top:6px">${L('Initial version.', 'الإصدار الأولي.')}</div></div><span class="runs"><span>${w.runs[0]} ${L('running', 'جارٍ')}</span></span></div></div></div>`;else if (V.dtab === 'versions') body = `<div class="tl">${VERS.slice().reverse().map(x => `<div class="tli"><span class="dt" style="background:${x.st === 'draft' ? 'var(--tone-amber-solid)' : 'var(--tone-green-solid)'}">v${x.v}</span><div class="tx"><div style="flex:1;min-width:220px"><b style="font-size:14px">v${x.v} ${x.st === 'draft' ? `<span class="vs draft">${L('Draft', 'مسودة')}</span>` : `<span class="vs pub">${L('Published', 'منشور')}</span>`}</b><div style="font-size:12.5px;color:var(--ui-muted);margin-top:3px">${x.st === 'draft' ? L('In progress · Sara Al Mansoori', 'قيد العمل · سارة المنصوري') : `${x.date} · ${esc(x.by)}`}</div>${x.note[0] ? `<div style="font-size:13px;margin-top:6px">${esc(L(x.note[0], x.note[1]))}</div>` : ''}</div><span class="runs"><span>${x.run} ${L('running', 'جارٍ')}</span></span>${x.v > 1 ? `<button class="cb sm" data-cmp="${x.v}"><i class="ti ti-arrows-diff"></i>${L('Compare with', 'مقارنة مع')} v${x.v - 1}</button>` : ''}</div></div>`).join('')}</div>`;
    if (V.dtab === 'used') body = `<section class="card" style="overflow:hidden">${w.types.map((t, ti) => `<div class="wrow" style="grid-template-columns:70px 1fr auto"><span class="wtc">${t}</span><span class="runs">${w.wf ? `<span>v1: <b>${ti === 0 ? Math.round(w.runs[0] * (w.types.length > 1 ? .7 : 1)) : w.runs[0] - Math.round(w.runs[0] * .7)}</b></span>` : VERS.filter(x => x.st === 'pub').map(x => `<span>v${x.v}: <b>${t === 'MAR' ? [1, 9, 20][x.v - 1] : [1, 5, 11][x.v - 1]}</b></span>`).join('')}</span><a class="cb sm" href="submittals-list.html"><i class="ti ti-list"></i>${L('Open list by version', 'فتح القائمة حسب الإصدار')}</a></div>`).join('')}</section>`;
    if (V.dtab === 'activity') body = `<section class="card" style="padding:6px 0">${[['Sara Al Mansoori', 'edited Draft v4 — added “Consultant QA check”', 'عدّلت المسودة v4 — أضافت «تدقيق الجودة»', '2d'], ['Mohammed Al Shamsi', 'published v3', 'نشر v3', '14 Aug'], ['Sara Al Mansoori', 'attached to SAR', 'ربطت بـ SAR', '02 Apr'], ['Sara Al Mansoori', 'published v2', 'نشرت v2', '02 Apr'], ['Sara Al Mansoori', 'published v1', 'نشرت v1', '11 Jan']].map(a => `<div class="wrow" style="grid-template-columns:1fr auto;padding-block:11px"><span><b style="font-size:13px;cursor:default">${a[0]}</b> <span style="color:var(--ui-text-2)">${L(a[1], a[2])}</span></span><span class="num" style="color:var(--ui-muted);font-size:12px">${a[3]}</span></div>`).join('')}</section>`;
    return `<div class="st-hd"><div><button class="cb ter sm" data-page="list"><i class="ti ti-arrow-left"></i>${L('Workflows', 'سير العمل')}</button><h1 style="margin-top:6px">${esc(L(w.en, w.ar))}</h1><p style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${vst(w)}${w.types.map(t => `<span class="wtc">${t}</span>`).join('')}</p></div><div class="act">${w.wf ? `<span class="vs pub" style="height:34px;padding:0 12px">v1 · ${L('published', 'منشور')}</span>` : `<select data-ver style="height:34px;border:0;border-radius:6px;padding:0 9px;background:var(--fld-bg);box-shadow:inset 0 0 0 1px var(--fld-bd);font:inherit;font-size:13px">${VERS.map(x => `<option value="${x.v}"${x.v === V.ver ? ' selected' : ''}>v${x.v} · ${x.st === 'draft' ? L('draft', 'مسودة') : L('published', 'منشور')}</option>`).join('')}</select>`}<button class="cb" data-act="copy"><i class="ti ti-copy"></i>${L('Duplicate', 'تكرار')}</button>${w.wf ? '' : `<button class="cb" data-page="builder"><i class="ti ti-pencil"></i>${L('Edit draft', 'تعديل المسودة')} v4</button>`}${w.wf ? '' : `<button class="cb pri" data-act="publish"><i class="ti ti-upload"></i>${L('Publish', 'نشر')}</button>`}</div></div>
 <div class="wtabs">${tabs.map(t => `<button class="${V.dtab === t[0] ? 'on' : ''}" data-dtab="${t[0]}">${t[1]}</button>`).join('')}</div>${V.dtab === 'diagram' && !w.wf && V.ver < 3 ? `<div class="lockb" style="background:var(--tone-blue-tint);color:var(--tone-blue-fg)"><i class="ti ti-info-circle"></i>${L(`v${V.ver} is read-only. ${vsel().run} items still run on it.`, `v${V.ver} للقراءة فقط. ${vsel().run} عناصر لا تزال عليه.`)}</div>` : ''}${body}`;
  }
  const ctl = () => `<div class="wctl"><button data-z="out"><i class="ti ti-zoom-out"></i></button><button data-z="in"><i class="ti ti-zoom-in"></i></button><button data-z="fit"><i class="ti ti-maximize"></i></button></div>`;
  /* ---- builder ---- */
  function side() {
    const d = V.ed;
    if (!V.sel) return `<h6>${L('Nothing selected', 'لا يوجد تحديد')}</h6><p style="font-size:13px;color:var(--ui-muted);margin:0;line-height:1.5">${L('Click a step or an arrow to edit it. Drag steps to move them.', 'انقر على خطوة أو سهم لتعديله. اسحب الخطوات لنقلها.')}</p><h6>${L('This draft', 'هذه المسودة')}</h6><div style="font-size:13px">${Object.values(d.S).filter(s => !s.end).length} ${L('steps', 'خطوات')} · ${Object.keys(d.T).length} ${L('transitions', 'انتقالات')}</div>`;
    const inp = (k, v, ph) => `<input data-f="${k}" value="${esc(v || '')}" placeholder="${ph || ''}">`;
    if (d.S[V.sel]) {
      const s = d.S[V.sel];
      if (s.end) return `<h6>${L('End', 'نهاية')}</h6><b>${L(END[s.end][0], END[s.end][1])}</b><button class="cb sm" data-act="del" style="color:var(--tone-red-fg)"><i class="ti ti-trash"></i>${L('Delete', 'حذف')}</button>`;
      const pool = s.co === 'ctr' ? 'TMC Constructions → Nasser, Ahmed' : s.co === 'cns' ? 'Design Consultants LLC → pool: Ahmed, Sara' : 'Al Futtaim PMC → Hassan';
      return `<h6>${L('Step', 'خطوة')}</h6><label class="f">${L('Name (EN)', 'الاسم (EN)')}${inp('en', s.en)}</label><label class="f">${L('Name (AR)', 'الاسم (AR)')}<input data-f="ar" dir="rtl" value="${esc(s.ar)}"></label><label class="f">${L('Stage', 'المرحلة')}<select data-f="stage">${['drafts', 'internal', 'pending'].map(k => `<option value="${k}"${s.stage === k ? ' selected' : ''}>${L(STG[k][0], STG[k][1])}</option>`).join('')}</select></label>
  <h6>${L('Who holds it', 'من يتولاها')}</h6><div class="g2"><select data-f="co">${Object.keys(CO).map(k => `<option value="${k}"${s.co === k ? ' selected' : ''}>${L(CO[k][2], CO[k][3])}</option>`).join('')}</select><select data-f="perm">${['Create', 'Review', 'Approve'].map(p => `<option${s.perm === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div><div class="live"><i class="ti ti-users"></i> ${L('In this project:', 'في هذا المشروع:')} ${pool}</div><label class="f">${L('Default person (optional)', 'الشخص الافتراضي (اختياري)')}<select><option>${L('None — anyone in the pool', 'لا أحد — أي شخص في المجموعة')}</option></select></label>
  <h6>${L('Outcome', 'النتيجة')}</h6><select data-f="out">${[['none', L('None', 'بدون')], ['recommend', L('Recommend a code (for the manager)', 'يوصي برمز')], ['final', L('Issue the final code', 'يصدر الرمز النهائي')], ['insp', L('Inspection result', 'نتيجة الفحص')]].map(o => `<option value="${o[0]}"${s.out === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>
  <h6>${L('Editable form sections', 'أقسام النموذج القابلة للتعديل')}</h6>${['General', 'Items & quantities', 'Attachments', 'Review comments'].map((x, i) => `<label class="chk3"><span class="ck${(s.co === 'ctr' ? i < 3 : i === 3 || i === 2) ? ' on' : ''}">${(s.co === 'ctr' ? i < 3 : i === 3 || i === 2) ? '<i class="ti ti-check"></i>' : ''}</span>${x}</label>`).join('')}
  <button class="cb sm" data-act="del" style="color:var(--tone-red-fg);align-self:flex-start"><i class="ti ti-trash"></i>${L('Delete step', 'حذف الخطوة')}</button>`;
    }
    const t = d.T[V.sel];
    if (!t) return '';
    return `<h6>${L('Transition (button)', 'انتقال (زر)')} · ${esc(L(d.S[t.f].en || '', d.S[t.f].ar || ''))} → ${d.S[t.to].end ? L(END[d.S[t.to].end][0], END[d.S[t.to].end][1]) : esc(L(d.S[t.to].en, d.S[t.to].ar))}</h6><label class="f">${L('Button label (EN)', 'نص الزر (EN)')}${inp('en', t.en)}</label><label class="f">${L('Button label (AR)', 'نص الزر (AR)')}<input data-f="ar" dir="rtl" value="${esc(t.ar)}"></label>
 <label class="f">${L('Type', 'النوع')}<span class="segv">${['send', 'submit', 'return', 'close', 'cancel'].map(k => `<button class="${t.type === k ? 'on' : ''}" data-tt="${k}" style="padding:0 8px;font-size:12px">${{
      send: L('Send', 'إرسال'),
      submit: L('Submit', 'تقديم'),
      return: L('Return', 'إرجاع'),
      close: L('Close', 'إغلاق'),
      cancel: L('Cancel', 'إلغاء')
    }[k]}</button>`).join('')}</span></label>
 <label class="f">${L('Outcome · Review Code', 'النتيجة · رمز المراجعة')}<select data-f="code"><option value="">—</option>${['A', 'B', 'C', 'D'].map(c => `<option${t.code === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
 <label class="chk3" data-act="sign"><span class="swc${t.sign ? ' on' : ''}"></span>${L('Requires signature + confirmation', 'يتطلب توقيعًا وتأكيدًا')}</label>
 <h6>${L('Condition', 'الشرط')}</h6>${(t.cond || []).map((c, i) => `<div class="crow"><select data-cf="${i}:f">${[...FIELDS, ...(FIELDS.includes(c.f) ? [] : [c.f])].map(f => `<option${c.f === f ? ' selected' : ''}>${f}</option>`).join('')}</select><select data-cf="${i}:op">${['>', '<', '=', '≠'].map(o => `<option${c.op === o ? ' selected' : ''}>${o}</option>`).join('')}</select><input data-cf="${i}:v" value="${esc(c.v)}"><button class="cb ter sm ic" data-crm="${i}"><i class="ti ti-x"></i></button></div>${i < t.cond.length - 1 ? `<small style="font-weight:700;color:var(--ui-muted)">AND</small>` : ''}`).join('')}<button class="cb sm" data-act="cadd" style="align-self:flex-start"><i class="ti ti-plus"></i>${L('Add rule', 'إضافة قاعدة')}</button>
 <h6>${L('Action form (pop-up)', 'نموذج الإجراء (نافذة)')}</h6>${[['comment', L('Comments', 'ملاحظات')], ['files', L('Attach files', 'إرفاق ملفات')], ['code', L('Pick review code', 'اختيار الرمز')]].map(f => {
      const on = (t.form || ['comment']).includes(f[0]) || f[0] === 'code' && t.code;
      return `<label class="chk3" data-ff="${f[0]}"><span class="ck${on ? ' on' : ''}">${on ? '<i class="ti ti-check"></i>' : ''}</span>${f[1]}</label>`;
    }).join('')}
 <div class="fprev"><b>${esc(L(t.en, t.ar))}</b>${t.code ? `<div style="display:flex;gap:4px">${['A', 'B', 'C', 'D'].map(c => `<span class="cdb" style="background:var(--tone-${c === 'C' ? 'orange' : c === 'D' ? 'red' : 'green'}-${c === t.code ? 'solid' : 'tint'});color:${c === t.code ? '#fff' : `var(--tone-${c === 'C' ? 'orange' : c === 'D' ? 'red' : 'green'}-fg)`}">Code ${c}</span>`).join('')}</div>` : ''}${(t.form || ['comment']).includes('comment') ? `<span class="fl">${L('Comments…', 'ملاحظات…')}</span>` : ''}${(t.form || []).includes('files') ? `<span class="fl"><i class="ti ti-paperclip"></i>&nbsp;${L('Attach files', 'إرفاق')}</span>` : ''}${t.sign ? `<span class="sg"><i class="ti ti-signature"></i>${L('Your signature will be applied', 'سيتم تطبيق توقيعك')}</span>` : ''}<span class="cb pri sm" style="align-self:flex-end">${L('Confirm', 'تأكيد')}</span></div>
 <h6>${L('Notifications', 'الإشعارات')}</h6><div style="display:flex;flex-wrap:wrap;gap:6px">${[L('Next holder', 'المتولي التالي'), L('Raiser', 'المُنشئ'), L('Company admins', 'مسؤولو الشركة'), L('Distribution list', 'قائمة التوزيع')].map((x, i) => `<span class="m-chip" style="height:28px;font-size:12px;${i < 2 ? 'background:var(--ui-text);color:var(--ui-surface);box-shadow:none' : ''}">${x}</span>`).join('')}</div><div style="font-size:12px;color:var(--ui-muted)">${L('Channels: in-app · email', 'القنوات: داخل التطبيق · البريد')}</div>
 <button class="cb sm" data-act="del" style="color:var(--tone-red-fg);align-self:flex-start"><i class="ti ti-trash"></i>${L('Delete transition', 'حذف الانتقال')}</button>`;
  }
  function builder() {
    const d = V.ed,
      errs = validate(d);
    const ne = errs.filter(e => e.lv === 'err').length;
    const sim = V.sim;
    let scls = {},
      ecls = {};
    if (sim) {
      Object.keys(d.S).forEach(k => scls[k] = sim.path.includes(k) ? 'done' : 'fade');
      scls[sim.at] = 'cur';
      Object.entries(d.T).forEach(([k, t]) => {
        ecls[k] = sim.edges.includes(k) ? 'done' : t.f === sim.at && ok(t) ? 'next' : 'fade';
      });
    }
    return `<div class="bld"><div class="btop"><button class="cb ter sm" data-page="detail"><i class="ti ti-arrow-left"></i></button><h2>${L('Material Submittal – 2-tier review', 'اعتماد المواد – مراجعة على مستويين')}</h2><span class="vs draft">${L('Draft', 'مسودة')} v4${V.dirty ? ' · ' + L('unsaved changes', 'تغييرات غير محفوظة') : ''}</span><span class="sp"></span><button class="cb ic" data-act="undo"${V.undo.length ? '' : ' disabled'}><i class="ti ti-arrow-back-up"></i></button><button class="cb ic" data-act="redo"${V.redo.length ? '' : ' disabled'}><i class="ti ti-arrow-forward-up"></i></button><button class="cb" data-act="layout"><i class="ti ti-layout-grid"></i>${L('Auto-layout', 'ترتيب تلقائي')}</button><button class="cb${sim ? ' on' : ''}" data-act="sim"><i class="ti ti-player-play"></i>${L('Test run', 'تشغيل تجريبي')}</button><button class="cb" data-act="val"><i class="ti ti-${ne ? 'alert-triangle' : 'circle-check'}"></i>${L('Validate', 'تحقق')}</button><button class="cb pri" data-act="publish"><i class="ti ti-upload"></i>${L('Publish', 'نشر')}</button></div>
 <div class="bgrid"><aside class="card bpal"><h6>${L('Add', 'إضافة')}</h6><button class="pal" data-add="step"><i class="ti ti-square-plus"></i>${L('Step', 'خطوة')}</button>${Object.entries(END).map(([k, e]) => `<button class="pal" data-add="end:${k}"><i class="e" style="background:var(--tone-${e[2]}-tint);box-shadow:inset 0 0 0 2px var(--tone-${e[2]}-solid)"></i>${L('End · ', 'نهاية · ')}${L(e[0], e[1])}</button>`).join('')}<h6>${L('Templates', 'قوالب')}</h6><button class="pal" data-add="tpl1"><i class="ti ti-template"></i>${L('2-tier internal review', 'مراجعة داخلية على مستويين')}</button><button class="pal" data-add="tpl2"><i class="ti ti-template"></i>${L('Consultant engineer → manager', 'مهندس الاستشاري ← المدير')}</button></aside>
 <section class="wcv"><div class="wstage" id="wst"><div id="wwrap">${renderDiagram({
      L,
      S: d.S,
      T: d.T,
      sel: V.sel,
      rtl: false,
      scls,
      ecls
    })}</div></div>${ctl()}<div class="wmini">${Object.values(d.S).map(s => `<i style="left:${s.x / W * 170}px;top:${s.y / H * 85}px;width:${(s.end ? 170 : 200) / W * 170}px;height:${(s.end ? 46 : 78) / H * 85}px"></i>`).join('')}<em id="wmv"></em></div>
 ${sim ? `<div class="simbar"><i class="ti ti-player-play"></i><b>${L('Test run', 'تشغيل تجريبي')}</b><span>${L('Sample: MAR · cost impact', 'عينة: MAR · أثر التكلفة')} <select data-cost style="height:26px;border-radius:5px;border:0;font:inherit;font-size:12px"><option value="620000"${V.cost > 500000 ? ' selected' : ''}>620,000 SAR</option><option value="120000"${V.cost <= 500000 ? ' selected' : ''}>120,000 SAR</option></select></span><span style="opacity:.7">·</span>${d.S[sim.at].end ? `<b>${L('Finished: ', 'انتهى: ')}${L(END[d.S[sim.at].end][0], END[d.S[sim.at].end][1])}</b>` : `${L('At', 'عند')} <b>${esc(L(d.S[sim.at].en, d.S[sim.at].ar))}</b> — ${Object.entries(d.T).filter(([k, t]) => t.f === sim.at && ok(t)).map(([k, t]) => `<button class="cb sm pri" data-go="${k}">${esc(L(t.en, t.ar))}</button>`).join('')}`}<span style="flex:1"></span><button class="cb sm ter" data-act="simreset"><i class="ti ti-refresh"></i>${L('Restart', 'إعادة')}</button><button class="cb sm ter" data-act="sim"><i class="ti ti-x"></i></button></div>` : ''}</section>
 <aside class="card bside">${side()}</aside>
 <section class="card bval"><div class="h"><i class="ti ti-${ne ? 'alert-triangle' : 'circle-check'}" style="color:var(--tone-${ne ? 'red' : 'green'}-solid)"></i>${ne ? L(`${ne} errors`, `${ne} أخطاء`) : L('No errors', 'لا أخطاء')}${errs.length - ne ? ` · ${errs.length - ne} ${L('warning', 'تحذير')}` : ''}</div>${errs.map(e => `<button class="vi" data-vgo="${e.id}"><i class="ti ti-${e.lv === 'err' ? 'circle-x' : 'alert-triangle'}" style="color:var(--tone-${e.lv === 'err' ? 'red' : 'amber'}-solid)"></i>${esc(L(e.msg[0], e.msg[1]))}<i class="ti ti-focus-2" style="margin-inline-start:auto;color:var(--ui-faint)"></i></button>`).join('')}</section></div></div>`;
  }
  const ok = t => !t.cond || t.cond.every(c => c.f !== 'cost_impact' && c.f !== 'cost_impact_sar' || (c.op === '>' ? V.cost > +c.v : V.cost < +c.v));
  /* ---- modals ---- */
  function diff(a, b) {
    const out = {
      add: [],
      rem: [],
      chg: []
    };
    const ks = (x, y) => [...new Set([...Object.keys(x), ...Object.keys(y)])];
    ks(a.S, b.S).forEach(k => {
      if (!a.S[k]) out.add.push(['s', k]);else if (!b.S[k]) out.rem.push(['s', k]);else if (a.S[k].en !== b.S[k].en || a.S[k].co !== b.S[k].co || a.S[k].out !== b.S[k].out) out.chg.push(['s', k]);
    });
    ks(a.T, b.T).forEach(k => {
      if (!a.T[k]) out.add.push(['t', k]);else if (!b.T[k]) out.rem.push(['t', k]);else if (JSON.stringify(a.T[k]) !== JSON.stringify(b.T[k])) out.chg.push(['t', k]);
    });
    return out;
  }
  const nm = (d, x) => x[0] === 's' ? d.S[x[1]].end ? L(END[d.S[x[1]].end][0], END[d.S[x[1]].end][1]) : L(d.S[x[1]].en, d.S[x[1]].ar) : L(d.T[x[1]].en, d.T[x[1]].ar) + ' (' + L('button', 'زر') + ')';
  function chList(a, b, df) {
    return `<div class="chg">${df.add.map(x => `<div><i class="ti ti-plus" style="color:var(--tone-green-solid)"></i>${L('Added', 'أُضيف')} ${esc(nm(b, x))}</div>`).join('')}${df.rem.map(x => `<div><i class="ti ti-minus" style="color:var(--tone-red-solid)"></i>${L('Removed', 'أُزيل')} ${esc(nm(a, x))}</div>`).join('')}${df.chg.map(x => `<div><i class="ti ti-pencil" style="color:var(--tone-orange-solid)"></i>${L('Changed', 'تغيّر')} ${esc(nm(b, x))}${x[0] === 't' && a.T[x[1]].sign !== b.T[x[1]].sign ? ` — ${L('signature', 'التوقيع')} ${b.T[x[1]].sign ? L('on', 'مفعّل') : L('off', 'معطّل')}` : ''}${x[0] === 't' && JSON.stringify(a.T[x[1]].cond) !== JSON.stringify(b.T[x[1]].cond) ? ` — ${L('condition', 'الشرط')}` : ''}</div>`).join('') || `<div style="color:var(--ui-muted)">${L('No changes', 'لا تغييرات')}</div>`}</div>`;
  }
  function modal() {
    if (!V.modal) return '';
    const x = `<button class="cb ter sm ic x" data-close="1"><i class="ti ti-x"></i></button>`;
    if (V.modal === 'publish') {
      const d = V.ed || draft();
      const a = VERS.find(v => v.v === 3);
      const df = diff(a, d);
      const errs = validate(d).filter(e => e.lv === 'err');
      return `<div class="scrim" data-close="1"><div class="wmdl" data-stop><div class="mh"><i class="ti ti-upload" style="color:var(--btn-pri)"></i><b>${L('Publish v4', 'نشر v4')}</b>${x}</div><div class="mb"><h6 style="margin:0;font-size:11px;color:var(--ui-faint);text-transform:uppercase;letter-spacing:.06em">${L('Changes since v3', 'التغييرات منذ v3')}</h6>${chList(a, d, df)}
  ${errs.length ? `<div class="okb" style="background:var(--tone-red-tint);color:var(--tone-red-fg)"><i class="ti ti-circle-x"></i>${L(`${errs.length} validation errors — fix them before publishing.`, `${errs.length} أخطاء تحقق — أصلحها قبل النشر.`)}<button class="cb sm" data-act="tobuilder" style="margin-inline-start:auto">${L('Open builder', 'فتح المحرر')}</button></div>` : `<div class="okb" style="background:var(--tone-green-tint);color:var(--tone-green-fg)"><i class="ti ti-circle-check"></i>${L('Validation passed', 'اجتاز التحقق')}</div>`}
  <label style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;font-weight:600">${L('Change note', 'ملاحظة التغيير')} *<textarea id="pnote" rows="3" style="border:0;border-radius:6px;padding:8px 10px;background:var(--fld-bg);box-shadow:inset 0 0 0 1px ${V.noteErr ? 'var(--tone-red-solid)' : 'var(--fld-bd)'};font:inherit;font-size:13.5px;color:var(--fld-txt)" placeholder="${L('What changed and why?', 'ما الذي تغيّر ولماذا؟')}">${esc(V.pubNote)}</textarea></label>
  <div class="okb" style="background:var(--tone-blue-tint);color:var(--tone-blue-fg);font-weight:500"><i class="ti ti-info-circle"></i>${L('31 items on v3 and 16 on older versions keep their version. New items will use v4.', '31 عنصرًا على v3 و16 على إصدارات أقدم تحتفظ بإصداراتها. العناصر الجديدة ستستخدم v4.')}</div></div>
  <div class="mf"><button class="cb" data-close="1">${L('Cancel', 'إلغاء')}</button><button class="cb pri" data-act="dopub"${errs.length ? ' disabled' : ''}><i class="ti ti-upload"></i>${L('Publish v4', 'نشر v4')}</button></div></div></div>`;
    }
    if (V.modal.startsWith('cmp')) {
      const bv = +V.modal.slice(3),
        a = VERS.find(v => v.v === bv - 1),
        b = VERS.find(v => v.v === bv);
      const df = diff(a, b);
      const sa = {},
        sb = {},
        ea = {},
        eb = {};
      df.add.forEach(x => (x[0] === 's' ? sb : eb)[x[1]] = 'add');
      df.rem.forEach(x => (x[0] === 's' ? sa : ea)[x[1]] = 'rem');
      df.chg.forEach(x => {
        (x[0] === 's' ? sa : ea)[x[1]] = 'chg';
        (x[0] === 's' ? sb : eb)[x[1]] = 'chg';
      });
      return `<div class="scrim" data-close="1"><div class="wmdl wide" data-stop><div class="mh"><i class="ti ti-arrows-diff"></i><b>${L('Compare', 'مقارنة')} v${a.v} → v${b.v}</b><span style="display:flex;gap:10px;font-size:12px;margin-inline-start:12px"><span style="color:var(--tone-green-fg)">■ ${L('added', 'مضاف')}</span><span style="color:var(--tone-red-fg)">■ ${L('removed', 'محذوف')}</span><span style="color:var(--tone-orange-fg)">■ ${L('changed', 'متغيّر')}</span></span>${x}</div><div class="mb"><div class="cmpg"><div><b style="font-size:13px">v${a.v}</b><div class="wcv"><div class="wstage cmps">${renderDiagram({
        L,
        S: a.S,
        T: a.T,
        scls: sa,
        ecls: ea
      })}</div></div></div><div><b style="font-size:13px">v${b.v}</b><div class="wcv"><div class="wstage cmps">${renderDiagram({
        L,
        S: b.S,
        T: b.T,
        scls: sb,
        ecls: eb
      })}</div></div></div></div>${chList(a, b, df)}</div></div></div>`;
    }
    return '';
  }
  function view() {
    if (V.page === 'builder') return builder() + modal() + toast();
    return `<div class="st-wrap">${nav()}<div class="st-main">${V.page === 'types' ? types() : V.page === 'detail' ? detail() : list()}</div></div>${modal()}${toast()}`;
  }
  const toast = () => V.toast ? `<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>` : '';
  /* ---- transform ---- */
  function applyT() {
    const w = document.querySelector('#wst .wworld');
    if (!w) return;
    w.style.transform = `translate(${V.tx}px,${V.ty}px) scale(${V.k})`;
    const m = document.getElementById('wmv'),
      s = document.getElementById('wst');
    if (m && s) {
      const r = s.getBoundingClientRect();
      m.style.left = -V.tx / V.k / W * 170 + 'px';
      m.style.top = -V.ty / V.k / H * 85 + 'px';
      m.style.width = r.width / V.k / W * 170 + 'px';
      m.style.height = r.height / V.k / H * 85 + 'px';
    }
    document.querySelectorAll('.cmps .wworld').forEach(x => {
      const r = x.parentElement.getBoundingClientRect();
      const k = Math.min(r.width / W, r.height / H);
      x.style.transform = `translate(${(r.width - W * k) / 2}px,6px) scale(${k})`;
    });
  }
  function fit() {
    const s = document.getElementById('wst');
    if (!s) return;
    const r = s.getBoundingClientRect();
    V.k = Math.min(r.width / W, r.height / (H + 40)) * .97;
    V.tx = (r.width - W * V.k) / 2;
    V.ty = 10;
    applyT();
  }
  function after() {
    if (V.fitNext) {
      V.fitNext = false;
      fit();
    } else applyT();
  }
  /* ---- bind ---- */
  function bind(root, R) {
    let tt;
    const flash = m => {
      V.toast = m;
      R();
      clearTimeout(tt);
      tt = setTimeout(() => {
        V.toast = null;
        R();
      }, 2400);
    };
    const snap = () => {
      V.undo.push(JSON.stringify(V.ed));
      V.redo = [];
      V.dirty = true;
    };
    const cur = () => V.ed.S[V.sel] || V.ed.T[V.sel];
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-menu],[data-tab],[data-open],[data-page],[data-dtab],[data-cmp],[data-act],[data-snav],[data-z],[data-add],[data-s],[data-t],[data-tt],[data-crm],[data-ff],[data-vgo],[data-go],[data-close]');
      if (!b) {
        if (V.menu) {
          V.menu = null;
          R();
        }
        return;
      }
      if (b.closest('.hd,.tabs,.sb')) return;
      const d = b.dataset;
      if (d.close !== undefined) {
        if (e.target.closest('[data-stop]') && !b.closest('button')) return;
        V.modal = null;
        return R();
      }
      if (d.menu) {
        e.stopPropagation();
        V.menu = V.menu === d.menu ? null : d.menu;
        return R();
      }
      if (d.tab) {
        V.tab = d.tab;
        V.menu = null;
        V.page = 'list';
        return R();
      }
      if (d.snav) {
        if (d.snav === 'numbering') {
          location.href = 'settings-numbering.html';
          return;
        }
        V.page = d.snav === 'types' ? 'types' : d.snav === 'workflows' ? 'list' : V.page;
        if (!['types', 'workflows'].includes(d.snav)) return flash(L('Not designed yet', 'لم يُصمَّم بعد'));
        return R();
      }
      if (d.open) {
        V.wid = d.open;
        V.page = 'detail';
        V.dtab = 'diagram';
        V.ver = 3;
        V.fitNext = true;
        return R();
      }
      if (d.page) {
        V.page = d.page;
        V.fitNext = true;
        V.sim = null;
        if (d.page === 'builder' && !V.ed) {
          V.ed = clone(draft());
          V.sel = null;
        }
        return R();
      }
      if (d.dtab) {
        V.dtab = d.dtab;
        V.fitNext = true;
        return R();
      }
      if (d.cmp) {
        V.modal = 'cmp' + d.cmp;
        R();
        return requestAnimationFrame(applyT);
      }
      if (d.z) {
        if (d.z === 'fit') return fit();
        const s = document.getElementById('wst').getBoundingClientRect(),
          f = d.z === 'in' ? 1.2 : 1 / 1.2;
        V.tx = s.width / 2 - (s.width / 2 - V.tx) * f;
        V.ty = s.height / 2 - (s.height / 2 - V.ty) * f;
        V.k *= f;
        return applyT();
      }
      if (d.add) {
        snap();
        const id = 'n' + Date.now();
        if (d.add === 'step') V.ed.S[id] = {
          en: 'New step',
          ar: 'خطوة جديدة',
          stage: 'internal',
          co: 'ctr',
          perm: 'Review',
          out: 'none',
          x: 300,
          y: 470,
          ic: 'ti-user'
        };else if (d.add.startsWith('end:')) V.ed.S[id] = {
          end: d.add.slice(4),
          x: 1110,
          y: 600
        };else {
          const a = id + 'a',
            c = id + 'c';
          Object.assign(V.ed.S, {
            [a]: {
              en: d.add === 'tpl1' ? 'Engineer review' : 'Consultant engineer',
              ar: 'مراجعة المهندس',
              stage: d.add === 'tpl1' ? 'internal' : 'pending',
              co: d.add === 'tpl1' ? 'ctr' : 'cns',
              perm: 'Review',
              out: 'none',
              x: d.add === 'tpl1' ? 280 : 530,
              y: 520,
              ic: 'ti-user'
            },
            [c]: {
              en: d.add === 'tpl1' ? 'PM review' : 'Consultant manager',
              ar: 'مراجعة المدير',
              stage: d.add === 'tpl1' ? 'internal' : 'pending',
              co: d.add === 'tpl1' ? 'ctr' : 'cns',
              perm: 'Approve',
              out: d.add === 'tpl1' ? 'none' : 'final',
              x: d.add === 'tpl1' ? 280 : 810,
              y: 600,
              ic: 'ti-user-check'
            }
          });
          V.ed.T[id + 't'] = {
            f: a,
            to: c,
            en: 'Send',
            ar: 'إرسال',
            type: 'send'
          };
          V.ed.T[id + 'r'] = {
            f: c,
            to: a,
            en: 'Return',
            ar: 'إرجاع',
            type: 'return'
          };
        }
        V.sel = d.add === 'step' || d.add.startsWith('end') ? id : null;
        return R();
      }
      if (d.go) {
        const t = V.ed.T[d.go];
        V.sim.at = t.to;
        V.sim.path.push(t.to);
        V.sim.edges.push(d.go);
        return R();
      }
      if (d.vgo) {
        V.sel = d.vgo;
        R();
        const s = V.ed.S[d.vgo] || V.ed.S[V.ed.T[d.vgo].f];
        const r = document.getElementById('wst').getBoundingClientRect();
        V.k = Math.max(V.k, .9);
        V.tx = r.width / 2 - (s.x + 100) * V.k;
        V.ty = r.height / 2 - (s.y + 40) * V.k;
        return applyT();
      }
      if (d.tt) {
        snap();
        cur().type = d.tt;
        if (d.tt === 'submit') cur().sign = cur().sign;
        return R();
      }
      if (d.crm !== undefined) {
        snap();
        cur().cond.splice(+d.crm, 1);
        if (!cur().cond.length) delete cur().cond;
        return R();
      }
      if (d.ff) {
        snap();
        const t = cur();
        t.form = t.form || ['comment'];
        t.form.includes(d.ff) ? t.form = t.form.filter(x => x !== d.ff) : t.form.push(d.ff);
        return R();
      }
      const a = d.act;
      if (a) {
        V.menu = null;
        if (a === 'toggleempty') {
          V.empty = !V.empty;
          return R();
        }
        if (a === 'newblank') {
          V.page = 'builder';
          V.ed = {
            S: {
              s1: {
                en: 'Contractor Engineer',
                ar: 'مهندس المقاول',
                stage: 'drafts',
                co: 'ctr',
                perm: 'Create',
                out: 'none',
                x: 30,
                y: 250,
                ic: 'ti-user'
              }
            },
            T: {}
          };
          V.sel = 's1';
          V.fitNext = true;
          return R();
        }
        if (a === 'copy' || a === 'tolib') return flash(a === 'copy' ? L('Copied into this project as a new draft', 'تم النسخ إلى المشروع كمسودة جديدة') : L('Copied to company library', 'تم النسخ إلى مكتبة الشركة'));
        if (a === 'arch') return flash(L('Archived', 'تمت الأرشفة'));
        if (a === 'publish') {
          V.modal = 'publish';
          V.pubNote = '';
          V.noteErr = false;
          if (!V.ed) V.ed = clone(draft());
          return R();
        }
        if (a === 'tobuilder') {
          V.modal = null;
          V.page = 'builder';
          V.fitNext = true;
          return R();
        }
        if (a === 'dopub') {
          const n = document.getElementById('pnote');
          V.pubNote = n ? n.value : '';
          if (!V.pubNote.trim()) {
            V.noteErr = true;
            return R();
          }
          const d4 = draft();
          Object.assign(d4, {
            st: 'pub',
            by: 'Sara Al Mansoori',
            date: '26 Sep 2026',
            note: [V.pubNote, V.pubNote],
            S: clone(V.ed.S),
            T: clone(V.ed.T)
          });
          LIB.project[0].runs.push(0);
          LIB.project[0].draft = 0;
          V.modal = null;
          V.page = 'detail';
          V.dtab = 'versions';
          V.dirty = false;
          V.ed = null;
          return flash(L('v4 published — new items will use it', 'تم نشر v4 — العناصر الجديدة ستستخدمه'));
        }
        if (a === 'undo' && V.undo.length) {
          V.redo.push(JSON.stringify(V.ed));
          V.ed = JSON.parse(V.undo.pop());
          return R();
        }
        if (a === 'redo' && V.redo.length) {
          V.undo.push(JSON.stringify(V.ed));
          V.ed = JSON.parse(V.redo.pop());
          return R();
        }
        if (a === 'layout') {
          snap();
          const base = WF.S0;
          Object.keys(V.ed.S).forEach((k, i) => {
            if (base[k]) {
              V.ed.S[k].x = base[k].x;
              V.ed.S[k].y = base[k].y;
            } else {
              V.ed.S[k].x = Math.round(V.ed.S[k].x / 20) * 20;
              V.ed.S[k].y = Math.round(V.ed.S[k].y / 20) * 20;
            }
          });
          V.fitNext = true;
          return R();
        }
        if (a === 'sim') {
          V.sim = V.sim ? null : {
            at: 's1',
            path: ['s1'],
            edges: []
          };
          V.sel = null;
          return R();
        }
        if (a === 'simreset') {
          V.sim = {
            at: 's1',
            path: ['s1'],
            edges: []
          };
          return R();
        }
        if (a === 'val') {
          const n = validate(V.ed).filter(x => x.lv === 'err').length;
          return flash(n ? L(`${n} errors to fix`, `${n} أخطاء للإصلاح`) : L('Validation passed', 'اجتاز التحقق'));
        }
        if (a === 'sign') {
          snap();
          cur().sign = cur().sign ? 0 : 1;
          return R();
        }
        if (a === 'cadd') {
          snap();
          const t = cur();
          t.cond = t.cond || [];
          t.cond.push({
            f: 'cost_impact',
            op: '>',
            v: '0'
          });
          return R();
        }
        if (a === 'del') {
          snap();
          if (V.ed.S[V.sel]) {
            delete V.ed.S[V.sel];
            Object.keys(V.ed.T).forEach(k => {
              const t = V.ed.T[k];
              if (t.f === V.sel || t.to === V.sel) delete V.ed.T[k];
            });
          } else delete V.ed.T[V.sel];
          V.sel = null;
          return R();
        }
      }
      if (V.page === 'builder' && !V.sim && (d.s || d.t)) {
        V.sel = d.s || d.t;
        return R();
      }
    });
    root.addEventListener('change', e => {
      const i = e.target;
      if (i.dataset.ver) {
        V.ver = +i.value;
        V.fitNext = true;
        return R();
      }
      if (i.dataset.cost) {
        V.cost = +i.value;
        return R();
      }
      if (i.dataset.wit) {
        V.types[i.dataset.wit] = i.value;
        return flash(L('Saved — only new items use the new workflow. Running items keep theirs.', 'تم الحفظ — العناصر الجديدة فقط تستخدم سير العمل الجديد.'));
      }
      if (i.dataset.f && i.tagName === 'SELECT') {
        snap();
        cur()[i.dataset.f] = i.value;
        return R();
      }
      if (i.dataset.cf) {
        snap();
        const [n, k] = i.dataset.cf.split(':');
        cur().cond[+n][k] = i.value;
        return R();
      }
    });
    root.addEventListener('input', e => {
      const i = e.target;
      if (i.dataset.f && i.tagName === 'INPUT') {
        if (!V.dirty) snap();
        cur()[i.dataset.f] = i.value;
        V.dirty = true;
        const lb = root.querySelector(`.wl[data-t="${V.sel}"]`),
          nd = root.querySelector(`.wn[data-s="${V.sel}"] b`);
        const txt = L(cur().en, cur().ar);
        if (lb) lb.lastChild.textContent = txt;
        if (nd) nd.textContent = txt;
      }
      if (i.dataset.cf && i.tagName === 'INPUT') {
        cur().cond[+i.dataset.cf.split(':')[0]].v = i.value;
      }
    });
    let P = null;
    root.addEventListener('pointerdown', e => {
      const st = e.target.closest('#wst');
      if (!st || e.button !== 0 || e.target.closest('.wl')) return;
      const n = e.target.closest('.wn[data-s]');
      P = {
        x: e.clientX,
        y: e.clientY,
        tx: V.tx,
        ty: V.ty,
        n: V.page === 'builder' && !V.sim && n ? n.dataset.s : null,
        moved: false
      };
      if (P.n) {
        const s = V.ed.S[P.n];
        P.sx = s.x;
        P.sy = s.y;
      }
    });
    addEventListener('pointermove', e => {
      if (!P) return;
      const dx = e.clientX - P.x,
        dy = e.clientY - P.y;
      if (!P.moved && Math.hypot(dx, dy) > 4) {
        P.moved = true;
        if (P.n) snap();
      }
      if (!P.moved) return;
      if (P.n) {
        const s = V.ed.S[P.n];
        s.x = Math.round((P.sx + dx / V.k) / 20) * 20;
        s.y = Math.round((P.sy + dy / V.k) / 20) * 20;
        const w = document.getElementById('wwrap');
        w.innerHTML = renderDiagram({
          L,
          S: V.ed.S,
          T: V.ed.T,
          sel: V.sel
        });
        applyT();
      } else {
        V.tx = P.tx + dx;
        V.ty = P.ty + dy;
        applyT();
      }
    });
    addEventListener('pointerup', () => {
      if (P && P.moved && P.n) R();
      P = null;
    });
    root.addEventListener('wheel', e => {
      const st = e.target.closest('#wst');
      if (!st) return;
      e.preventDefault();
      const r = st.getBoundingClientRect(),
        cx = e.clientX - r.left,
        cy = e.clientY - r.top,
        f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      V.tx = cx - (cx - V.tx) * f;
      V.ty = cy - (cy - V.ty) * f;
      V.k *= f;
      applyT();
    }, {
      passive: false
    });
    addEventListener('resize', () => applyT());
    document.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input,textarea,select')) return;
      if (e.key === 'Escape') {
        V.modal = null;
        V.sel = null;
        R();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && V.page === 'builder') {
        e.preventDefault();
        root.querySelector('[data-act=' + (e.shiftKey ? 'redo' : 'undo') + ']')?.click();
      }
    });
  }
  window.WA = {
    V,
    view,
    bind,
    after
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/wf/wf.js", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Segmented = __ds_scope.Segmented;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
