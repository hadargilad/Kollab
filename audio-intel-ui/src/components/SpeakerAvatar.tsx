import { useState } from 'react';
import { API_BASE } from '../lib/api';

interface Props {
  speakerId: number;
  name: string;
  color: string;
  /** If the speaker has an uploaded image, the api returns a filename (path is opaque). */
  imagePath?: string | null;
  /** Pixel diameter. */
  size?: number;
  className?: string;
  /** Cache-buster — change this to force the <img> to re-fetch after an upload. */
  bust?: string | number;
}

// Avatars drop the speaker's per-person color entirely — uniform dark slate
// fill with a single cyan accent ring, so the whole app reads as a dark-ops
// console rather than a rainbow of flat colors. The raw `color` prop is
// still accepted (used elsewhere as the speaker's identity signal — edges,
// group rings, badges) but is no longer rendered here.
const AVATAR_FILL = '#23272f';
const AVATAR_ACCENT = 'rgba(34,211,238,0.55)';

export function initials(name: string): string {
  const cleaned = (name || '').trim();
  if (!cleaned) return '?';
  // Auto-named unknowns ("Speaker 1", "Speaker 41"...) all reduce to the same
  // "S<first digit>" under plain initials, so different people become
  // visually indistinguishable once there are more than ~9 of them. Show the
  // actual number instead — fully unique and still reads as "an unknown".
  const speakerMatch = cleaned.match(/^speaker\s+(\d+)$/i);
  if (speakerMatch) return speakerMatch[1];
  // "Ofir Menda" → "OM"
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) {
    const p = parts[0];
    return p.length >= 2 ? (p[0] + p[p.length - 1]).toUpperCase() : p[0].toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Round speaker avatar — image if available, else initials over a dark slate fill. */
export default function SpeakerAvatar({
  speakerId, name, imagePath, size = 24, className = '', bust,
}: Props) {
  const [errored, setErrored] = useState(false);
  const hasImg = !!imagePath && !errored;
  const fontSize = Math.max(9, Math.floor(size * 0.42));
  const borderWidth = size > 36 ? 2 : 1;

  if (hasImg) {
    const url = `${API_BASE}/speakers/${speakerId}/image${bust ? `?v=${bust}` : ''}`;
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{
          width: size,
          height: size,
          borderWidth,
          borderStyle: 'solid',
          borderColor: AVATAR_ACCENT,
        }}
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 font-mono font-semibold text-white select-none ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: AVATAR_FILL,
        fontSize,
        lineHeight: 1,
        borderWidth,
        borderStyle: 'solid',
        borderColor: AVATAR_ACCENT,
      }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}
