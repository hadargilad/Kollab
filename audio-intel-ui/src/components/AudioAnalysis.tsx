import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Play, Pause, Volume2, FileText, Network, Clock, Waves } from 'lucide-react';

interface Speaker {
  id: string;
  label: string;
  color: string;
}

interface Segment {
  id: string;
  speakerId: string;
  start: number;
  end: number;
  text: string;
}

const speakers: Speaker[] = [
  { id: 'spk-1', label: 'Speaker A', color: '#3b82f6' },
  { id: 'spk-2', label: 'Speaker B', color: '#a855f7' },
  { id: 'spk-3', label: 'Speaker C (Unknown)', color: '#06b6d4' },
];

const segments: Segment[] = [
  { id: 's1', speakerId: 'spk-1', start: 0, end: 4.5, text: 'We need to discuss the timeline for the operation.' },
  { id: 's2', speakerId: 'spk-2', start: 4.5, end: 8.2, text: 'Agreed. I think we should move forward by next week.' },
  { id: 's3', speakerId: 'spk-1', start: 8.2, end: 12.8, text: 'That works. Have you coordinated with the team in sector 7?' },
  { id: 's4', speakerId: 'spk-3', start: 12.8, end: 16.5, text: 'Yes, they are ready to proceed on our signal.' },
  { id: 's5', speakerId: 'spk-2', start: 16.5, end: 21.3, text: 'Perfect. Let me confirm the logistics and get back to you tomorrow.' },
  { id: 's6', speakerId: 'spk-1', start: 21.3, end: 24.0, text: 'Sounds good. Talk soon.' },
];

export default function AudioAnalysis() {
  const { id } = useParams();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration] = useState(24.0); // Mock duration
  const [volume, setVolume] = useState(0.7);
  const animationRef = useRef<number | null>(null);

  const getCurrentSegment = () => {
    return segments.find(seg => currentTime >= seg.start && currentTime < seg.end);
  };

  const getSpeakerById = (speakerId: string) => {
    return speakers.find(s => s.id === speakerId);
  };

  const jumpToSegment = (segment: Segment) => {
    setCurrentTime(segment.start);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        setCurrentTime(prev => {
          if (prev >= duration) {
            setIsPlaying(false);
            return duration;
          }
          return prev + 0.1;
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

  const currentSegment = getCurrentSegment();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Audio Analysis</h1>
        <p className="text-slate-400">File ID: {id}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Audio Player */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-white mb-1">intercept_alpha_dec30.wav</h2>
                <div className="flex items-center gap-4 text-slate-400 text-sm">
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    Duration: 12:34
                  </span>
                  <span>3 Speakers Detected</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Link
                  to={`/waveform/${id}`}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Waves className="w-4 h-4" />
                  גלי קול
                </Link>
                <Link
                  to={`/transcript/${id}`}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  Full Transcript
                </Link>
                <Link
                  to="/network"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Network className="w-4 h-4" />
                  View Network
                </Link>
              </div>
            </div>

            {/* Timeline */}
            <div className="mb-6">
              <div className="bg-slate-800 rounded-lg p-4 h-24 relative overflow-hidden">
                {segments.map(segment => {
                  const speaker = getSpeakerById(segment.speakerId);
                  const left = (segment.start / duration) * 100;
                  const width = ((segment.end - segment.start) / duration) * 100;
                  return (
                    <div
                      key={segment.id}
                      className="absolute h-16 top-4 rounded cursor-pointer hover:opacity-80 transition-opacity"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: speaker?.color,
                      }}
                      onClick={() => jumpToSegment(segment)}
                      title={`${speaker?.label}: ${segment.text}`}
                    />
                  );
                })}
                {/* Current time indicator */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white z-10"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-slate-400 text-sm mt-2">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlayPause}
                className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full transition-colors"
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </button>
              <div className="flex items-center gap-2 flex-1">
                <Volume2 className="w-5 h-5 text-slate-400" />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="flex-1"
                />
              </div>
              {currentSegment && (
                <div className="text-slate-300 text-sm">
                  Currently: {getSpeakerById(currentSegment.speakerId)?.label}
                </div>
              )}
            </div>

            {/* Current Text */}
            {currentSegment && (
              <div className="mt-6 p-4 bg-slate-800 rounded-lg border border-slate-700">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getSpeakerById(currentSegment.speakerId)?.color }}
                  />
                  <span className="text-white">{getSpeakerById(currentSegment.speakerId)?.label}</span>
                  <span className="text-slate-400 text-sm">
                    [{formatTime(currentSegment.start)} - {formatTime(currentSegment.end)}]
                  </span>
                </div>
                <p className="text-slate-300">{currentSegment.text}</p>
              </div>
            )}
          </div>

          {/* Segment List */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Speaker Segments</h3>
            <div className="space-y-3">
              {segments.map((segment) => {
                const speaker = getSpeakerById(segment.speakerId);
                const isActive = currentSegment?.id === segment.id;
                return (
                  <div
                    key={segment.id}
                    onClick={() => jumpToSegment(segment)}
                    className={`p-4 rounded-lg cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-blue-600/20 border border-blue-500'
                        : 'bg-slate-800 border border-slate-700 hover:bg-slate-750'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: speaker?.color }}
                      />
                      <span className="text-white">{speaker?.label}</span>
                      <span className="text-slate-400 text-sm ml-auto">
                        {formatTime(segment.start)} - {formatTime(segment.end)}
                      </span>
                    </div>
                    <p className="text-slate-300 text-sm">{segment.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Speakers */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Identified Speakers</h3>
            <div className="space-y-3">
              {speakers.map((speaker) => {
                const speakerSegments = segments.filter(s => s.speakerId === speaker.id);
                const totalTime = speakerSegments.reduce((acc, seg) => acc + (seg.end - seg.start), 0);
                return (
                  <Link
                    key={speaker.id}
                    to={`/speaker/${speaker.id}`}
                    className="block p-4 bg-slate-800 rounded-lg border border-slate-700 hover:bg-slate-750 transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: speaker.color }}
                      />
                      <span className="text-white">{speaker.label}</span>
                    </div>
                    <div className="text-slate-400 text-sm space-y-1">
                      <div>Segments: {speakerSegments.length}</div>
                      <div>Duration: {formatTime(totalTime)}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Metadata */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">File Metadata</h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-slate-400 mb-1">Source</div>
                <div className="text-white">Intercept Alpha</div>
              </div>
              <div>
                <div className="text-slate-400 mb-1">Date Captured</div>
                <div className="text-white">Dec 30, 2025</div>
              </div>
              <div>
                <div className="text-slate-400 mb-1">File Format</div>
                <div className="text-white">WAV, 44.1kHz, 16-bit</div>
              </div>
              <div>
                <div className="text-slate-400 mb-1">Processing Time</div>
                <div className="text-white">2m 14s</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}