import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Play, Pause, ZoomIn, ZoomOut, Download, ArrowRight } from 'lucide-react';

interface SpeakerSegment {
  speakerId: string;
  speakerName: string;
  color: string;
  startTime: number;
  endTime: number;
  amplitude: number[];
}

const segments: SpeakerSegment[] = [
  {
    speakerId: 'spk-1',
    speakerName: 'דובר A',
    color: '#3b82f6',
    startTime: 0,
    endTime: 4.5,
    amplitude: Array.from({ length: 90 }, () => Math.random() * 0.8 + 0.2),
  },
  {
    speakerId: 'spk-2',
    speakerName: 'דובר B',
    color: '#a855f7',
    startTime: 4.5,
    endTime: 8.2,
    amplitude: Array.from({ length: 74 }, () => Math.random() * 0.9 + 0.1),
  },
  {
    speakerId: 'spk-1',
    speakerName: 'דובר A',
    color: '#3b82f6',
    startTime: 8.2,
    endTime: 12.8,
    amplitude: Array.from({ length: 92 }, () => Math.random() * 0.85 + 0.15),
  },
  {
    speakerId: 'spk-3',
    speakerName: 'דובר C',
    color: '#06b6d4',
    startTime: 12.8,
    endTime: 16.5,
    amplitude: Array.from({ length: 74 }, () => Math.random() * 0.7 + 0.3),
  },
  {
    speakerId: 'spk-2',
    speakerName: 'דובר B',
    color: '#a855f7',
    startTime: 16.5,
    endTime: 21.3,
    amplitude: Array.from({ length: 96 }, () => Math.random() * 0.75 + 0.25),
  },
  {
    speakerId: 'spk-1',
    speakerName: 'דובר A',
    color: '#3b82f6',
    startTime: 21.3,
    endTime: 24.0,
    amplitude: Array.from({ length: 54 }, () => Math.random() * 0.6 + 0.2),
  },
];

