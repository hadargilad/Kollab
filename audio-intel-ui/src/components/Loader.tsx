// Page-level loading indicator: 5 pulsing dots. The project doesn't use
// styled-components, so the original styled snippet is reproduced inline:
// keyframes scoped via a single <style> tag (rendered once per page mount,
// fine — same keyframe name everywhere is allowed because the CSS spec
// resolves to one rule).

export default function Loader() {
  return (
    <div className="flex items-center justify-center w-full py-20">
      <style>{`
        @keyframes kollab-dot-pulse {
          0% {
            transform: scale(0.8);
            background-color: #b3d4fc;
            box-shadow: 0 0 0 0 rgba(178, 212, 252, 0.7);
          }
          50% {
            transform: scale(1.2);
            background-color: #6793fb;
            box-shadow: 0 0 0 10px rgba(178, 212, 252, 0);
          }
          100% {
            transform: scale(0.8);
            background-color: #b3d4fc;
            box-shadow: 0 0 0 0 rgba(178, 212, 252, 0.7);
          }
        }
      `}</style>
      <div className="flex items-center gap-2.5">
        {[-0.3, -0.1, 0.1, 0.3, 0.5].map((delay) => (
          <span
            key={delay}
            className="block h-5 w-5 rounded-full"
            style={{
              backgroundColor: '#b3d4fc',
              animation: 'kollab-dot-pulse 1.5s infinite ease-in-out',
              animationDelay: `${delay}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
