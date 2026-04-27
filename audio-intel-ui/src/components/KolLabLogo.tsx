interface Props {
  size?: number;
}

export default function KolLabLogo({ size = 40 }: Props) {
  const bars: [number, number][] = [
    [16, 2.5], [19.5, 5], [23, 8.5], [26.5, 12.5],
    [30, 16], [33.5, 18.5], [37, 15], [40.5, 11],
  ];

  const nodes: [number, number][] = [
    [69, 15], [83, 30], [88, 49], [82, 67], [68, 79], [64, 46],
  ];

  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [1, 5], [2, 5], [3, 5], [4, 5],
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="kl-arc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <filter id="kl-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="kl-node-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Dark navy background */}
      <circle cx="50" cy="50" r="50" fill="#06091e" />

      {/* Arc — covers ~252°, gap at top-right where network extends */}
      <path
        d="M 64,17 A 36,36 0 1 0 78,73"
        stroke="url(#kl-arc)"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Waveform bars */}
      {bars.map(([x, h], i) => (
        <line
          key={i}
          x1={x} y1={50 - h}
          x2={x} y2={50 + h}
          stroke="#06d6f8"
          strokeWidth="2"
          strokeLinecap="round"
          filter="url(#kl-glow)"
        />
      ))}

      {/* Network edges */}
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]} y1={nodes[a][1]}
          x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="#3b82f6"
          strokeWidth="1.2"
          opacity="0.7"
        />
      ))}

      {/* Network nodes */}
      {nodes.map(([x, y], i) => (
        <circle
          key={i}
          cx={x} cy={y}
          r={i === 2 ? 3.8 : 2.8}
          fill="#1e3a8a"
          stroke="#3b82f6"
          strokeWidth="1.3"
          filter="url(#kl-node-glow)"
        />
      ))}

      {/* K — vertical bar */}
      <line x1="37" y1="32" x2="37" y2="68" stroke="white" strokeWidth="6" strokeLinecap="round" />
      {/* K — upper arm */}
      <line x1="37" y1="50" x2="57" y2="32" stroke="white" strokeWidth="5.5" strokeLinecap="round" />
      {/* K — lower arm */}
      <line x1="37" y1="50" x2="57" y2="68" stroke="white" strokeWidth="5.5" strokeLinecap="round" />
    </svg>
  );
}
