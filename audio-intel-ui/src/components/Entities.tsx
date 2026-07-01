import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, AlertCircle, User, Building2, MapPin, Phone, Mail, DollarSign,
  ChevronDown, ChevronRight, ExternalLink, Ghost, Tag,
} from 'lucide-react';
import { entities, type EntityRecord, type EntityMentionRecord } from '../lib/api';

const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  PERSON:  { label: 'Person',       icon: User,       color: 'text-blue-400 bg-blue-500/10 border-blue-500/25' },
  ORG:     { label: 'Organization', icon: Building2,  color: 'text-purple-400 bg-purple-500/10 border-purple-500/25' },
  LOC:     { label: 'Location',     icon: MapPin,     color: 'text-green-400 bg-green-500/10 border-green-500/25' },
  MISC:    { label: 'Misc',         icon: Tag,        color: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/25' },
  PHONE:   { label: 'Phone',        icon: Phone,      color: 'text-amber-400 bg-amber-500/10 border-amber-500/25' },
  EMAIL:   { label: 'Email',        icon: Mail,       color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/25' },
  MONEY:   { label: 'Money',        icon: DollarSign, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
};

const ALL_TYPES = ['all', 'PERSON', 'ORG', 'LOC', 'MISC', 'PHONE', 'EMAIL', 'MONEY'] as const;
type TypeFilter = typeof ALL_TYPES[number];

function EntityRow({ ent, onPromoted, onRemoved }: {
  ent: EntityRecord;
  onPromoted: (entityId: number, ghostId: number) => void;
  onRemoved: (entityId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mentions, setMentions] = useState<EntityMentionRecord[]>([]);
  const [loadingMentions, setLoadingMentions] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null);

  const meta = TYPE_META[ent.type] ?? TYPE_META.MISC;
  const Icon = meta.icon;

  async function handleExpand() {
    if (!expanded && mentions.length === 0) {
      setLoadingMentions(true);
      try {
        const data = await entities.mentions(ent.id);
        setMentions(data);
      } finally {
        setLoadingMentions(false);
      }
    }
    setExpanded(v => !v);
  }

  async function handlePromote() {
    setPromoting(true); setPromoteMsg(null);
    try {
      const result = await entities.promoteToGhost(ent.id);
      if (result.kind === 'ghost_person') {
        // People become ghost speakers awaiting voice enrollment.
        onPromoted(ent.id, result.ghostSpeakerId);
        setPromoteMsg(result.alreadyPromoted
          ? 'This person is already a ghost node on the graph.'
          : `Ghost node created. ${result.edgesCreated ?? 0} edge${result.edgesCreated === 1 ? '' : 's'} drawn.`);
      } else {
        // Items become edge/solo badges — no ghost speaker id to track.
        onPromoted(ent.id, 0);
        setPromoteMsg(
          result.badgesCreated === 0
            ? 'Nothing to attach to on the graph.'
            : `Shown on the graph as ${result.badgesCreated} badge${result.badgesCreated === 1 ? '' : 's'} across ${result.utterers.length} speaker${result.utterers.length === 1 ? '' : 's'}.`
        );
      }
    } catch (e: any) {
      setPromoteMsg(`Failed: ${e.message ?? 'unknown error'}`);
    } finally {
      setPromoting(false);
      setTimeout(() => setPromoteMsg(null), 6000);
    }
  }

  async function handleRemoveFromGraph() {
    if (!confirm(`Remove "${ent.rawText}" from the network graph?`)) return;
    setPromoting(true); setPromoteMsg(null);
    try {
      await entities.removeFromGraph(ent.id);
      onRemoved(ent.id);
      setPromoteMsg('Removed from the graph.');
    } catch (e: any) {
      setPromoteMsg(`Failed: ${e.message ?? 'unknown error'}`);
    } finally {
      setPromoting(false);
      setTimeout(() => setPromoteMsg(null), 6000);
    }
  }

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden">
      <button
        onClick={handleExpand}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/3 transition-colors"
      >
        <Icon className={`w-4 h-4 shrink-0 ${meta.color.split(' ')[0]}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium text-sm truncate">{ent.rawText}</span>
            {ent.ghostSpeakerId && (
              <span className="flex items-center gap-1 text-[10px] text-violet-400 font-mono bg-violet-500/10 border border-violet-500/25 px-1.5 py-0.5 rounded">
                <Ghost className="w-3 h-3" /> Ghost
              </span>
            )}
            <span className={`text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${meta.color}`}>
              {meta.label}
            </span>
          </div>
          <div className="flex gap-4 mt-0.5 text-[11px] font-mono text-zinc-300">
            <span>{ent.mentionCount} mention{ent.mentionCount !== 1 ? 's' : ''}</span>
            <span>{ent.distinctSpeakerCount} speaker{ent.distinctSpeakerCount !== 1 ? 's' : ''}</span>
            <span>{ent.distinctAudioCount} audio{ent.distinctAudioCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-zinc-300 shrink-0" /> : <ChevronRight className="w-4 h-4 text-zinc-300 shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
          {/* Add to relation graph — PERSON becomes a ghost speaker awaiting
              voice enrollment; ORG/LOC/MISC become non-speaker nodes so their
              co-mention edges can render on the Network page. */}
          <div className="flex items-center gap-2 flex-wrap">
            {ent.onGraph ? (
              <button
                onClick={handleRemoveFromGraph}
                disabled={promoting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-red-600 border border-zinc-700 hover:border-red-500 text-zinc-200 hover:text-white rounded-md transition-colors"
              >
                {promoting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ghost className="w-3 h-3" />}
                {ent.type === 'PERSON' ? 'Remove ghost node' : 'Remove from graph'}
              </button>
            ) : (
              <button
                onClick={handlePromote}
                disabled={promoting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-md transition-colors"
              >
                {promoting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ghost className="w-3 h-3" />}
                {ent.type === 'PERSON' ? 'Promote to ghost node' : 'Show on relation graph'}
              </button>
            )}
            {promoteMsg && <span className="text-xs text-zinc-300">{promoteMsg}</span>}
          </div>

          {/* Mentions list */}
          {loadingMentions ? (
            <div className="flex items-center gap-2 text-zinc-300 text-xs py-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading mentions…
            </div>
          ) : mentions.length === 0 ? (
            <p className="text-zinc-400 text-xs">No mentions found.</p>
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {Object.entries(
                mentions.reduce<Record<number, EntityMentionRecord[]>>((acc, m) => {
                  (acc[m.audioId] ??= []).push(m);
                  return acc;
                }, {})
              ).map(([audioIdStr, group]) => (
                <div key={audioIdStr}>
                  <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1.5 px-1">
                    {group[0].audioName ?? `Recording #${audioIdStr}`}
                  </p>
                  <div className="space-y-1.5">
                    {group.map(m => (
                      <div key={m.id} className="bg-zinc-900 rounded px-3 py-2 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-zinc-200 leading-relaxed flex-1">
                            <span className="inline-block font-mono text-[10px] bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded mr-2 shrink-0 align-middle">
                              {m.speakerName ?? 'Unknown'}
                            </span>
                            {m.segmentText.slice(0, m.offset)}
                            <mark className="bg-blue-500/30 text-blue-200 rounded-sm px-0.5">
                              {m.segmentText.slice(m.offset, m.offset + m.length)}
                            </mark>
                            {m.segmentText.slice(m.offset + m.length)}
                          </p>
                          <Link
                            to={`/transcript/${m.audioId}#seg-${m.segmentId}`}
                            className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-mono shrink-0"
                          >
                            {String(Math.floor(m.startTime / 60)).padStart(2, '0')}:{String(Math.floor(m.startTime % 60)).padStart(2, '0')}
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Entities() {
  const [allEntities, setAllEntities] = useState<EntityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    entities.list()
      .then(setAllEntities)
      .catch(() => setError('Failed to load entities.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = allEntities.filter(e => {
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    if (search && !e.rawText.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-300 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading entities…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400 gap-2">
        <AlertCircle className="w-5 h-5" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-5">
      <div>
        <h1 className="text-white text-xl font-semibold">Entities</h1>
        <p className="text-zinc-300 text-sm mt-0.5">
          Named entities extracted from transcripts. People, organisations, locations, and more.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 w-48"
        />
        <div className="flex gap-1 flex-wrap">
          {ALL_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1 text-[11px] font-mono uppercase rounded-md border transition-colors ${
                typeFilter === t
                  ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                  : 'bg-transparent border-zinc-700 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              {t === 'all' ? 'All' : (TYPE_META[t]?.label ?? t)}
            </button>
          ))}
        </div>
        <span className="text-zinc-300 text-xs font-mono ml-auto">{filtered.length} entity{filtered.length !== 1 ? 'ies' : 'y'}</span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center text-zinc-400 py-16 text-sm">No entities found.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(ent => (
            <EntityRow
              key={ent.id}
              ent={ent}
              onPromoted={(entityId, ghostId) =>
                setAllEntities(prev => prev.map(e =>
                  e.id === entityId ? { ...e, ghostSpeakerId: ghostId || e.ghostSpeakerId, onGraph: true } : e))
              }
              onRemoved={(entityId) =>
                setAllEntities(prev => prev.map(e =>
                  e.id === entityId ? { ...e, ghostSpeakerId: null, onGraph: false } : e))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
