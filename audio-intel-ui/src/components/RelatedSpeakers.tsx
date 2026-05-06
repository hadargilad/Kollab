import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Search, Users, Check, X, Upload, Plus, AlertCircle,
  ChevronRight, User, Link2, Globe, ExternalLink, Sparkles,
} from 'lucide-react';
import {
  speakers, type SpeakerRecord, type EntityCandidate, type RelatedEntity,
} from '../lib/api';

type Step = 1 | 2 | 3;

const wikidataUrl = (qid: string) => `https://www.wikidata.org/wiki/${qid}`;

export default function RelatedSpeakers() {
  // ─── Step state ─────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1);

  // Step 1: pick source speaker
  const [allSpeakers, setAllSpeakers] = useState<SpeakerRecord[]>([]);
  const [speakersLoading, setSpeakersLoading] = useState(true);
  const [speakerFilter, setSpeakerFilter] = useState('');
  const [sourceId, setSourceId] = useState<number | null>(null);

  // Step 2: search Wikidata + pick candidate
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<EntityCandidate[]>([]);
  const [confirmLoadingId, setConfirmLoadingId] = useState<string | null>(null);

  // Step 3: related entities
  const [related, setRelated] = useState<RelatedEntity[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState('');
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [linkTarget, setLinkTarget] = useState<RelatedEntity | null>(null);
  const [linkName, setLinkName] = useState('');
  const [linkFile, setLinkFile] = useState<File | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkSuccess, setLinkSuccess] = useState('');
  const linkFileRef = useRef<HTMLInputElement>(null);

  // ─── Load speakers on mount ────────────────────────────────────────────────
  useEffect(() => {
    speakers.list()
      .then(setAllSpeakers)
      .catch(() => {/* ignore — UI shows empty state */})
      .finally(() => setSpeakersLoading(false));
  }, []);

  const source = useMemo(
    () => allSpeakers.find(s => s.id === sourceId) ?? null,
    [allSpeakers, sourceId],
  );

  const filteredSpeakers = useMemo(() => {
    const q = speakerFilter.trim().toLowerCase();
    if (!q) return allSpeakers;
    return allSpeakers.filter(s =>
      s.name.toLowerCase().includes(q) || s.voiceIdentifier.toLowerCase().includes(q),
    );
  }, [allSpeakers, speakerFilter]);

  // ─── Step transitions ──────────────────────────────────────────────────────
  const goToStep2 = (id: number) => {
    setSourceId(id);
    const s = allSpeakers.find(x => x.id === id);
    setSearchQuery(s?.name ?? '');
    setSearchResults([]);
    setSearchError('');
    setStep(2);
  };

  const handleSearch = async () => {
    if (!sourceId || !searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError('');
    setSearchResults([]);
    try {
      const results = await speakers.enrichmentSearch(sourceId, searchQuery.trim());
      setSearchResults(results);
      if (results.length === 0) setSearchError('No matches on Wikidata.');
    } catch (e: any) {
      setSearchError(e.message ?? 'Search failed.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleConfirm = async (cand: EntityCandidate) => {
    if (!sourceId) return;
    setConfirmLoadingId(cand.entityId);
    try {
      await speakers.enrichmentConfirm(sourceId, cand.entityId);
      setAllSpeakers(prev => prev.map(s =>
        s.id === sourceId ? { ...s, wikidataId: cand.entityId } : s,
      ));
      setStep(3);
      loadRelated(sourceId);
    } catch (e: any) {
      setSearchError(e.message ?? 'Failed to save entity.');
    } finally {
      setConfirmLoadingId(null);
    }
  };

  const loadRelated = async (id: number) => {
    setRelatedLoading(true);
    setRelatedError('');
    setRelated([]);
    try {
      const list = await speakers.enrichmentRelated(id);
      setRelated(list);
    } catch (e: any) {
      setRelatedError(e.message ?? 'Failed to load suggestions.');
    } finally {
      setRelatedLoading(false);
    }
  };

  const startLink = (cand: RelatedEntity) => {
    setLinkTarget(cand);
    setLinkName(cand.label);
    setLinkFile(null);
    setLinkError('');
    if (linkFileRef.current) linkFileRef.current.value = '';
  };

  const cancelLink = () => {
    setLinkTarget(null);
    setLinkName('');
    setLinkFile(null);
    setLinkError('');
  };

  const submitLink = async () => {
    if (!sourceId || !linkTarget) return;
    if (!linkName.trim()) { setLinkError('Name is required.'); return; }
    if (!linkFile) { setLinkError('Please choose an audio file for this person.'); return; }

    setLinking(true);
    setLinkError('');
    try {
      await speakers.enrichmentLink(sourceId, linkTarget.entityId, linkName.trim(), linkFile);
      setLinkedIds(prev => new Set(prev).add(linkTarget.entityId));
      setLinkSuccess(`Added ${linkTarget.label} as a suggested connection of ${source?.name ?? 'source'}.`);
      cancelLink();
      setTimeout(() => setLinkSuccess(''), 5000);
    } catch (e: any) {
      setLinkError(e.message ?? 'Failed to add speaker.');
    } finally {
      setLinking(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="w-7 h-7 text-blue-400" />
          <h1 className="text-white text-3xl">Related Speakers</h1>
        </div>
        <p className="text-slate-400">
          Public Intelligence Enrichment — find entities related to a known speaker on
          Wikidata, then enroll them as new speakers in the system.
        </p>
        <p className="text-slate-500 text-xs mt-1">
          Suggestions are derived from public knowledge graphs and require analyst confirmation
          before they're treated as real intelligence.
        </p>
      </div>

      {/* Stepper */}
      <div className="max-w-4xl mb-8">
        <div className="flex items-center gap-2">
          {([1, 2, 3] as Step[]).map((n, i) => (
            <div key={n} className="flex items-center flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  step >= n
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-500 border border-slate-700'
                }`}
              >
                {step > n ? <Check className="w-4 h-4" /> : n}
              </div>
              <div className={`ml-3 text-sm ${step >= n ? 'text-white' : 'text-slate-500'}`}>
                {n === 1 && 'Pick speaker'}
                {n === 2 && 'Match entity'}
                {n === 3 && 'Add suggestions'}
              </div>
              {i < 2 && (
                <div className={`flex-1 h-px mx-3 ${step > n ? 'bg-blue-600' : 'bg-slate-800'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-4xl">
        {linkSuccess && (
          <div className="mb-4 px-4 py-3 bg-emerald-600/20 border border-emerald-600/40 rounded-lg text-emerald-300 text-sm flex items-center gap-2">
            <Check className="w-4 h-4" />
            {linkSuccess}
          </div>
        )}

        {/* ─── Step 1 ─────────────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-6 h-6 text-blue-500" />
              <h2 className="text-white text-xl">Pick a speaker</h2>
            </div>
            <p className="text-slate-400 text-sm mb-6">
              Choose the speaker whose public connections you want to enrich.
            </p>

            <div className="relative mb-4">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by name or voice ID…"
                value={speakerFilter}
                onChange={e => setSpeakerFilter(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {speakersLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading speakers…
              </div>
            ) : filteredSpeakers.length === 0 ? (
              <div className="text-slate-500 text-sm py-8 text-center border border-dashed border-slate-700 rounded-lg">
                No speakers found.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredSpeakers.map(s => (
                  <button
                    key={s.id}
                    onClick={() => goToStep2(s.id)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-800 hover:bg-slate-750 hover:border-blue-500/50 border border-slate-700 rounded-lg transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: `${s.color}20` }}
                      >
                        <User className="w-5 h-5" style={{ color: s.color }} />
                      </div>
                      <div>
                        <div className="text-white">{s.name}</div>
                        <div className="text-slate-500 text-xs">
                          {s.recordingCount} recording{s.recordingCount !== 1 ? 's' : ''} ·{' '}
                          {s.sampleCount} sample{s.sampleCount !== 1 ? 's' : ''}
                          {s.wikidataId && (
                            <span className="ml-2 text-blue-400">· {s.wikidataId}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-500" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Step 2 ─────────────────────────────────────────────────────── */}
        {step === 2 && source && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <Globe className="w-6 h-6 text-blue-500" />
                <h2 className="text-white text-xl">Match a Wikidata entity</h2>
              </div>
              <button
                onClick={() => setStep(1)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ← Change speaker
              </button>
            </div>
            <p className="text-slate-400 text-sm mb-6">
              Find the public entity that corresponds to{' '}
              <span className="text-white font-medium">{source.name}</span>. Pick the right
              one — Wikidata often has multiple people with the same name.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <input
                type="text"
                placeholder="e.g. Lewis Hamilton"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSearch}
                disabled={searchLoading || !searchQuery.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {searchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Search Wikidata
              </button>
            </div>

            {searchError && (
              <div className="mb-4 px-4 py-3 bg-red-600/20 border border-red-600/40 rounded-lg text-red-300 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{searchError}</span>
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="space-y-2">
                {searchResults.map(cand => (
                  <div
                    key={cand.entityId}
                    className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-800 border border-slate-700 hover:border-blue-500/40 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {cand.imageUrl ? (
                        <img
                          src={cand.imageUrl}
                          alt={cand.label}
                          className="w-12 h-12 rounded-full object-cover bg-slate-700"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center">
                          <User className="w-6 h-6 text-slate-500" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-white font-medium truncate">{cand.label}</div>
                          <a
                            href={wikidataUrl(cand.entityId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 text-xs font-mono inline-flex items-center gap-1 hover:underline"
                            title="Open on Wikidata"
                          >
                            {cand.entityId}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        {cand.description && (
                          <div className="text-slate-400 text-sm truncate">{cand.description}</div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleConfirm(cand)}
                      disabled={confirmLoadingId !== null}
                      className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors shrink-0"
                    >
                      {confirmLoadingId === cand.entityId ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      This is {source.name}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Step 3 ─────────────────────────────────────────────────────── */}
        {step === 3 && source && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <Link2 className="w-6 h-6 text-blue-500" />
                <h2 className="text-white text-xl">Suggested connections for {source.name}</h2>
              </div>
              <button
                onClick={() => setStep(2)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ← Re-match entity
              </button>
            </div>
            <p className="text-slate-400 text-sm mb-2">
              Possible connections derived from public Wikidata claims (spouses, teammates,
              employers, alma maters). Each card explains <span className="text-white">why</span>{' '}
              the connection was suggested.
            </p>
            <p className="text-slate-500 text-xs mb-6">
              Add a candidate as a speaker by clicking <span className="text-white">Add as speaker</span>.
              You'll need a clean audio sample — they'll be enrolled and linked to {source.name} as a
              suggested (Wikidata-derived) connection.
            </p>

            {relatedLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Querying Wikidata…
              </div>
            ) : relatedError ? (
              <div className="px-4 py-3 bg-red-600/20 border border-red-600/40 rounded-lg text-red-300 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{relatedError}</span>
              </div>
            ) : related.length === 0 ? (
              <div className="text-slate-500 text-sm py-8 text-center border border-dashed border-slate-700 rounded-lg">
                No related entities found on Wikidata for this person.
              </div>
            ) : (
              <div className="space-y-2">
                {related.map(c => {
                  const linked = linkedIds.has(c.entityId);
                  return (
                    <div
                      key={c.entityId}
                      className="flex items-center justify-between px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {c.imageUrl ? (
                          <img
                            src={c.imageUrl}
                            alt={c.label}
                            className="w-10 h-10 rounded-full object-cover bg-slate-700"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                            <User className="w-5 h-5 text-slate-500" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white truncate">{c.label}</span>
                            <a
                              href={wikidataUrl(c.entityId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 text-xs font-mono hover:underline shrink-0"
                            >
                              {c.entityId}
                            </a>
                          </div>
                          <div className="text-slate-400 text-xs truncate">
                            <span className="text-blue-300">{c.reason}</span>
                            {c.description && <span className="text-slate-500"> · {c.description}</span>}
                          </div>
                        </div>
                      </div>
                      {linked ? (
                        <span className="px-3 py-1.5 bg-emerald-600/20 text-emerald-300 text-xs rounded-lg border border-emerald-600/40 flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5" /> Linked
                        </span>
                      ) : (
                        <button
                          onClick={() => startLink(c)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                        >
                          <Plus className="w-4 h-4" /> Add as speaker
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Add-as-speaker modal ──────────────────────────────────────────── */}
      {linkTarget && source && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg w-full max-w-lg">
            <div className="p-6 border-b border-slate-800">
              <div className="flex items-center justify-between">
                <h3 className="text-white text-lg">Enroll {linkTarget.label}</h3>
                <button onClick={cancelLink} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-slate-400 text-sm mt-2">
                Suggested via Wikidata as <span className="text-blue-300">{linkTarget.reason}</span>.
                Provide a clean 10–30 second audio clip; we'll enroll them as a new speaker and link
                them to <span className="text-white">{source.name}</span> with the
                {' '}<span className="text-blue-300">wikidata</span> topic so the connection shows up
                as a suggested edge.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-slate-300 text-sm mb-2">Display name</label>
                <input
                  type="text"
                  value={linkName}
                  onChange={e => setLinkName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 text-sm mb-2">Audio sample</label>
                <label className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 hover:border-slate-500 rounded-lg text-slate-300 cursor-pointer transition-colors">
                  <Upload className="w-4 h-4" />
                  {linkFile ? linkFile.name : 'Choose audio file'}
                  <input
                    ref={linkFileRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={e => setLinkFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {linkError && (
                <div className="px-4 py-2 bg-red-600/20 border border-red-600/40 rounded-lg text-red-300 text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{linkError}</span>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-slate-800 flex justify-end gap-3">
              <button
                onClick={cancelLink}
                disabled={linking}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitLink}
                disabled={linking || !linkName.trim() || !linkFile}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Enroll & link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