const speakers = [
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

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerY = canvas.height / 2;
    const segmentWidth = (canvas.width * zoom) / segments.length;
    
    segments.forEach((segment, segmentIndex) => {
      const segmentStartX = segmentIndex * segmentWidth;
      const barWidth = segmentWidth / segment.amplitude.length;

      segment.amplitude.forEach((amp, i) => {
        const x = segmentStartX + i * barWidth;
        const height = amp * (canvas.height * 0.4);

        // Draw waveform bar
        ctx.fillStyle = segment.color;
        ctx.fillRect(x, centerY - height / 2, Math.max(barWidth - 1, 1), height);
      });

      // Draw segment boundary
      if (segmentIndex < segments.length - 1) {
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(segmentStartX + segmentWidth, 0);
        ctx.lineTo(segmentStartX + segmentWidth, canvas.height);
        ctx.stroke();
      }
    });

    // Draw current time indicator
    const currentX = (currentTime / duration) * canvas.width * zoom;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(currentX, 0);
    ctx.lineTo(currentX, canvas.height);
    ctx.stroke();

    // Draw center line
    ctx.strokeStyle = '#475569';
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
          if (prev >= duration) {
            setIsPlaying(false);
            return duration;
          }
          return prev + 0.05;
        });
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, duration]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getCurrentSegment = () => {
    return segments.find(seg => currentTime >= seg.startTime && currentTime < seg.endTime);
  };

  const currentSegment = getCurrentSegment();

  // Calculate speaker statistics
  const speakerStats = speakers.map(speaker => {
    const speakerSegments = segments.filter(s => s.speakerId === speaker.id);
    const totalTime = speakerSegments.reduce((acc, seg) => acc + (seg.endTime - seg.startTime), 0);
    const percentage = (totalTime / duration) * 100;
    return { ...speaker, totalTime, percentage, segmentCount: speakerSegments.length };
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white text-3xl mb-2">ניתוח גלי קול</h1>
            <p className="text-slate-400">הפרדת דוברים וויזואליזציה של גלי הקול</p>
          </div>
          <Link
            to={`/analysis/${id}`}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            חזרה לניתוח
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Waveform Display */}
        <div className="lg:col-span-3 space-y-6">
          {/* Waveform Canvas */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white">גרף גלי הקול</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setZoom(Math.max(1, zoom - 0.5))}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
                  title="הקטן"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-slate-400 text-sm min-w-[60px] text-center">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom(Math.min(3, zoom + 0.5))}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
                  title="הגדל"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors">
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Canvas */}
            <div className="bg-slate-950 rounded-lg p-4 overflow-x-auto">
              <canvas
                ref={canvasRef}
                width={1200 * zoom}
                height={300}
                className="rounded"
              />
            </div>

            {/* Time Display */}
            <div className="flex justify-between text-slate-400 text-sm mt-4">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4 mt-4">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full transition-colors"
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </button>
              <input
                type="range"
                min="0"
                max={duration}
                step="0.1"
                value={currentTime}
                onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
                className="flex-1 accent-blue-600"
              />
              {currentSegment && (
                <div className="flex items-center gap-2 text-slate-300 text-sm">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: currentSegment.color }}
                  />
                  <span>{currentSegment.speakerName}</span>
                </div>
              )}
            </div>
          </div>

          {/* Segments Timeline */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">ציר זמן של קטעי דיבור</h3>
            <div className="space-y-3">
              {segments.map((segment, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                    currentSegment === segment
                      ? 'border-white bg-slate-800'
                      : 'border-slate-700 bg-slate-800/50 hover:bg-slate-800'
                  }`}
                  onClick={() => setCurrentTime(segment.startTime)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: segment.color }}
                      />
                      <span className="text-white">{segment.speakerName}</span>
                    </div>
                    <span className="text-slate-400 text-sm">
                      {formatTime(segment.startTime)} - {formatTime(segment.endTime)}
                    </span>
                  </div>
                  {/* Mini waveform */}
                  <div className="flex items-center gap-0.5 h-12 bg-slate-900 rounded p-1">
                    {segment.amplitude.slice(0, 50).map((amp, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{
                          height: `${amp * 100}%`,
                          backgroundColor: segment.color,
                          opacity: 0.7,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Speaker Statistics */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">סטטיסטיקת דוברים</h3>
            <div className="space-y-4">
              {speakerStats.map((speaker) => (
                <div key={speaker.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: speaker.color }}
                      />
                      <span className="text-white text-sm">{speaker.name}</span>
                    </div>
                    <span className="text-slate-400 text-sm">
                      {speaker.percentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${speaker.percentage}%`,
                        backgroundColor: speaker.color,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{speaker.segmentCount} קטעים</span>
                    <span>{formatTime(speaker.totalTime)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">מקרא</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-2">
                <div className="w-8 h-6 bg-blue-500 rounded mt-1" />
                <div>
                  <div className="text-white">גובה הגל</div>
                  <div className="text-slate-400 text-xs">עוצמת הקול</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-8 h-6 border-2 border-white rounded mt-1" />
                <div>
                  <div className="text-white">קו לבן</div>
                  <div className="text-slate-400 text-xs">מיקום נוכחי</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-8 h-6 border-2 border-slate-700 rounded mt-1" />
                <div>
                  <div className="text-white">קו כהה</div>
                  <div className="text-slate-400 text-xs">הפרדה בין דוברים</div>
                </div>
              </div>
            </div>
          </div>

          {/* File Info */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">מידע על הקובץ</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">קובץ</span>
                <span className="text-white">intercept_alpha_dec30.wav</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">משך</span>
                <span className="text-white">{formatTime(duration)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">דוברים</span>
                <span className="text-white">{speakers.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">קטעים</span>
                <span className="text-white">{segments.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">דגימה</span>
                <span className="text-white">44.1 kHz</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
