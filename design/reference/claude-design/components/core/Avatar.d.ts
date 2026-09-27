import * as React from 'react';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Full name — drives initials + auto colour. */
  name?: string;
  /** Image URL (falls back to initials). */
  src?: string | null;
  /** Diameter in px. @default 40 */
  size?: number;
  /** Presence dot. */
  status?: 'online' | 'busy' | 'away' | 'offline' | null;
  /** Tomato selection ring. */
  ring?: boolean;
}

/** Circular user avatar with image or auto-coloured initials. */
export function Avatar(props: AvatarProps): React.ReactElement;
export default Avatar;
