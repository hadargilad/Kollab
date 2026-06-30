import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, AlertCircle, ShieldAlert, Sparkles, ExternalLink, Filter, Ghost,
} from 'lucide-react';
import { alerts, type AlertRecord, type AlertCategory } from '../lib/api';
import SubScoresBar from './SubScoresBar';

type CategoryFilter = 'all' | AlertCategory;
type SeverityFilter = 'all' | 'low' | 'medium' | 'high';

const SEVERITY_BADGE: Record<'low' | 'medium' | 'high', string> = {
  low:    'text-blue-400 bg-blue-500/10 border-blue-500/25',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  high:   'text-red-400 bg-red-500/10 border-red-500/25',
};

function AlertCard({ a }: { a: AlertRecord }) {
  const isCoded = a.category === 'coded_language';
  const isGhost = a.category === 'intelligence';
  const severityCls = SEVERITY_BADGE[a.type] ?? SEVERITY_BADGE.low;
  const Icon = isGhost ? Ghost : isCoded ? Sparkles : ShieldAlert;
  const iconColor = isGhost
    ? 'text-violet-400'
    : isCoded
    ? 'text-orange-300'
    : a.type === 'high' ? 'text-red-400' : a.type === 'medium' ? 'text-amber-400' : 'text-blue-400';
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${severityCls}`}>
              {a.type}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-200">
              {isGhost ? 'Ghost Node' : isCoded ? 'Coded language' : a.category === 'dangerous_word' ? 'Flagged keyword' : 'Alert'}
            </span>
            <span className="text-[10px] font-mono text-zinc-300 ml-auto">{a.createdAt}</span>
          </div>
          <p className="text-zinc-300 text-sm leading-relaxed wrap-break-word">{a.message}</p>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] font-mono text-zinc-200">
            {a.audioName && (
              <span className="truncate max-w-50">{a.audioName}</span>
            )}
            {isGhost && a.speakerName && (
              <Link
                to={`/speaker/${a.speakerId}`}
                className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors"
              >
                <Ghost className="w-3 h-3" /> {a.speakerName}
                <ExternalLink className="w-3 h-3" />
              </Link>
            )}
            {a.audioId && a.segmentId && (
              <Link
                to={`/transcript/${a.audioId}#seg-${a.segmentId}`}
                className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
              >
                Jump to segment
                <ExternalLink className="w-3 h-3" />
              </Link>
            )}
            {a.audioId && !a.segmentId && (
              <Link
                to={`/transcript/${a.audioId}`}
                className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
              >
                Open transcript
                <ExternalLink className="w-3 h-3" />
              </Link>
            )}
            {a.speakerName && <span>· {a.speakerName}</span>}
          </div>
        </div>
      </div>
      {isCoded && a.subScores && <SubScoresBar scores={a.subScores} />}
      {a.llmExplanation && (
        <div className="text-xs text-zinc-300 italic border-l-2 border-zinc-800 pl-2">
          {a.llmExplanation}
        </div>
      )}
    </div>
  );
}

export default function Alerts() {
  const [items, setItems] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    alerts.list()
      .then(setItems)
      .catch(() => setError('Failed to load alerts.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return items.filter(a => {
      if (category !== 'all' && a.category !== category) return false;
      if (severity !== 'all' && a.type !== severity) return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = `${a.message ?? ''} ${a.audioName ?? ''} ${a.speakerName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, category, severity, query]);

  const counts = useMemo(() => {
    const out = { all: items.length, coded_language: 0, dangerous_word: 0, intelligence: 0 };
    for (const a of items) {
      if (a.category === 'coded_language') out.coded_language++;
      else if (a.category === 'dangerous_word') out.dangerous_word++;
      else if (a.category === 'intelligence') out.intelligence++;
    }
    return out;
  }, [items]);

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Security</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Alerts</h1>
        <p className="text-zinc-200 text-xs font-mono mt-0.5">
          {counts.all} total · {counts.coded_language} coded-language · {counts.dangerous_word} flagged keyword · {counts.intelligence} ghost node
        </p>
      </div>

      {/* Filter bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-zinc-200 shrink-0" />

        <div className="flex items-center gap-1">
          {(['all', 'coded_language', 'dangerous_word', 'intelligence'] as CategoryFilter[]).map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
                category === c
                  ? 'bg-blue-500/15 border border-blue-500/40 text-blue-300'
                  : 'border border-transparent text-zinc-300 hover:text-zinc-100'
              }`}
            >
              {c === 'all' ? 'All' : c === 'coded_language' ? 'Coded language' : c === 'dangerous_word' ? 'Flagged keyword' : 'Ghost Node'}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-zinc-800" />

        <select
          value={severity}
          onChange={e => setSeverity(e.target.value as SeverityFilter)}
          className="bg-black border border-zinc-800 rounded px-2.5 py-1 text-zinc-300 text-xs font-mono focus:outline-none focus:border-blue-500"
        >
          <option value="all">All severities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search message, audio, speaker…"
          className="flex-1 min-w-45 bg-black border border-zinc-800 rounded px-3 py-1 text-zinc-300 text-xs font-mono placeholder-zinc-400 focus:outline-none focus:border-blue-500"
        />

        {filtered.length !== items.length && (
          <span className="text-[11px] font-mono text-zinc-200">
            {filtered.length}/{items.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-500/5 border border-red-500/20 rounded-md p-6 text-center">
          <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-zinc-800 rounded-md p-10 text-center">
          <ShieldAlert className="w-6 h-6 text-zinc-300 mx-auto mb-2" />
          <p className="text-zinc-200 text-sm">No alerts match the current filters.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(a => <AlertCard key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}
