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

function initials(name: string): string {
  const cleaned = (name || '').trim();
  if (!cleaned) return '?';
  // "Speaker 1" → "S1", "Ofir Menda" → "OM"
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) {
    const p = parts[0];
    return p.length >= 2 ? (p[0] + p[p.length - 1]).toUpperCase() : p[0].toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Round speaker avatar — image if available, else initials over the speaker color. */
export default function SpeakerAvatar({
  speakerId, name, color, imagePath, size = 24, className = '', bust,
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
          borderColor: color,
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
        backgroundColor: color,
        fontSize,
        lineHeight: 1,
        borderWidth,
        borderStyle: 'solid',
        borderColor: 'rgba(255,255,255,0.15)',
      }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}
