import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Search, Users, Check, X, Upload, Plus, AlertCircle,
  ChevronRight, User, Link2, Globe, ExternalLink, UsersRound,
} from 'lucide-react';
import {
  speakers, type SpeakerRecord, type EntityCandidate, type RelatedEntity,
} from '../lib/api';

type Step = 1 | 2 | 3;

const wikidataUrl = (qid: string) => `https://www.wikidata.org/wiki/${qid}`;

export default function RelatedSpeakers() {
  const [step, setStep] = useState<Step>(1);

  const [allSpeakers, setAllSpeakers] = useState<SpeakerRecord[]>([]);
  const [speakersLoading, setSpeakersLoading] = useState(true);
  const [speakerFilter, setSpeakerFilter] = useState('');
  const [sourceId, setSourceId] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<EntityCandidate[]>([]);
  const [confirmLoadingId, setConfirmLoadingId] = useState<string | null>(null);

  const [related, setRelated] = useState<RelatedEntity[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState('');
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());

  // Step-3 free-text search (alongside the Wikidata-suggested list, lets the
  // analyst find someone Wikidata didn't auto-link).
  const [extraQuery, setExtraQuery] = useState('');
  const [extraResults, setExtraResults] = useState<EntityCandidate[]>([]);
  const [extraLoading, setExtraLoading] = useState(false);
  const [extraError, setExtraError] = useState('');
  const [linkTarget, setLinkTarget] = useState<RelatedEntity | null>(null);
  const [linkName, setLinkName] = useState('');
  const [linkAudioName, setLinkAudioName] = useState('');
  const [linkFile, setLinkFile] = useState<File | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkSuccess, setLinkSuccess] = useState('');
  const linkFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    speakers.list()
      .then(setAllSpeakers)
      .catch(() => {})
      .finally(() => setSpeakersLoading(false));
  }, []);

  const source = useMemo(() => allSpeakers.find(s => s.id === sourceId) ?? null, [allSpeakers, sourceId]);

  const filteredSpeakers = useMemo(() => {
    const q = speakerFilter.trim().toLowerCase();
    if (!q) return allSpeakers;
    return allSpeakers.filter(s => s.name.toLowerCase().includes(q) || s.voiceIdentifier.toLowerCase().includes(q));
  }, [allSpeakers, speakerFilter]);

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
      setAllSpeakers(prev => prev.map(s => s.id === sourceId ? { ...s, wikidataId: cand.entityId } : s));
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

  const handleExtraSearch = async () => {
    if (!sourceId || !extraQuery.trim()) return;
    setExtraLoading(true);
    setExtraError('');
    setExtraResults([]);
    try {
      const results = await speakers.enrichmentSearch(sourceId, extraQuery.trim());
      setExtraResults(results);
      if (results.length === 0) setExtraError('No matches on Wikidata.');
    } catch (e: any) {
      setExtraError(e.message ?? 'Search failed.');
    } finally {
      setExtraLoading(false);
    }
  };

  const startLink = (cand: RelatedEntity) => {
    setLinkTarget(cand);
    setLinkName(cand.label);
    setLinkAudioName('');
    setLinkFile(null);
    setLinkError('');
    if (linkFileRef.current) linkFileRef.current.value = '';
  };

  const cancelLink = () => {
    setLinkTarget(null);
    setLinkName('');
    setLinkAudioName('');
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
      await speakers.enrichmentLink(sourceId, linkTarget.entityId, linkName.trim(), linkFile, linkAudioName.trim());
      setLinkedIds(prev => new Set(prev).add(linkTarget.entityId));
      setLinkSuccess(`Added ${linkTarget.label} as a suggested connection of ${source?.name ?? 'source'}. Recording queued for analysis.`);
      cancelLink();
      setTimeout(() => setLinkSuccess(''), 5000);
    } catch (e: any) {
      setLinkError(e.message ?? 'Failed to add speaker.');
    } finally {
      setLinking(false);
    }
  };

  const inputCls = 'w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all';

  const stepLabels = ['Pick speaker', 'Match entity', 'Add suggestions'];

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Intelligence</div>
        <div className="flex items-center gap-2.5 mb-0.5">
          <UsersRound className="w-5 h-5 text-blue-400" />
          <h1 className="text-white text-2xl font-bold tracking-tight">Related Speakers</h1>
        </div>
        <p className="text-zinc-300 text-sm">
          Public intelligence enrichment — find entities related to a known speaker on Wikidata,
          then enroll them as new speakers.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 max-w-2xl">
        {([1, 2, 3] as Step[]).map((n, i) => (
          <div key={n} className="flex items-center flex-1">
            <div className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold font-mono transition-colors shrink-0 ${
              step >= n ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-200 border border-zinc-700'
            }`}>
              {step > n ? <Check className="w-3.5 h-3.5" /> : n}
            </div>
            <div className={`ml-2 text-xs font-mono ${step >= n ? 'text-zinc-300' : 'text-zinc-200'}`}>
              {stepLabels[i]}
            </div>
            {i < 2 && <div className={`flex-1 h-px mx-3 ${step > n ? 'bg-blue-600' : 'bg-zinc-800'}`} />}
          </div>
        ))}
      </div>

      <div className="max-w-3xl">
        {linkSuccess && (
          <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-emerald-500/8 border border-emerald-500/25 rounded-md text-emerald-300 text-sm">
            <Check className="w-4 h-4 shrink-0" /> {linkSuccess}
          </div>
        )}

        {/* Step 1 */}
        {step === 1 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-zinc-800">
              <Users className="w-4 h-4 text-blue-400" />
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Pick a Speaker</span>
            </div>
            <div className="p-5">
              <p className="text-zinc-300 text-xs mb-4">Choose the speaker whose public connections you want to enrich.</p>
              <div className="relative mb-4">
                <Search className="w-3.5 h-3.5 text-zinc-200 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" placeholder="Search by name or voice ID…" value={speakerFilter}
                  onChange={e => setSpeakerFilter(e.target.value)}
                  className={inputCls + ' pl-9'} />
              </div>

              {speakersLoading ? (
                <div className="flex items-center gap-2 text-zinc-300 text-xs py-4">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading speakers…
                </div>
              ) : filteredSpeakers.length === 0 ? (
                <div className="text-zinc-300 text-sm py-8 text-center border border-dashed border-zinc-800 rounded-md">No speakers found.</div>
              ) : (
                <div className="space-y-1.5 max-h-96 overflow-y-auto">
                  {filteredSpeakers.map(s => (
                    <button key={s.id} onClick={() => goToStep2(s.id)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-black border border-zinc-800 hover:border-zinc-600 rounded transition-colors text-left">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${s.color}18` }}>
                          <User className="w-4 h-4" style={{ color: s.color }} />
                        </div>
                        <div>
                          <div className="text-white text-sm">{s.name}</div>
                          <div className="text-zinc-200 text-xs font-mono">
                            {s.recordingCount} rec · {s.sampleCount} sample{s.sampleCount !== 1 ? 's' : ''}
                            {s.wikidataId && <span className="ml-2 text-blue-400">{s.wikidataId}</span>}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-200" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && source && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-400" />
                <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Match Wikidata Entity</span>
              </div>
              <button onClick={() => setStep(1)} className="text-zinc-300 hover:text-zinc-100 text-xs font-mono">← Change speaker</button>
            </div>
            <div className="p-5">
              <p className="text-zinc-300 text-xs mb-4">
                Find the public entity for <span className="text-zinc-200 font-medium">{source.name}</span>. Pick carefully — Wikidata often has multiple people with the same name.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <input type="text" placeholder="e.g. Lewis Hamilton" value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  className={inputCls + ' flex-1'} />
                <button onClick={handleSearch} disabled={searchLoading || !searchQuery.trim()}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded transition-colors shrink-0">
                  {searchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  Search Wikidata
                </button>
              </div>

              {searchError && (
                <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-500/8 border border-red-500/25 rounded-md text-red-400 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{searchError}</span>
                </div>
              )}

              {searchResults.length > 0 && (
                <div className="space-y-2">
                  {searchResults.map(cand => (
                    <div key={cand.entityId}
                      className="flex items-center justify-between gap-4 px-4 py-3 bg-black border border-zinc-800 hover:border-zinc-600 rounded transition-colors">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {cand.imageUrl ? (
                          <img src={cand.imageUrl} alt={cand.label}
                            className="w-10 h-10 rounded object-cover bg-zinc-800"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <div className="w-10 h-10 rounded bg-zinc-800 flex items-center justify-center shrink-0">
                            <User className="w-5 h-5 text-zinc-200" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-sm font-medium truncate">{cand.label}</span>
                            <a href={wikidataUrl(cand.entityId)} target="_blank" rel="noopener noreferrer"
                              className="text-blue-400 text-[10px] font-mono inline-flex items-center gap-0.5 hover:underline shrink-0">
                              {cand.entityId}<ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                          {cand.description && <div className="text-zinc-300 text-xs truncate">{cand.description}</div>}
                        </div>
                      </div>
                      <button onClick={() => handleConfirm(cand)} disabled={confirmLoadingId !== null}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs rounded transition-colors shrink-0">
                        {confirmLoadingId === cand.entityId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        This is {source.name}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && source && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-blue-400" />
                <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Suggested Connections — {source.name}</span>
              </div>
              <button onClick={() => setStep(2)} className="text-zinc-300 hover:text-zinc-100 text-xs font-mono">← Re-match</button>
            </div>
            <div className="p-5">
              <p className="text-zinc-300 text-xs mb-1">
                Connections derived from public Wikidata claims (spouses, teammates, employers, alma maters). Each card explains <span className="text-zinc-300">why</span> it was suggested.
              </p>
              <p className="text-zinc-300 text-xs mb-4 font-mono">
                Click <span className="text-zinc-300">Add as speaker</span> to enroll — you'll need a clean audio sample.
              </p>

              {/* Free-text Wikidata search — for someone the suggestions didn't include. */}
              <div className="mb-5 pb-5 border-b border-zinc-800">
                <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-2">
                  Or search Wikidata directly
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-zinc-200 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input type="text" placeholder="e.g. Sebastian Vettel"
                      value={extraQuery}
                      onChange={e => setExtraQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleExtraSearch()}
                      className={inputCls + ' pl-9'} />
                  </div>
                  <button onClick={handleExtraSearch} disabled={extraLoading || !extraQuery.trim()}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded transition-colors shrink-0">
                    {extraLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    Search
                  </button>
                </div>
                {extraError && (
                  <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-red-500/8 border border-red-500/25 rounded text-red-400 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{extraError}</span>
                  </div>
                )}
                {extraResults.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {extraResults.map(cand => {
                      const linked = linkedIds.has(cand.entityId);
                      return (
                        <div key={cand.entityId}
                          className="flex items-center justify-between px-4 py-3 bg-black border border-zinc-800 rounded">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {cand.imageUrl ? (
                              <img src={cand.imageUrl} alt={cand.label}
                                className="w-8 h-8 rounded object-cover bg-zinc-800"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : (
                              <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center shrink-0">
                                <User className="w-4 h-4 text-zinc-200" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-white text-sm truncate">{cand.label}</span>
                                <a href={wikidataUrl(cand.entityId)} target="_blank" rel="noopener noreferrer"
                                  className="text-blue-400 text-[10px] font-mono hover:underline shrink-0">{cand.entityId}</a>
                              </div>
                              {cand.description && <div className="text-zinc-200 text-xs truncate">{cand.description}</div>}
                            </div>
                          </div>
                          {linked ? (
                            <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/8 border border-emerald-500/25 text-emerald-300 text-[10px] font-mono rounded shrink-0">
                              <Check className="w-3 h-3" /> Linked
                            </span>
                          ) : (
                            <button onClick={() => startLink({
                              entityId: cand.entityId,
                              label: cand.label,
                              description: cand.description ?? '',
                              imageUrl: cand.imageUrl ?? null,
                              reason: 'manual search',
                            } as RelatedEntity)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors shrink-0">
                              <Plus className="w-3.5 h-3.5" /> Add as speaker
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {relatedLoading ? (
                <div className="flex items-center justify-center gap-2 text-zinc-300 text-xs py-8">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Querying Wikidata…
                </div>
              ) : relatedError ? (
                <div className="flex items-start gap-2 px-4 py-3 bg-red-500/8 border border-red-500/25 rounded-md text-red-400 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{relatedError}</span>
                </div>
              ) : related.length === 0 ? (
                <div className="text-zinc-300 text-sm py-8 text-center border border-dashed border-zinc-800 rounded-md">
                  No related entities found on Wikidata for this person.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {related.map(c => {
                    const linked = linkedIds.has(c.entityId);
                    return (
                      <div key={c.entityId}
                        className="flex items-center justify-between px-4 py-3 bg-black border border-zinc-800 rounded">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {c.imageUrl ? (
                            <img src={c.imageUrl} alt={c.label}
                              className="w-8 h-8 rounded object-cover bg-zinc-800"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          ) : (
                            <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center shrink-0">
                              <User className="w-4 h-4 text-zinc-200" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-white text-sm truncate">{c.label}</span>
                              <a href={wikidataUrl(c.entityId)} target="_blank" rel="noopener noreferrer"
                                className="text-blue-400 text-[10px] font-mono hover:underline shrink-0">{c.entityId}</a>
                            </div>
                            <div className="text-xs truncate">
                              <span className="text-blue-300 font-mono">{c.reason}</span>
                              {c.description && <span className="text-zinc-200"> · {c.description}</span>}
                            </div>
                          </div>
                        </div>
                        {linked ? (
                          <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/8 border border-emerald-500/25 text-emerald-300 text-[10px] font-mono rounded shrink-0">
                            <Check className="w-3 h-3" /> Linked
                          </span>
                        ) : (
                          <button onClick={() => startLink(c)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors shrink-0">
                            <Plus className="w-3.5 h-3.5" /> Add as speaker
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Enroll modal */}
      {linkTarget && source && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-white font-semibold">Enroll {linkTarget.label}</h3>
              <button onClick={cancelLink} className="text-zinc-200 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-zinc-300 text-xs mb-4">
                Suggested via Wikidata as <span className="text-blue-300 font-mono">{linkTarget.reason}</span>.
                Provide a clean 10–30 second audio clip; they'll be enrolled and linked to <span className="text-zinc-200">{source.name}</span>.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Speaker Name</label>
                  <input type="text" value={linkName} onChange={e => setLinkName(e.target.value)}
                    className="w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 transition-all" />
                </div>
                <div>
                  <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">
                    Recording Name <span className="text-zinc-400 normal-case">(optional)</span>
                  </label>
                  <input type="text" value={linkAudioName} onChange={e => setLinkAudioName(e.target.value)}
                    placeholder={`Default: Enrollment — ${linkName.trim() || linkTarget.label}`}
                    className="w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 transition-all" />
                </div>
                <div>
                  <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Audio Sample</label>
                  <label className="flex items-center gap-2 px-3 py-2.5 bg-black border border-zinc-800 hover:border-zinc-600 rounded text-zinc-200 cursor-pointer transition-colors text-sm">
                    <Upload className="w-3.5 h-3.5" />
                    {linkFile ? linkFile.name : 'Choose audio file'}
                    <input ref={linkFileRef} type="file" accept="audio/*" className="hidden"
                      onChange={e => setLinkFile(e.target.files?.[0] ?? null)} />
                  </label>
                  <p className="text-zinc-400 text-[10px] mt-1.5">
                    This recording will be analyzed (transcript + speakers) and appear in All Uploads.
                  </p>
                </div>
                {linkError && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/8 border border-red-500/25 rounded text-red-400 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{linkError}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-zinc-800 flex justify-end gap-2">
              <button onClick={cancelLink} disabled={linking}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded transition-colors">
                Cancel
              </button>
              <button onClick={submitLink} disabled={linking || !linkName.trim() || !linkFile}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm rounded transition-colors">
                {linking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Enroll & Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
