import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, Search, FileText, User, Loader2, AlertCircle } from 'lucide-react';
import { audios, dangerousWords, type AudioRecord, type SegmentRecord } from '../lib/api';

export default function TranscriptView() {
  const { id } = useParams<{ id: string }>();
  const audioId = Number(id);

  const [audio, setAudio] = useState<AudioRecord | null>(null);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [flaggedWords, setFlaggedWords] = useState<string[]>([]);

  useEffect(() => {
    dangerousWords.list().then(ws => setFlaggedWords(ws.map(w => w.word))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!audioId) return;
    Promise.all([audios.get(audioId), audios.getSegments(audioId)])
      .then(([audioData, segsData]) => { setAudio(audioData); setSegments(segsData); })
      .catch(() => setError('Failed to load transcript.'))
      .finally(() => setLoading(false));
  }, [audioId]);

  const formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

  const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const highlightText = (text: string, query: string) => {
    if (!query && flaggedWords.length === 0) return <>{text}</>;

    const intervals: { start: number; end: number; red: boolean }[] = [];
    const addMatches = (needle: string, red: boolean) => {
      if (!needle.trim()) return;
      const rx = new RegExp(escapeRx(needle), 'gi');
      let m;
      while ((m = rx.exec(text)) !== null)
        intervals.push({ start: m.index, end: m.index + m[0].length, red });
    };
    if (query) addMatches(query, false);
    for (const w of flaggedWords) addMatches(w, true);

    intervals.sort((a, b) => a.start - b.start || (a.red ? -1 : 1));

    const merged: { start: number; end: number; red: boolean }[] = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (!last || last.end <= iv.start) { merged.push({ ...iv }); continue; }
      if (iv.red && !last.red) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, iv.end), red: true };
      else merged[merged.length - 1].end = Math.max(last.end, iv.end);
    }

    const nodes: React.ReactNode[] = [];
    let pos = 0;
    for (const { start, end, red } of merged) {
      if (start > pos) nodes.push(text.slice(pos, start));
      nodes.push(
        <mark key={start} className={red ? 'bg-red-500/25 text-red-300 rounded-sm' : 'bg-yellow-500/30 text-yellow-200 rounded-sm'}>
          {text.slice(start, end)}
        </mark>
      );
      pos = end;
    }
    if (pos < text.length) nodes.push(text.slice(pos));
    return <>{nodes}</>;
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

  const participantMap = new Map<number, { id: number; name: string; color: string; turns: number }>();
  for (const seg of segments) {
    const existing = participantMap.get(seg.speakerId);
    if (existing) existing.turns++;
    else participantMap.set(seg.speakerId, { id: seg.speakerId, name: seg.speakerName, color: seg.speakerColor, turns: 1 });
  }
  const participants = Array.from(participantMap.values());

  const filtered = segments.filter(seg =>
    seg.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
    seg.speakerName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
    </div>
  );

  if (error || !audio) return (
    <div className="p-6">
      <div className="bg-red-500/5 border border-red-500/20 rounded-md p-6 text-center">
        <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-red-400 text-sm">{error || 'Audio not found.'}</p>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest mb-1">Transcript</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">{audio.name}</h1>
        <p className="text-zinc-600 text-xs font-mono mt-0.5">ID:{id}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main transcript */}
        <div className="lg:col-span-2 space-y-4">
          {/* Search bar */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3 flex items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
              <input
                type="text"
                placeholder="Search transcript…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded px-3 pl-9 py-2 text-white text-sm placeholder-zinc-700 focus:outline-none focus:border-blue-500 transition-all font-mono"
              />
            </div>
            <button onClick={exportTranscript}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded transition-colors shrink-0">
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
            {searchQuery && (
              <span className="text-zinc-600 text-xs font-mono shrink-0">{filtered.length}/{segments.length}</span>
            )}
          </div>

          {/* Transcript body */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
              <FileText className="w-4 h-4 text-zinc-600" />
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Full Transcript</span>
            </div>

            {filtered.length === 0 ? (
              <p className="text-zinc-600 text-sm px-5 py-6">
                {segments.length === 0 ? 'No transcript available.' : 'No matching segments.'}
              </p>
            ) : (
              <div className="divide-y divide-zinc-900">
                {filtered.map((seg) => (
                  <div key={seg.id} className="flex gap-4 px-5 py-3 hover:bg-zinc-800/30 transition-colors">
                    <span className="text-zinc-600 text-xs font-mono shrink-0 w-12 pt-0.5">{formatTime(seg.startTime)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.speakerColor }} />
                        <Link to={`/speaker/${seg.speakerId}`}
                          className="text-white text-sm font-medium hover:text-blue-400 transition-colors">
                          {seg.speakerName}
                        </Link>
                        <span className="text-zinc-700 text-xs font-mono">→ {formatTime(seg.endTime)}</span>
                      </div>
                      <p className="text-zinc-400 text-sm leading-relaxed">
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
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Summary</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              {[
                { label: 'Segments',    value: segments.length },
                { label: 'Speakers',    value: participants.length },
                { label: 'Duration',    value: formatTime(audio.duration) },
                { label: 'Uploaded by', value: audio.uploadedBy || '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-zinc-600 text-xs uppercase tracking-wider">{label}</span>
                  <span className="text-zinc-300 text-xs font-mono">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Participants */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
              <User className="w-3.5 h-3.5 text-zinc-600" />
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Participants</span>
            </div>
            {participants.length === 0 ? (
              <p className="text-zinc-600 text-sm px-5 py-4">No speakers detected.</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {participants.map((p) => (
                  <Link key={p.id} to={`/speaker/${p.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="text-zinc-300 text-sm">{p.name}</span>
                    </div>
                    <span className="text-zinc-600 text-xs font-mono">{p.turns} turns</span>
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
