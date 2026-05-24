interface Props {
  size?: number;
  className?: string;
}

/**
 * KolLab brand mark. Renders `/logo.png` from the Vite public/ folder.
 * The PNG is square — pass `size` for both width & height.
 */
export default function KolLabLogo({ size = 40, className = '' }: Props) {
  return (
    <img
      src="/logo.png"
      alt="KolLab"
      width={size}
      height={size}
      className={`select-none ${className}`}
      style={{ width: size, height: size, objectFit: 'contain' }}
      draggable={false}
    />
  );
}
