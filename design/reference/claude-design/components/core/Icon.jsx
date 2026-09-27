import React from 'react';

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
  lock: 'lock',
};

export function Icon({ name = 'search', size = 20, color = 'currentColor', strokeWidth, style = {}, ...rest }) {
  const id = NAMES[name] || name;
  return (
    <i
      className={`ti ti-${id}`}
      aria-hidden="true"
      style={{
        fontSize: size,
        lineHeight: 1,
        color,
        display: 'inline-flex',
        ...(strokeWidth ? { WebkitTextStroke: `${strokeWidth - 1}px currentColor` } : {}),
        ...style,
      }}
      {...rest}
    />
  );
}

export default Icon;
