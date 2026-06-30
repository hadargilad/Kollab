import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { Copy, Check, Search, FileText, User, Loader2, AlertCircle, ShieldAlert, Sparkles, ArrowLeft } from 'lucide-react';
import { audios, dangerousWords, search, entities, type AudioRecord, type SegmentRecord, type SubScores, type SearchResultItem, type SegmentMentionRecord } from '../lib/api';
import { SUB_LEGEND } from './SubScoresBar';
import SpeakerAvatar from './SpeakerAvatar';
import Loader from './Loader';

const ENTITY_COLORS: Record<string, string> = {
  PERSON:  'bg-blue-500/25 text-blue-200 border-b border-blue-400/50',
  ORG:     'bg-purple-500/25 text-purple-200 border-b border-purple-400/50',
  LOC:     'bg-green-500/25 text-green-200 border-b border-green-400/50',
  MISC:    'bg-zinc-500/20 text-zinc-200 border-b border-zinc-400/50',
  PHONE:   'bg-amber-500/25 text-amber-200 border-b border-amber-400/50',
  EMAIL:   'bg-cyan-500/25 text-cyan-200 border-b border-cyan-400/50',
  MONEY:   'bg-emerald-500/25 text-emerald-200 border-b border-emerald-400/50',
};

function suspicionRowClass(score: number | null | undefined): string {
  if (score == null) return '';
  if (score > 0.80) return 'bg-red-500/15 hover:bg-red-500/20';
  if (score > 0.65) return 'bg-orange-500/15 hover:bg-orange-500/20';
  return '';
}

function dominantSignal(subs: SubScores | null | undefined): string | null {
  if (!subs) return null;
  let bestKey: keyof SubScores | null = null;
  let bestVal = -1;
  (['a', 'b', 'c', 'd'] as (keyof SubScores)[]).forEach(k => {
    const v = subs[k] ?? 0;
    if (v > bestVal) { bestVal = v; bestKey = k; }
  });
  if (!bestKey || bestVal <= 0) return null;
  return SUB_LEGEND[bestKey];
}

