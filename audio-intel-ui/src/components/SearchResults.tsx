import { useState, useEffect, useCallback, Fragment } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Search, Loader2, AlertCircle, Clock, Mic, FileAudio, SlidersHorizontal, X } from 'lucide-react';
import { search, speakers, type SearchResultItem, type SpeakerRecord } from '../lib/api';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function highlightTerm(text: string, term: string, className: string) {
  if (!term.trim()) return <>{text}</>;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase()
          ? <mark key={i} className={className}>{part}</mark>
          : part
      )}
    </>
  );
}

export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const q = searchParams.get('q') || '';
  const audioIdParam = searchParams.get('audioId');
  const initialAudioId = audioIdParam ? Number(audioIdParam) : undefined;

  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputQuery, setInputQuery] = useState(q);
  const [semanticMode, setSemanticMode] = useState(true);

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterSpeakerId, setFilterSpeakerId] = useState<number | ''>('');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [allSpeakers, setAllSpeakers] = useState<SpeakerRecord[]>([]);

  useEffect(() => {
    speakers.list().then(setAllSpeakers).catch(() => {});
  }, []);

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    setError('');
    try {
      const res = await search.semantic(query, {
        audioId: initialAudioId,
        speakerId: filterSpeakerId !== '' ? filterSpeakerId : undefined,
        fromDate: filterFromDate || undefined,
        toDate: filterToDate || undefined,
      });
      setResults(res.results);
    } catch (e: any) {
      setError(e.message ?? 'Search failed.');
    } finally {
      setLoading(false);
    }
  }, [initialAudioId, filterSpeakerId, filterFromDate, filterToDate]);

  // Run when q or filters change
  useEffect(() => { runSearch(q); }, [q, runSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputQuery.trim()) return;
    const next = new URLSearchParams(searchParams);
    next.set('q', inputQuery.trim());
    setSearchParams(next);
  };

  const clearFilters = () => {
    setFilterSpeakerId('');
    setFilterFromDate('');
    setFilterToDate('');
  };

  const activeFilters = filterSpeakerId !== '' || filterFromDate || filterToDate;

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest mb-1">Search</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">
          {initialAudioId ? 'Search in Recording' : 'Global Search'}
        </h1>
        {initialAudioId && (
          <p className="text-zinc-500 text-xs font-mono mt-0.5">
            Scoped to recording #{initialAudioId} ·{' '}
            <button
              onClick={() => navigate(`/search?q=${encodeURIComponent(q)}`)}
              className="text-blue-400 hover:text-blue-300 underline"
            >
              search all recordings
            </button>
          </p>
        )}
      </div>

      {/* Search bar */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            value={inputQuery}
            onChange={e => setInputQuery(e.target.value)}
            placeholder="Search across all recordings…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 pl-9 py-2.5 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-all"
            autoFocus
          />
        </div>
        <button
          type="button"
          onClick={() => setSemanticMode(m => !m)}
          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-md border text-xs font-mono transition-all ${
            semanticMode
              ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
              : 'bg-zinc-900 border-zinc-700 text-zinc-400'
          }`}
        >
          Semantic {semanticMode ? '●' : '○'}
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(f => !f)}
          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-md border text-xs transition-all ${
            activeFilters
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {activeFilters ? 'Filters active' : 'Filters'}
        </button>
        <button
          type="submit"
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
        >
          Search
        </button>
      </form>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Filters</span>
            {activeFilters && (
              <button onClick={clearFilters} className="text-zinc-500 hover:text-zinc-300 text-xs flex items-center gap-1">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-zinc-500 text-xs block mb-1">Speaker</label>
              <select
                value={filterSpeakerId}
                onChange={e => setFilterSpeakerId(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full bg-black border border-zinc-800 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="">All speakers</option>
                {allSpeakers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-zinc-500 text-xs block mb-1">Recorded from</label>
              <input
                type="date"
                value={filterFromDate}
                onChange={e => setFilterFromDate(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-zinc-500 text-xs block mb-1">Recorded to</label>
              <input
                type="date"
                value={filterToDate}
                onChange={e => setFilterToDate(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {loading && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Searching…
        </div>
      )}

      {error && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-md p-4 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && q && results.length === 0 && (
        <div className="text-center py-12">
          <Search className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">No results found for <span className="text-zinc-300">"{q}"</span></p>
          <p className="text-zinc-600 text-xs mt-1">Try different keywords or disable filters.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-2">
          <p className="text-zinc-500 text-xs font-mono">
            {results.length} result{results.length !== 1 ? 's' : ''} for <span className="text-zinc-300">"{q}"</span>
          </p>
          {results.map((r, i) => {
            const prev = results[i - 1];
            const showExactHeader = r.exactMatch && (i === 0 || !prev.exactMatch);
            const showRelatedHeader = !r.exactMatch && (i === 0 || prev.exactMatch) && results.some(x => x.exactMatch);
            return (
            <Fragment key={`${r.audioId}-${r.segmentId}`}>
            {showExactHeader && (
              <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest pt-2 pb-1">Exact matches</div>
            )}
            {showRelatedHeader && (
              <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest pt-4 pb-1">Related results</div>
            )}
            <div
              className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-md p-4 transition-colors"
            >
              {/* Meta row */}
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.speakerColor }} />
                  <Link
                    to={r.speakerId ? `/speaker/${r.speakerId}` : '#'}
                    className="text-white text-xs font-medium hover:text-blue-400 transition-colors"
                  >
                    {r.speakerName}
                  </Link>
                </div>
                <span className="text-zinc-700">·</span>
                <Link
                  to={`/analysis/${r.audioId}`}
                  className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
                >
                  <FileAudio className="w-3 h-3" />
                  {r.audioName}
                </Link>
                <span className="text-zinc-700">·</span>
                <Link
                  to={`/transcript/${r.audioId}#seg-${r.segmentId}`}
                  className="flex items-center gap-1 text-zinc-500 hover:text-blue-400 text-xs transition-colors font-mono"
                >
                  <Clock className="w-3 h-3" />
                  {formatTime(r.startTime)}
                </Link>
                <span className="ml-auto text-[10px] font-mono text-zinc-600 border border-zinc-800 px-1.5 py-0.5 rounded">
                  {(r.score * 100).toFixed(0)}
                </span>
              </div>

              {/* Segment text */}
              <p className="text-zinc-200 text-sm leading-relaxed">
                {r.exactMatch
                  ? highlightTerm(r.text, q, "bg-yellow-500/30 text-yellow-200 rounded-sm")
                  : r.relatedTerm
                    ? highlightTerm(r.text, r.relatedTerm, "bg-blue-500/30 text-blue-200 rounded-sm")
                    : r.text}
              </p>
              {!r.exactMatch && r.relatedTerm && (
                <p className="text-zinc-500 text-[10px] font-mono mt-1">
                  Related to "{q}" via "<span className="text-blue-300">{r.relatedTerm}</span>"
                </p>
              )}

              {/* Jump link */}
              <div className="mt-2 flex gap-3">
                <Link
                  to={`/analysis/${r.audioId}?t=${Math.floor(r.startTime)}`}
                  className="text-blue-500 hover:text-blue-400 text-xs transition-colors flex items-center gap-1"
                >
                  <Mic className="w-3 h-3" />
                  Open in analysis
                </Link>
                <Link
                  to={`/transcript/${r.audioId}#seg-${r.segmentId}`}
                  className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
                >
                  View in transcript
                </Link>
              </div>
            </div>
            </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
