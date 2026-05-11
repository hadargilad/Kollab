import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Play, Pause, Volume2, FileText, Network, Clock, Waves, Loader2, AlertCircle, RefreshCw, UserX, Merge, UserCheck, X, Scissors } from 'lucide-react';
import { audios, speakers as speakersApi, suggestions as suggestionsApi, alerts as alertsApi, type AudioRecord, type SegmentRecord, type SpeakerRecord, type SpeakerSuggestion, type AlertRecord } from '../lib/api';

interface Speaker {
  id: number;
  name: string;
  color: string;
}

export default function AudioAnalysis() {
  const { id } = useParams<{ id: string }>();
  const audioId = Number(id);

  const [audio, setAudio] = useState<AudioRecord | null>(null);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [reassignTarget, setReassignTarget] = useState<Speaker | null>(null);
  const [reassignName, setReassignName] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [knownSpeakers, setKnownSpeakers] = useState<SpeakerRecord[]>([]);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const [pendingSuggestions, setPendingSuggestions] = useState<SpeakerSuggestion[]>([]);
  const [resolvingSuggestionIds, setResolvingSuggestionIds] = useState<Set<number>>(new Set());
  const [splitMode, setSplitMode] = useState(false);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<number>>(new Set());
  const [splitSourceSpeakerId, setSplitSourceSpeakerId] = useState<number | null>(null);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [splitNewName, setSplitNewName] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState('');
  const [audioAlerts, setAudioAlerts] = useState<AlertRecord[]>([]);

  const refreshSuggestions = async () => {
    try {
      const list = await suggestionsApi.listForAudio(audioId);
      setPendingSuggestions(list);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!audioId) return;
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const [audioData, segsData] = await Promise.all([audios.get(audioId), audios.getSegments(audioId)]);
        if (cancelled) return;
        setAudio(audioData);
        setSegments(segsData);
        setLoading(false);
        if (audioData.status === 'processed') {
          refreshSuggestions();
          alertsApi.listForAudio(audioId).then(setAudioAlerts).catch(() => {});
        }
        if (audioData.status === 'processing') setTimeout(() => { if (!cancelled) fetchAll(); }, 5000);
      } catch {
        if (!cancelled) { setError('Failed to load analysis data.'); setLoading(false); }
      }
    };
    fetchAll();
    speakersApi.list().then(s => { if (!cancelled) setKnownSpeakers(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [audioId]);

  const handleAcceptSuggestion = async (suggestion: SpeakerSuggestion) => {
    setResolvingSuggestionIds(prev => new Set(prev).add(suggestion.id));
    try {
      await suggestionsApi.accept(audioId, suggestion.id);
      const [newSegs, newKnown] = await Promise.all([audios.getSegments(audioId), speakersApi.list()]);
      setSegments(newSegs);
      setKnownSpeakers(newKnown);
      await refreshSuggestions();
      setMergeNotice(`Confirmed as "${suggestion.suggestedSpeaker.name}". Voice samples merged.`);
      setTimeout(() => setMergeNotice(null), 6000);
    } finally {
      setResolvingSuggestionIds(prev => { const s = new Set(prev); s.delete(suggestion.id); return s; });
    }
  };

  const exitSplitMode = () => {
    setSplitMode(false);
    setSelectedSegmentIds(new Set());
    setSplitSourceSpeakerId(null);
    setSplitNewName('');
    setSplitError('');
  };

  const toggleSegmentForSplit = (segmentId: number, segmentSpeakerId: number) => {
    setSelectedSegmentIds(prev => {
      const next = new Set(prev);
      if (next.has(segmentId)) {
        next.delete(segmentId);
        if (next.size === 0) setSplitSourceSpeakerId(null);
        return next;
      }
      if (splitSourceSpeakerId === null) setSplitSourceSpeakerId(segmentSpeakerId);
      else if (splitSourceSpeakerId !== segmentSpeakerId) return prev;
      next.add(segmentId);
      return next;
    });
  };

  const handleSplitConfirm = async () => {
    if (splitSourceSpeakerId === null || selectedSegmentIds.size === 0) return;
    setSplitting(true);
    setSplitError('');
    try {
      await speakersApi.split(audioId, splitSourceSpeakerId, Array.from(selectedSegmentIds), splitNewName.trim());
      const [newSegs, newKnown] = await Promise.all([audios.getSegments(audioId), speakersApi.list()]);
      setSegments(newSegs);
      setKnownSpeakers(newKnown);
      await refreshSuggestions();
      setSplitModalOpen(false);
      exitSplitMode();
    } catch (e: any) {
      setSplitError(e.message ?? 'Split failed.');
    } finally {
      setSplitting(false);
    }
  };

  const handleRejectSuggestion = async (suggestion: SpeakerSuggestion) => {
    setResolvingSuggestionIds(prev => new Set(prev).add(suggestion.id));
    try {
      await suggestionsApi.reject(audioId, suggestion.id);
      await refreshSuggestions();
    } finally {
      setResolvingSuggestionIds(prev => { const s = new Set(prev); s.delete(suggestion.id); return s; });
    }
  };

  const speakers: Speaker[] = [];
  const seenSpeakers = new Set<number>();
  for (const seg of segments) {
    if (!seenSpeakers.has(seg.speakerId)) {
      seenSpeakers.add(seg.speakerId);
      speakers.push({ id: seg.speakerId, name: seg.speakerName, color: seg.speakerColor });
    }
  }

  const duration = audio?.duration ?? 0;
  const getCurrentSegment = () => segments.find(seg => currentTime >= seg.startTime && currentTime < seg.endTime);
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

  const reassignTrimmed = reassignName.trim();
  const reassignMatch = reassignTrimmed
    ? knownSpeakers.find(s => s.id !== reassignTarget?.id && s.name.trim().toLowerCase() === reassignTrimmed.toLowerCase())
    : undefined;

  const handleReassign = async (forceSeparate = false) => {
    if (!reassignTarget || !audio) return;
    setReassigning(true);
    try {
      await speakersApi.reassign(audioId, reassignTarget.id, reassignTrimmed || 'Unknown', forceSeparate);
      const [newAudio, newSegs, newKnown] = await Promise.all([audios.get(audioId), audios.getSegments(audioId), speakersApi.list()]);
      setAudio(newAudio);
      setSegments(newSegs);
      setKnownSpeakers(newKnown);
      if (reassignMatch && !forceSeparate) {
        setMergeNotice(`Folded into existing profile "${reassignMatch.name}". Voice samples were combined.`);
        setTimeout(() => setMergeNotice(null), 6000);
      }
      setReassignTarget(null);
      setReassignName('');
    } finally {
      setReassigning(false);
    }
  };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) el.play().catch(() => setIsPlaying(false));
    else el.pause();
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

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

  const currentSegment = getCurrentSegment();
  const isProcessing = audio.status === 'processing';

  const modalCls = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4';
  const modalCard = 'bg-zinc-950 border border-zinc-800 rounded-md w-full max-w-md shadow-2xl';

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest mb-1">Analysis</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">{audio.name}</h1>
        <div className="flex items-center gap-4 text-zinc-500 text-xs font-mono mt-1 flex-wrap">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(duration)}</span>
          <span>{speakers.length} speaker{speakers.length !== 1 ? 's' : ''}</span>
          {audio.uploadedBy && <span>by {audio.uploadedBy}</span>}
          <span className="font-mono text-zinc-700">ID:{id}</span>
        </div>
      </div>

      {isProcessing && (
        <div className="flex items-center gap-3 bg-amber-500/8 border border-amber-500/25 rounded-md px-4 py-3">
          <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
          <div>
            <p className="text-amber-200 text-sm font-medium">ML pipeline running</p>
            <p className="text-zinc-500 text-xs">Segments will appear when analysis completes.</p>
          </div>
        </div>
      )}

      {mergeNotice && (
        <div className="flex items-center gap-3 bg-blue-500/8 border border-blue-500/25 rounded-md px-4 py-3">
          <Merge className="w-4 h-4 text-blue-400 shrink-0" />
          <p className="text-blue-200 text-sm">{mergeNotice}</p>
        </div>
      )}

      {pendingSuggestions.length > 0 && (
        <div className="space-y-2">
          {pendingSuggestions.map(sg => {
            const pct = Math.round(sg.confidence * 100);
            const busy = resolvingSuggestionIds.has(sg.id);
            return (
              <div key={sg.id} className="flex items-center gap-4 bg-amber-500/8 border border-amber-500/25 rounded-md px-4 py-3">
                <UserCheck className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-amber-100 text-sm">
                    <span className="font-mono text-amber-300">{sg.unknownSpeaker.name}</span>
                    <span className="text-zinc-400"> might be </span>
                    <span className="text-white font-medium">{sg.suggestedSpeaker.name}</span>
                    <span className="text-zinc-500 font-mono"> ({pct}%)</span>
                  </p>
                </div>
                <button onClick={() => handleAcceptSuggestion(sg)} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs rounded transition-colors">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                  Confirm
                </button>
                <button onClick={() => handleRejectSuggestion(sg)} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 text-zinc-200 text-xs rounded transition-colors">
                  <X className="w-3.5 h-3.5" />
                  Different
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main player */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
            {/* Action buttons */}
            <div className="flex gap-2 mb-5 flex-wrap">
              <Link to={`/waveform/${id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded transition-colors">
                <Waves className="w-3.5 h-3.5" />Waveform
              </Link>
              <Link to={`/transcript/${id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded transition-colors">
                <FileText className="w-3.5 h-3.5" />Transcript
              </Link>
              <Link to="/network"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors">
                <Network className="w-3.5 h-3.5" />Network
              </Link>
            </div>

            {/* Timeline */}
            {duration > 0 && (
              <div className="mb-5">
                <div className="bg-black border border-zinc-900 rounded h-16 relative overflow-hidden">
                  {segments.map(seg => {
                    const left = (seg.startTime / duration) * 100;
                    const width = ((seg.endTime - seg.startTime) / duration) * 100;
                    return (
                      <div key={seg.id} className="absolute top-2 bottom-2 rounded-sm cursor-pointer hover:opacity-75 transition-opacity"
                        style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%`, backgroundColor: seg.speakerColor }}
                        onClick={() => { if (audioRef.current) audioRef.current.currentTime = seg.startTime; setCurrentTime(seg.startTime); }}
                        title={`${seg.speakerName}: ${seg.text}`}
                      />
                    );
                  })}
                  <div className="absolute top-0 bottom-0 w-px bg-white z-10"
                    style={{ left: `${(currentTime / duration) * 100}%` }} />
                </div>
                <div className="flex justify-between text-zinc-600 text-xs font-mono mt-1">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            )}

            <audio ref={audioRef} src={audios.fileUrl(audioId)}
              onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
              onEnded={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />

            {/* Controls */}
            <div className="flex items-center gap-4">
              <button onClick={() => setIsPlaying(p => !p)}
                className="w-9 h-9 bg-blue-600 hover:bg-blue-500 text-white rounded-md flex items-center justify-center transition-colors shrink-0">
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <div className="flex items-center gap-2 flex-1">
                <Volume2 className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                <input type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="flex-1 accent-blue-500" />
              </div>
              {currentSegment && (
                <span className="text-zinc-400 text-xs font-mono shrink-0">{currentSegment.speakerName}</span>
              )}
            </div>

            {currentSegment && (
              <div className="mt-4 p-3 bg-black border border-zinc-900 rounded">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: currentSegment.speakerColor }} />
                  <span className="text-white text-sm font-medium">{currentSegment.speakerName}</span>
                  <span className="text-zinc-600 text-xs font-mono">
                    [{formatTime(currentSegment.startTime)}–{formatTime(currentSegment.endTime)}]
                  </span>
                </div>
                <p className="text-zinc-300 text-sm">{currentSegment.text}</p>
              </div>
            )}
          </div>

          {/* Segments */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Speaker Segments</span>
              {segments.length > 0 && (
                splitMode ? (
                  <button onClick={exitSplitMode}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded transition-colors">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                ) : (
                  <button onClick={() => setSplitMode(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded transition-colors">
                    <Scissors className="w-3.5 h-3.5" /> Split Speaker
                  </button>
                )
              )}
            </div>

            {splitMode && (
              <div className="px-5 py-2.5 bg-amber-500/5 border-b border-amber-500/20">
                <p className="text-amber-300/80 text-xs">Select segments belonging to a different person. Only segments from the same source speaker can be added.</p>
              </div>
            )}

            {segments.length === 0 ? (
              <p className="text-zinc-600 text-sm px-5 py-6">No segments found.</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {segments.map((seg) => {
                  const isActive = currentSegment?.id === seg.id;
                  const isSelected = selectedSegmentIds.has(seg.id);
                  const lockedToOther = splitMode && splitSourceSpeakerId !== null && splitSourceSpeakerId !== seg.speakerId;
                  return (
                    <div key={seg.id}
                      onClick={() => {
                        if (splitMode) { if (!lockedToOther) toggleSegmentForSplit(seg.id, seg.speakerId); return; }
                        if (audioRef.current) audioRef.current.currentTime = seg.startTime;
                        setCurrentTime(seg.startTime);
                      }}
                      className={`px-5 py-3 transition-colors ${lockedToOther ? 'opacity-35 cursor-not-allowed' : 'cursor-pointer'} ${
                        isSelected ? 'bg-amber-500/10 border-l-2 border-l-amber-500'
                        : isActive ? 'bg-blue-500/8 border-l-2 border-l-blue-500'
                        : 'hover:bg-zinc-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 mb-1">
                        {splitMode && (
                          <input type="checkbox" checked={isSelected} disabled={lockedToOther}
                            onChange={() => toggleSegmentForSplit(seg.id, seg.speakerId)}
                            onClick={e => e.stopPropagation()}
                            className="w-3.5 h-3.5 accent-amber-500" />
                        )}
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.speakerColor }} />
                        <span className="text-white text-sm font-medium">{seg.speakerName}</span>
                        <span className="text-zinc-600 text-xs font-mono ml-auto">
                          {formatTime(seg.startTime)}–{formatTime(seg.endTime)}
                        </span>
                      </div>
                      <p className="text-zinc-400 text-sm leading-relaxed">{seg.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Speakers */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Speakers</span>
            </div>
            {speakers.length === 0 ? (
              <p className="text-zinc-600 text-sm px-5 py-4">None identified.</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {speakers.map((spk) => {
                  const spkSegs = segments.filter(s => s.speakerId === spk.id);
                  const totalTime = spkSegs.reduce((acc, s) => acc + (s.endTime - s.startTime), 0);
                  return (
                    <div key={spk.id} className="px-5 py-3 flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: spk.color }} />
                      <div className="flex-1 min-w-0">
                        <Link to={`/speaker/${spk.id}`} className="text-white text-sm hover:text-blue-400 transition-colors truncate block">
                          {spk.name}
                        </Link>
                        <div className="text-zinc-600 text-xs font-mono">{spkSegs.length} seg · {formatTime(totalTime)}</div>
                      </div>
                      <button onClick={() => { setReassignTarget(spk); setReassignName(''); }}
                        className="text-zinc-700 hover:text-red-400 transition-colors p-1 shrink-0">
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Alerts */}
          {audioAlerts.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-md">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Alerts</span>
                <span className="ml-auto text-zinc-600 text-xs font-mono">{audioAlerts.length}</span>
              </div>
              <div className="divide-y divide-zinc-800">
                {audioAlerts.map(alert => {
                  const clr = alert.type === 'high' ? 'border-l-red-500 bg-red-500/5' : alert.type === 'medium' ? 'border-l-amber-500 bg-amber-500/5' : 'border-l-blue-500 bg-blue-500/5';
                  const txtClr = alert.type === 'high' ? 'text-red-400' : alert.type === 'medium' ? 'text-amber-400' : 'text-blue-400';
                  return (
                    <div key={alert.id} className={`px-4 py-3 border-l-2 ${clr}`}>
                      <div className={`text-[10px] font-mono uppercase tracking-wider mb-1 ${txtClr}`}>{alert.type}</div>
                      <p className="text-zinc-300 text-xs leading-relaxed">{alert.message}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">File Metadata</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              {[
                { label: 'Uploaded', value: new Date(audio.uploadedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
                { label: 'Duration', value: formatTime(duration) },
                { label: 'Size', value: audio.fileSize > 0 ? (audio.fileSize / (1024 * 1024)).toFixed(1) + ' MB' : '—' },
                { label: 'By', value: audio.uploadedBy || '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-zinc-600 text-xs uppercase tracking-wider">{label}</span>
                  <span className="text-zinc-300 text-xs font-mono">{value}</span>
                </div>
              ))}
              {audio.description && (
                <div className="pt-2 border-t border-zinc-800">
                  <p className="text-zinc-500 text-xs">{audio.description}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating split action bar */}
      {splitMode && selectedSegmentIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-zinc-950 border border-amber-500/40 rounded-md shadow-2xl flex items-center gap-3 px-5 py-3">
          <Scissors className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-white text-sm">
            <span className="font-mono">{selectedSegmentIds.size}</span> segment{selectedSegmentIds.size === 1 ? '' : 's'} selected
          </span>
          <button onClick={() => { setSplitNewName(''); setSplitError(''); setSplitModalOpen(true); }}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded transition-colors">
            Split into new speaker
          </button>
        </div>
      )}

      {/* Split modal */}
      {splitModalOpen && (
        <div className={modalCls}>
          <div className={modalCard}>
            <div className="p-5 border-b border-zinc-800">
              <h2 className="text-white font-semibold">Split selected segments</h2>
              <p className="text-zinc-500 text-xs mt-1">
                {selectedSegmentIds.size} segment{selectedSegmentIds.size !== 1 ? 's' : ''} will be reassigned. Voice samples re-extracted from the selected audio.
              </p>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest block mb-1.5">New Speaker Name (optional)</label>
                <input type="text" value={splitNewName} onChange={e => setSplitNewName(e.target.value)}
                  placeholder="Leave blank to auto-name"
                  className="w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm placeholder-zinc-700 focus:outline-none focus:border-amber-500 transition-all font-mono"
                  autoFocus onKeyDown={e => e.key === 'Enter' && handleSplitConfirm()} />
              </div>
              {splitError && (
                <div className="bg-red-500/8 border border-red-500/25 rounded px-3 py-2 text-red-400 text-xs">{splitError}</div>
              )}
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end gap-2">
              <button onClick={() => setSplitModalOpen(false)} disabled={splitting}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded transition-colors">Cancel</button>
              <button onClick={handleSplitConfirm} disabled={splitting}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm rounded flex items-center gap-2 transition-colors">
                {splitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
                Split
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reassign modal */}
      {reassignTarget && (
        <div className={modalCls}>
          <div className={modalCard}>
            <div className="p-5 border-b border-zinc-800">
              <h2 className="text-white font-semibold">Wrong identification?</h2>
              <p className="text-zinc-500 text-xs mt-1">
                System identified this as <span className="text-zinc-300 font-mono">{reassignTarget.name}</span>. Enter the correct name — existing profiles will be merged.
              </p>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Name</label>
                <input type="text" value={reassignName} onChange={e => setReassignName(e.target.value)}
                  placeholder="e.g. Ofir, Unknown Person…"
                  className="w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm placeholder-zinc-700 focus:outline-none focus:border-blue-500 transition-all font-mono"
                  autoFocus onKeyDown={e => e.key === 'Enter' && handleReassign(false)}
                  list="known-speaker-names" />
                <datalist id="known-speaker-names">
                  {knownSpeakers.filter(s => s.id !== reassignTarget.id).map(s => <option key={s.id} value={s.name} />)}
                </datalist>
                {reassignMatch && (
                  <div className="mt-2.5 flex items-start gap-2 bg-blue-500/8 border border-blue-500/25 rounded px-3 py-2 text-blue-200 text-xs">
                    <Merge className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Will merge into <span className="font-mono text-blue-300">{reassignMatch.name}</span>{reassignMatch.recordingCount > 0 ? ` (${reassignMatch.recordingCount} recordings)` : ''}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-zinc-800 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button onClick={() => { setReassignTarget(null); setReassignName(''); }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded transition-colors">Cancel</button>
              {reassignMatch && (
                <button onClick={() => handleReassign(true)} disabled={reassigning}
                  className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm rounded transition-colors">
                  No, different person
                </button>
              )}
              <button onClick={() => handleReassign(false)} disabled={reassigning}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded flex items-center gap-2 justify-center transition-colors">
                {reassigning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {reassignMatch ? 'Merge into existing' : 'Save as new person'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
