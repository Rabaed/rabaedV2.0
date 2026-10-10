import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowForwardUp,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconArrowsSort,
  IconBan,
  IconBell,
  IconBuilding,
  IconCalendar,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconChevronUp,
  IconCircleCheck,
  IconCircleX,
  IconClipboardCheck,
  IconClipboardList,
  IconClock,
  IconCopy,
  IconDots,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconFile,
  IconFileText,
  IconFilter,
  IconFlag,
  IconFolder,
  IconGitBranch,
  IconHelpCircle,
  IconHistory,
  IconHome,
  IconInfoCircle,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconLink,
  IconList,
  IconLock,
  IconMaximize,
  IconLogin,
  IconLogout,
  IconMapPin,
  IconMenu2,
  IconMessage,
  IconMessageCircle,
  IconMinus,
  IconPaperclip,
  IconPhoto,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconSearch,
  IconSend,
  IconSettings,
  IconShare,
  IconSignature,
  IconSortAscending,
  IconSortDescending,
  IconStar,
  IconTable,
  IconTag,
  IconTrash,
  IconUpload,
  IconUser,
  IconUsers,
  IconX,
  IconZoomIn,
  IconZoomOut,
  IconFocus2,
  IconPlayerPlay,
  IconSquarePlus,
  IconTemplate,
  type Icon as TablerIcon,
} from "@tabler/icons-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

/**
 * The Rabaed icon set: Tabler icons (outline, the look of the designs),
 * bundled into our own code, so no icon font or CDN request. To add an icon,
 * import it from @tabler/icons-react and register it here; mark it
 * directional if it points along the reading direction.
 */
const icons = {
  "alert-circle": IconAlertCircle,
  "alert-triangle": IconAlertTriangle,
  "arrow-back-up": IconArrowBackUp,
  "arrow-down": IconArrowDown,
  "arrow-forward-up": IconArrowForwardUp,
  "arrow-left": IconArrowLeft,
  "arrow-right": IconArrowRight,
  "arrow-up": IconArrowUp,
  "arrows-sort": IconArrowsSort,
  ban: IconBan,
  bell: IconBell,
  building: IconBuilding,
  calendar: IconCalendar,
  camera: IconCamera,
  check: IconCheck,
  "chevron-down": IconChevronDown,
  "chevron-left": IconChevronLeft,
  "chevron-right": IconChevronRight,
  "chevron-up": IconChevronUp,
  "chevrons-left": IconChevronsLeft,
  "chevrons-right": IconChevronsRight,
  "circle-check": IconCircleCheck,
  "circle-x": IconCircleX,
  "clipboard-check": IconClipboardCheck,
  "clipboard-list": IconClipboardList,
  clock: IconClock,
  copy: IconCopy,
  dots: IconDots,
  "dots-vertical": IconDotsVertical,
  download: IconDownload,
  edit: IconEdit,
  "external-link": IconExternalLink,
  eye: IconEye,
  "eye-off": IconEyeOff,
  file: IconFile,
  "file-text": IconFileText,
  filter: IconFilter,
  flag: IconFlag,
  folder: IconFolder,
  "git-branch": IconGitBranch,
  "help-circle": IconHelpCircle,
  history: IconHistory,
  home: IconHome,
  "info-circle": IconInfoCircle,
  "layout-dashboard": IconLayoutDashboard,
  "layout-grid": IconLayoutGrid,
  link: IconLink,
  list: IconList,
  lock: IconLock,
  maximize: IconMaximize,
  login: IconLogin,
  logout: IconLogout,
  "map-pin": IconMapPin,
  menu: IconMenu2,
  message: IconMessage,
  "message-circle": IconMessageCircle,
  minus: IconMinus,
  paperclip: IconPaperclip,
  photo: IconPhoto,
  plus: IconPlus,
  printer: IconPrinter,
  refresh: IconRefresh,
  search: IconSearch,
  send: IconSend,
  settings: IconSettings,
  share: IconShare,
  signature: IconSignature,
  "sort-ascending": IconSortAscending,
  "sort-descending": IconSortDescending,
  star: IconStar,
  table: IconTable,
  tag: IconTag,
  trash: IconTrash,
  upload: IconUpload,
  user: IconUser,
  users: IconUsers,
  x: IconX,
  "zoom-in": IconZoomIn,
  "zoom-out": IconZoomOut,
  "focus-2": IconFocus2,
  "player-play": IconPlayerPlay,
  "square-plus": IconSquarePlus,
  template: IconTemplate,
} satisfies Record<string, TablerIcon>;

export type IconName = keyof typeof icons;
export const iconNames = Object.keys(icons) as IconName[];

/** Icons that point along the reading direction, so they flip in right-to-left layouts. */
export const directionalIconNames: ReadonlySet<IconName> = new Set<IconName>([
  "arrow-back-up",
  "arrow-forward-up",
  "arrow-left",
  "arrow-right",
  "chevron-left",
  "chevron-right",
  "chevrons-left",
  "chevrons-right",
  "login",
  "logout",
  "send",
]);

export type IconProps = Omit<ComponentProps<"svg">, "children" | "ref" | "stroke"> & {
  name: IconName;
  /** Width and height in px. */
  size?: number;
  /**
   * An accessible name, for an icon that carries meaning on its own. Without
   * it the icon is decorative and hidden from assistive tech; inside a button,
   * name the button instead (IconButton `label`).
   */
  label?: string;
  /** Flip in right-to-left layouts. Defaults to true for arrows and chevrons along the reading direction. */
  mirrorInRtl?: boolean;
};

/** One icon from the Rabaed set, drawn in the current text colour. */
export function Icon({ name, size = 20, label, mirrorInRtl = directionalIconNames.has(name), className, ...props }: IconProps) {
  const Svg = icons[name];
  return (
    <Svg
      size={size}
      stroke={1.75}
      className={cn("shrink-0", mirrorInRtl && "rtl:-scale-x-100", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      {...props}
    />
  );
}
