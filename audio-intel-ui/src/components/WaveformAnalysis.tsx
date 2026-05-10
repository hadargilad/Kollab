import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Play, Pause, ZoomIn, ZoomOut, Download, ArrowLeft } from 'lucide-react';

interface SpeakerSegment {
  speakerId: string;
  speakerName: string;
  color: string;
  startTime: number;
  endTime: number;
  amplitude: number[];
}

const segments: SpeakerSegment[] = [
  { speakerId: 'spk-1', speakerName: 'דובר A', color: '#3b82f6', startTime: 0, endTime: 4.5,
    amplitude: Array.from({ length: 90 }, () => Math.random() * 0.8 + 0.2) },
  { speakerId: 'spk-2', speakerName: 'דובר B', color: '#a855f7', startTime: 4.5, endTime: 8.2,
    amplitude: Array.from({ length: 74 }, () => Math.random() * 0.9 + 0.1) },
  { speakerId: 'spk-1', speakerName: 'דובר A', color: '#3b82f6', startTime: 8.2, endTime: 12.8,
    amplitude: Array.from({ length: 92 }, () => Math.random() * 0.85 + 0.15) },
  { speakerId: 'spk-3', speakerName: 'דובר C', color: '#06b6d4', startTime: 12.8, endTime: 16.5,
    amplitude: Array.from({ length: 74 }, () => Math.random() * 0.7 + 0.3) },
  { speakerId: 'spk-2', speakerName: 'דובר B', color: '#a855f7', startTime: 16.5, endTime: 21.3,
    amplitude: Array.from({ length: 96 }, () => Math.random() * 0.75 + 0.25) },
  { speakerId: 'spk-1', speakerName: 'דובר A', color: '#3b82f6', startTime: 21.3, endTime: 24.0,
    amplitude: Array.from({ length: 54 }, () => Math.random() * 0.6 + 0.2) },
];

const speakerList = [
  { id: 'spk-1', name: 'דובר A', color: '#3b82f6' },
  { id: 'spk-2', name: 'דובר B', color: '#a855f7' },
  { id: 'spk-3', name: 'דובר C', color: '#06b6d4' },
];

export default function WaveformAnalysis() {
  const { id } = useParams();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [duration] = useState(24.0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerY = canvas.height / 2;
    const segmentWidth = (canvas.width * zoom) / segments.length;

    segments.forEach((segment, segmentIndex) => {
      const segmentStartX = segmentIndex * segmentWidth;
      const barWidth = segmentWidth / segment.amplitude.length;
      segment.amplitude.forEach((amp, i) => {
        const x = segmentStartX + i * barWidth;
        const height = amp * (canvas.height * 0.4);
        ctx.fillStyle = segment.color;
        ctx.fillRect(x, centerY - height / 2, Math.max(barWidth - 1, 1), height);
      });
      if (segmentIndex < segments.length - 1) {
        ctx.strokeStyle = '#18181b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(segmentStartX + segmentWidth, 0);
        ctx.lineTo(segmentStartX + segmentWidth, canvas.height);
        ctx.stroke();
      }
    });

    const currentX = (currentTime / duration) * canvas.width * zoom;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(currentX, 0);
    ctx.lineTo(currentX, canvas.height);
    ctx.stroke();

    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvas.width * zoom, centerY);
    ctx.stroke();
  }, [currentTime, zoom, duration]);

  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        setCurrentTime(prev => {
          if (prev >= duration) { setIsPlaying(false); return duration; }
          return prev + 0.05;
        });
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isPlaying, duration]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentSegment = segments.find(seg => currentTime >= seg.startTime && currentTime < seg.endTime);

  const speakerStats = speakerList.map(speaker => {
    const spkSegs = segments.filter(s => s.speakerId === speaker.id);
    const totalTime = spkSegs.reduce((acc, seg) => acc + (seg.endTime - seg.startTime), 0);
    return { ...speaker, totalTime, percentage: (totalTime / duration) * 100, segmentCount: spkSegs.length };
  });

  return (
    <div className="p-6 space-y-5">
      <div>
        <Link to={`/analysis/${id}`}
          className="inline-flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-sm mb-3 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Analysis
        </Link>
        <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest mb-1">Visualization</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Waveform Analysis</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Speaker diarization and waveform visualization</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Waveform</span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setZoom(Math.max(1, zoom - 0.5))}
                  className="p-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 rounded transition-colors">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-zinc-500 text-xs font-mono min-w-[44px] text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(Math.min(3, zoom + 0.5))}
                  className="p-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 rounded transition-colors">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button className="p-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 rounded transition-colors">
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="p-5">
              <div className="bg-black border border-zinc-900 rounded overflow-x-auto mb-3">
                <canvas ref={canvasRef} width={1200 * zoom} height={120} className="rounded" />
              </div>
              <div className="flex justify-between text-zinc-600 text-xs font-mono mb-3">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setIsPlaying(!isPlaying)}
                  className="w-8 h-8 bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center justify-center transition-colors shrink-0">
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <input type="range" min="0" max={duration} step="0.1" value={currentTime}
                  onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-blue-500" />
                {currentSegment && (
                  <div className="flex items-center gap-2 text-zinc-400 text-xs font-mono shrink-0">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: currentSegment.color }} />
                    <span>{currentSegment.speakerName}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Segment Timeline</span>
            </div>
            <div className="p-5 space-y-2">
              {segments.map((segment, index) => (
                <div key={index}
                  className={`px-4 py-3 rounded border cursor-pointer transition-colors ${
                    currentSegment === segment
                      ? 'border-zinc-500 bg-zinc-800'
                      : 'border-zinc-800 bg-zinc-800/40 hover:bg-zinc-800'
                  }`}
                  onClick={() => setCurrentTime(segment.startTime)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                      <span className="text-zinc-300 text-sm">{segment.speakerName}</span>
                    </div>
                    <span className="text-zinc-600 text-xs font-mono">
                      {formatTime(segment.startTime)} – {formatTime(segment.endTime)}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 h-8 bg-black border border-zinc-900 rounded px-1 overflow-hidden">
                    {segment.amplitude.slice(0, 60).map((amp, i) => (
                      <div key={i} className="flex-1 rounded-sm"
                        style={{ height: `${amp * 100}%`, backgroundColor: segment.color, opacity: 0.6 }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Speaker Stats</span>
            </div>
            <div className="p-5 space-y-4">
              {speakerStats.map((speaker) => (
                <div key={speaker.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: speaker.color }} />
                      <span className="text-zinc-300 text-xs">{speaker.name}</span>
                    </div>
                    <span className="text-zinc-500 text-xs font-mono">{speaker.percentage.toFixed(1)}%</span>
                  </div>
                  <div className="bg-zinc-800 rounded-full h-1 overflow-hidden">
                    <div className="h-full transition-all duration-300"
                      style={{ width: `${speaker.percentage}%`, backgroundColor: speaker.color }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-600 font-mono mt-1">
                    <span>{speaker.segmentCount} segments</span>
                    <span>{formatTime(speaker.totalTime)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">File Info</span>
            </div>
            <div className="p-5 space-y-3">
              {[
                ['File', 'intercept_alpha.wav'],
                ['Duration', formatTime(duration)],
                ['Speakers', String(speakerList.length)],
                ['Segments', String(segments.length)],
                ['Sample Rate', '44.1 kHz'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-zinc-600 text-xs uppercase tracking-wider">{label}</span>
                  <span className="text-zinc-300 text-xs font-mono">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
