import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, Search, FileText, User, Loader2, AlertCircle } from 'lucide-react';
import { audios, type AudioRecord, type SegmentRecord } from '../lib/api';

export default function TranscriptView() {
  const { id } = useParams<{ id: string }>();
  const audioId = Number(id);

  const [audio, setAudio] = useState<AudioRecord | null>(null);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!audioId) return;
    Promise.all([audios.get(audioId), audios.getSegments(audioId)])
      .then(([audioData, segsData]) => {
        setAudio(audioData);
        setSegments(segsData);
      })
      .catch(() => setError('Failed to load transcript.'))
      .finally(() => setLoading(false));
  }, [audioId]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const highlightText = (text: string, query: string) => {
    if (!query) return <>{text}</>;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase()
            ? <mark key={i} className="bg-yellow-500/30 text-yellow-200">{part}</mark>
            : part
        )}
      </>
    );
  };

  const exportTranscript = () => {
    if (!audio || segments.length === 0) return;
    const lines = segments.map(seg =>
      `[${formatTime(seg.startTime)} – ${formatTime(seg.endTime)}] ${seg.speakerName}:\n${seg.text}`
    );
    const content = `${audio.name}\n${'─'.repeat(60)}\n\n${lines.join('\n\n')}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Build participants list with turn counts
  const participantMap = new Map<number, { id: number; name: string; color: string; turns: number }>();
  for (const seg of segments) {
    const existing = participantMap.get(seg.speakerId);
    if (existing) {
      existing.turns++;
    } else {
      participantMap.set(seg.speakerId, { id: seg.speakerId, name: seg.speakerName, color: seg.speakerColor, turns: 1 });
    }
  }
  const participants = Array.from(participantMap.values());

  const filtered = segments.filter(seg =>
    seg.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
    seg.speakerName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
    </div>
  );

  if (error || !audio) return (
    <div className="p-8">
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-400">{error || 'Audio not found.'}</p>
      </div>
    </div>
  );

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Transcript</h1>
        <p className="text-slate-400">{audio.name}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main transcript */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search transcript..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={exportTranscript}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
            {searchQuery && (
              <p className="text-slate-400 text-xs mt-2">
                {filtered.length} of {segments.length} segments match
              </p>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-6">
              <FileText className="w-5 h-5 text-blue-500" />
              <h2 className="text-white">Full Transcript</h2>
            </div>
            {filtered.length === 0 ? (
              <p className="text-slate-400 text-sm">
                {segments.length === 0 ? 'No transcript available.' : 'No matching segments.'}
              </p>
            ) : (
              <div className="space-y-4">
                {filtered.map((seg) => (
                  <div key={seg.id} className="flex gap-4">
                    <div className="shrink-0 w-20 text-slate-400 text-sm pt-1 font-mono">
                      {formatTime(seg.startTime)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.speakerColor }} />
                        <Link
                          to={`/speaker/${seg.speakerId}`}
                          className="text-white hover:text-blue-400 transition-colors text-sm font-medium"
                        >
                          {seg.speakerName}
                        </Link>
                        <span className="text-slate-600 text-xs font-mono">
                          – {formatTime(seg.endTime)}
                        </span>
                      </div>
                      <p className="text-slate-300 text-sm">
                        {highlightText(seg.text, searchQuery)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Summary</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Total segments</span>
                <span className="text-white">{segments.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Speakers</span>
                <span className="text-white">{participants.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Duration</span>
                <span className="text-white">{formatTime(audio.duration)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Uploaded by</span>
                <span className="text-white">{audio.uploadedBy || '—'}</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-5 h-5 text-blue-500" />
              <h3 className="text-white">Participants</h3>
            </div>
            {participants.length === 0 ? (
              <p className="text-slate-400 text-sm">No speakers detected.</p>
            ) : (
              <div className="space-y-2">
                {participants.map((p) => (
                  <Link
                    key={p.id}
                    to={`/speaker/${p.id}`}
                    className="flex items-center justify-between p-3 bg-slate-800 border border-slate-700 rounded-lg hover:border-slate-600 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="text-white text-sm">{p.name}</span>
                    </div>
                    <span className="text-slate-400 text-sm">{p.turns} turns</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