export default function TranscriptView() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const audioId = Number(id);

  const [audio, setAudio] = useState<AudioRecord | null>(null);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [semanticMode, setSemanticMode] = useState(false);
  const [semanticResults, setSemanticResults] = useState<SearchResultItem[] | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [flaggedWords, setFlaggedWords] = useState<string[]>([]);
  const [mentionsBySegment, setMentionsBySegment] = useState<Map<number, SegmentMentionRecord[]>>(new Map());
  const [exportCopied, setExportCopied] = useState(false);

  useEffect(() => {
    dangerousWords.list().then(ws => setFlaggedWords(ws.map(w => w.word))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!audioId) return;
    Promise.all([audios.get(audioId), audios.getSegments(audioId)])
      .then(([audioData, segsData]) => { setAudio(audioData); setSegments(segsData); })
      .catch(() => setError('Failed to load transcript.'))
      .finally(() => setLoading(false));
    entities.segmentMentions(audioId).then(mentions => {
      const map = new Map<number, SegmentMentionRecord[]>();
      for (const m of mentions) {
        const arr = map.get(m.segmentId) ?? [];
        arr.push(m);
        map.set(m.segmentId, arr);
      }
      setMentionsBySegment(map);
    }).catch(() => {});
  }, [audioId]);

  // Scroll to anchored segment (e.g. /transcript/12#seg-345 from the Alerts page)
  useEffect(() => {
    if (loading || segments.length === 0) return;
    const hash = location.hash;
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [loading, segments.length, location.hash]);

  const formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

  const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const highlightTextWithEntities = (text: string, query: string, segMentions: SegmentMentionRecord[]) => {
    type Span = { start: number; end: number; red: boolean; entityType?: string; rawText?: string };
    const intervals: Span[] = [];

    const addMatches = (needle: string, red: boolean) => {
      if (!needle.trim()) return;
      const rx = new RegExp(escapeRx(needle), 'gi');
      let m;
      while ((m = rx.exec(text)) !== null)
        intervals.push({ start: m.index, end: m.index + m[0].length, red });
    };
    if (query) addMatches(query, false);
    for (const w of flaggedWords) addMatches(w, true);
    for (const mention of segMentions) {
      intervals.push({
        start: mention.offset,
        end: mention.offset + mention.length,
        red: false,
        entityType: mention.entityType,
        rawText: mention.rawText,
      });
    }

    intervals.sort((a, b) => a.start - b.start || (a.red ? -1 : 1));

    const merged: Span[] = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (!last || last.end <= iv.start) { merged.push({ ...iv }); continue; }
      if (iv.red && !last.red) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, iv.end), red: true };
      else merged[merged.length - 1].end = Math.max(last.end, iv.end);
    }

    const nodes: React.ReactNode[] = [];
    let pos = 0;
    for (const span of merged) {
      if (span.start > pos) nodes.push(text.slice(pos, span.start));
      const slice = text.slice(span.start, span.end);
      if (span.red) {
        nodes.push(<mark key={span.start} className="bg-red-500/25 text-red-300 rounded-sm">{slice}</mark>);
      } else if (span.entityType) {
        const cls = ENTITY_COLORS[span.entityType] ?? ENTITY_COLORS.MISC;
        nodes.push(
          <span
            key={span.start}
            title={`${span.entityType}: ${span.rawText}`}
            className={`rounded-sm px-0.5 cursor-default ${cls}`}
          >
            {slice}
          </span>
        );
      } else {
        nodes.push(<mark key={span.start} className="bg-yellow-500/30 text-yellow-200 rounded-sm">{slice}</mark>);
      }
      pos = span.end;
    }
    if (pos < text.length) nodes.push(text.slice(pos));
    return <>{nodes}</>;
  };

  const exportTranscript = () => {
    if (!audio || segments.length === 0) return;

    const speakerMap = new Map<number, { name: string; turns: number; totalSec: number }>();
    for (const seg of segments) {
      const e = speakerMap.get(seg.speakerId);
      const dur = seg.endTime - seg.startTime;
      if (e) { e.turns++; e.totalSec += dur; }
      else speakerMap.set(seg.speakerId, { name: seg.speakerName, turns: 1, totalSec: dur });
    }
    const speakerLines = Array.from(speakerMap.values())
      .map(s => `  • ${s.name} — ${s.turns} turns, ${formatTime(s.totalSec)} speaking time`)
      .join('\n');

    const transcriptLines = segments.map(seg =>
      `[${formatTime(seg.startTime)} – ${formatTime(seg.endTime)}]  ${seg.speakerName}\n${seg.text}`
    );

    const recordedAt = audio.recordedAt ? new Date(audio.recordedAt).toLocaleString() : 'Unknown';
    const content = [
      `TRANSCRIPT REPORT`,
      `${'═'.repeat(60)}`,
      ``,
      `File:      ${audio.name}`,
      `Recorded:  ${recordedAt}`,
      `Duration:  ${formatTime(audio.duration ?? 0)}`,
      `Segments:  ${segments.length}`,
      ``,
      `PARTICIPANTS`,
      `${'─'.repeat(60)}`,
      speakerLines,
      ``,
      `TRANSCRIPT`,
      `${'─'.repeat(60)}`,
      ``,
      ...transcriptLines.map((l, i) => (i > 0 ? '\n' : '') + l),
    ].join('\n');

    navigator.clipboard.writeText(content).then(() => {
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2500);
    });
  };

  const participantMap = new Map<number, { id: number; name: string; color: string; imagePath: string | null; turns: number }>();
  for (const seg of segments) {
    const existing = participantMap.get(seg.speakerId);
    if (existing) existing.turns++;
    else participantMap.set(seg.speakerId, {
      id: seg.speakerId,
      name: seg.speakerName,
      color: seg.speakerColor,
      imagePath: seg.speakerImagePath ?? null,
      turns: 1,
    });
  }
  const participants = Array.from(participantMap.values());

  // In semantic mode the API returns ordered results; map back to SegmentRecord shape.
  const semanticSegments: SegmentRecord[] = semanticResults
    ? semanticResults
        .map(r => segments.find(s => s.id === r.segmentId))
        .filter((s): s is SegmentRecord => s !== undefined)
    : [];

  const filtered = semanticMode && semanticResults !== null
    ? semanticSegments
    : segments.filter(seg =>
        !searchQuery ||
        seg.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        seg.speakerName.toLowerCase().includes(searchQuery.toLowerCase())
      );

  const handleSearchKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!semanticMode || e.key !== 'Enter' || !searchQuery.trim()) return;
    setSemanticLoading(true);
    setSemanticResults(null);
    try {
      const res = await search.semantic(searchQuery.trim(), { audioId });
      setSemanticResults(res.results);
    } catch {
      setSemanticResults([]);
    } finally {
      setSemanticLoading(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (semanticMode) return;      // keyword: filter live; semantic: wait for Enter
    if (!value) setSemanticResults(null);
  };

  if (loading) return <Loader />;

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
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-zinc-300 hover:text-white text-xs font-mono mb-2 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Transcript</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">{audio.name}</h1>
        <p className="text-zinc-200 text-xs font-mono mt-0.5">ID:{id}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main transcript */}
        <div className="lg:col-span-2 space-y-4">
          {/* Search bar */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3 flex items-center gap-2">
            <div className="flex-1 relative">
              {semanticLoading
                ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-400 animate-spin" />
                : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-200" />
              }
              <input
                type="text"
                placeholder={semanticMode ? 'Semantic search… (Enter to search)' : 'Search transcript…'}
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                onKeyDown={handleSearchKey}
                className="w-full bg-black border border-zinc-800 rounded px-3 pl-9 py-2 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 transition-all font-mono"
              />
            </div>
            <button
              type="button"
              onClick={() => { setSemanticMode(m => !m); setSemanticResults(null); setSearchQuery(''); }}
              title={semanticMode ? 'Switch to keyword search' : 'Switch to semantic search'}
              className={`flex items-center gap-1.5 px-3 py-2 border text-xs rounded-md transition-colors shrink-0 ${
                semanticMode
                  ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {semanticMode ? 'Semantic' : 'Keyword'}
            </button>
            <button onClick={exportTranscript}
              className={`flex items-center gap-1.5 px-3 py-2 border text-xs rounded-md transition-colors shrink-0 ${
                exportCopied
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                  : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300'
              }`}>
              {exportCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {exportCopied ? 'Copied!' : 'Copy'}
            </button>
            {searchQuery && !semanticMode && (
              <span className="text-zinc-200 text-xs font-mono shrink-0">{filtered.length}/{segments.length}</span>
            )}
            {semanticMode && semanticResults !== null && (
              <span className="text-blue-300 text-xs font-mono shrink-0">{semanticResults.length} results</span>
            )}
          </div>

          {/* Transcript body */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
              <FileText className="w-4 h-4 text-zinc-200" />
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Full Transcript</span>
            </div>

            {filtered.length === 0 ? (
              <p className="text-zinc-200 text-sm px-5 py-6">
                {segments.length === 0 ? 'No transcript available.' : 'No matching segments.'}
              </p>
            ) : (
              <div className="divide-y divide-zinc-900">
                {filtered.map((seg) => {
                  const tint = suspicionRowClass(seg.suspicionScore);
                  const flagged = (seg.suspicionScore ?? 0) > 0.65;
                  const hasScore = seg.suspicionScore != null;
                  const scoreColor = (seg.suspicionScore ?? 0) > 0.80
                    ? 'text-red-300 border-red-500/40 bg-red-500/10'
                    : flagged
                      ? 'text-orange-300 border-orange-500/40 bg-orange-500/10'
                      : 'text-zinc-300 border-zinc-700 bg-zinc-800/50';
                  return (
                    <div
                      key={seg.id}
                      id={`seg-${seg.id}`}
                      className={`flex gap-4 px-5 py-3 transition-colors ${tint || 'hover:bg-zinc-800/30'}`}
                    >
                      <span className="text-zinc-300 text-xs font-mono shrink-0 w-12 pt-0.5">{formatTime(seg.startTime)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <SpeakerAvatar
                            speakerId={seg.speakerId}
                            name={seg.speakerName}
                            color={seg.speakerColor}
                            imagePath={seg.speakerImagePath}
                            size={22}
                          />
                          <Link to={`/speaker/${seg.speakerId}`}
                            className="text-white text-sm font-medium hover:text-blue-400 transition-colors">
                            {seg.speakerName}
                          </Link>
                          <span className="text-zinc-200 text-xs font-mono">→ {formatTime(seg.endTime)}</span>
                          {flagged && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-orange-300">
                              <ShieldAlert className="w-3 h-3" />
                              Coded
                            </span>
                          )}
                          {hasScore && (
                            <span className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded border ${scoreColor}`}>
                              {(seg.suspicionScore ?? 0).toFixed(2)}
                            </span>
                          )}
                        </div>
                        <p className="text-zinc-200 text-sm leading-relaxed">
                          {highlightTextWithEntities(seg.text, searchQuery, mentionsBySegment.get(seg.id) ?? [])}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Summary</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              {[
                { label: 'Segments',    value: segments.length },
                { label: 'Speakers',    value: participants.length },
                { label: 'Duration',    value: formatTime(audio.duration) },
                { label: 'Uploaded by', value: audio.uploadedBy || '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-zinc-200 text-xs uppercase tracking-wider">{label}</span>
                  <span className="text-zinc-300 text-xs font-mono">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Suspicion summary — only render if at least one segment was scored */}
          {(() => {
            const scored = segments.filter(s => s.suspicionScore != null);
            if (scored.length === 0) return null;
            const flaggedSegs = scored.filter(s => (s.suspicionScore ?? 0) > 0.65);
            const maxSeg = scored.reduce<SegmentRecord | null>(
              (acc, s) => (acc === null || (s.suspicionScore ?? 0) > (acc.suspicionScore ?? 0)) ? s : acc,
              null,
            );
            const maxScore = maxSeg?.suspicionScore ?? 0;
            // Dominant signal across the audio = highest mean over flagged segs (or all if none flagged).
            const base = flaggedSegs.length ? flaggedSegs : scored;
            const sums = { a: 0, b: 0, c: 0, d: 0 } as SubScores;
            let n = 0;
            for (const s of base) {
              if (!s.subScores) continue;
              n++;
              sums.a = (sums.a ?? 0) + (s.subScores.a ?? 0);
              sums.b = (sums.b ?? 0) + (s.subScores.b ?? 0);
              sums.c = (sums.c ?? 0) + (s.subScores.c ?? 0);
              sums.d = (sums.d ?? 0) + (s.subScores.d ?? 0);
            }
            const avg = n ? { a: (sums.a ?? 0) / n, b: (sums.b ?? 0) / n, c: (sums.c ?? 0) / n, d: (sums.d ?? 0) / n } : null;
            const dom = dominantSignal(avg);
            const flaggedTextColor = maxScore > 0.80 ? 'text-red-300' : maxScore > 0.65 ? 'text-orange-300' : 'text-zinc-300';
            return (
              <div className="bg-zinc-900 border border-zinc-800 rounded-md">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
                  <Sparkles className="w-3.5 h-3.5 text-orange-300" />
                  <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Coded-Language</span>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-200 text-xs uppercase tracking-wider">Suspicious segments</span>
                    <span className={`text-sm font-mono ${flaggedSegs.length ? 'text-orange-300' : 'text-zinc-300'}`}>
                      {flaggedSegs.length} / {scored.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-200 text-xs uppercase tracking-wider">Max score</span>
                    <span className={`text-sm font-mono ${flaggedTextColor}`}>
                      {maxScore.toFixed(2)}
                    </span>
                  </div>
                  {dom && (
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-200 text-xs uppercase tracking-wider">Dominant signal</span>
                      <span className="text-zinc-300 text-xs font-mono">{dom}</span>
                    </div>
                  )}
                  <div className="pt-1 flex gap-2">
                    {maxSeg && (
                      <a
                        href={`#seg-${maxSeg.id}`}
                        className="flex-1 text-center px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-[11px] font-mono rounded transition-colors"
                      >
                        Jump to top hit
                      </a>
                    )}
                    <Link
                      to="/alerts?category=coded_language"
                      className="flex-1 text-center px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-[11px] font-mono rounded-md transition-colors"
                    >
                      All alerts →
                    </Link>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Participants */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
              <User className="w-3.5 h-3.5 text-zinc-200" />
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Participants</span>
            </div>
            {participants.length === 0 ? (
              <p className="text-zinc-200 text-sm px-5 py-4">No speakers detected.</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {participants.map((p) => (
                  <Link key={p.id} to={`/speaker/${p.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <SpeakerAvatar
                        speakerId={p.id}
                        name={p.name}
                        color={p.color}
                        imagePath={p.imagePath}
                        size={26}
                      />
                      <span className="text-zinc-200 text-sm truncate">{p.name}</span>
                    </div>
                    <span className="text-zinc-200 text-xs font-mono shrink-0">{p.turns} turns</span>
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
