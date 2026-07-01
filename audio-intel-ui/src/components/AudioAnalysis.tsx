import { useState, useRef, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Play, Pause, Volume2, FileText, Network, Clock, Loader2, AlertCircle, RefreshCw, UserX, Merge, UserCheck, X, Scissors, EyeOff, Eye, Wand2, Search, Camera, ArrowLeft, Check } from 'lucide-react';
import { audios, speakers as speakersApi, suggestions as suggestionsApi, alerts as alertsApi, attributions as attributionsApi, type AudioRecord, type SegmentRecord, type SpeakerRecord, type SpeakerSuggestion, type AlertRecord, type MatchSuggestion, type AudioAttribution } from '../lib/api';
import SpeakerAvatar from './SpeakerAvatar';
import Loader from './Loader';

interface Speaker {
  id: number;
  name: string;
  color: string;
  imagePath?: string | null;
  isUntracked?: boolean;
}

export default function AudioAnalysis() {
  const { id } = useParams<{ id: string }>();
  const audioId = Number(id);
  const navigate = useNavigate();

  const [recSearchQuery, setRecSearchQuery] = useState('');
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
  const [showSpeakerPicker, setShowSpeakerPicker] = useState(false);
  const [knownSpeakers, setKnownSpeakers] = useState<SpeakerRecord[]>([]);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const [pendingSuggestions, setPendingSuggestions] = useState<SpeakerSuggestion[]>([]);
  const [resolvingSuggestionIds, setResolvingSuggestionIds] = useState<Set<number>>(new Set());
  const [splitMode, setSplitMode] = useState(false);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<number>>(new Set());
  const [splitSourceSpeakerId, setSplitSourceSpeakerId] = useState<number | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [audioAlerts, setAudioAlerts] = useState<AlertRecord[]>([]);
  const [trackingBusyIds, setTrackingBusyIds] = useState<Set<number>>(new Set());
  const [matchSuggestions, setMatchSuggestions] = useState<MatchSuggestion[]>([]);
  const [matchSuggestionsLoading, setMatchSuggestionsLoading] = useState(false);
  const [waveformPeaks, setWaveformPeaks] = useState<{ amp: number; color: string }[]>([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const [imageUploadBusyId, setImageUploadBusyId] = useState<number | null>(null);
  const [imageUploadTargetId, setImageUploadTargetId] = useState<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // speakerId → attribution row; used to render the "% match" badge and the
  // Confirm button on speaker cards for auto-matches in the 0.60-0.85 band.
  const [attributionMap, setAttributionMap] = useState<Map<number, AudioAttribution>>(new Map());
  const [confirmingIds, setConfirmingIds] = useState<Set<number>>(new Set());

  // Fetch ranked co-occurring matches whenever the reassign modal opens — but
  // only for unrecognized "Speaker N" speakers. For an already-named speaker,
  // surfacing 40%-similar candidates is noise.
  useEffect(() => {
    if (!reassignTarget) { setMatchSuggestions([]); return; }
    if (!/^Speaker \d+$/i.test(reassignTarget.name.trim())) {
      setMatchSuggestions([]);
      setMatchSuggestionsLoading(false);
      return;
    }
    setMatchSuggestionsLoading(true);
    speakersApi.matchSuggestions(reassignTarget.id, 5)
      .then(setMatchSuggestions)
      .catch(() => setMatchSuggestions([]))
      .finally(() => setMatchSuggestionsLoading(false));
  }, [reassignTarget]);

  const acceptReassignSuggestion = async (s: MatchSuggestion) => {
    if (!reassignTarget || !audio) return;
    setReassignName(s.name);
    setReassigning(true);
    try {
      await speakersApi.reassign(audioId, reassignTarget.id, s.name, false);
      const [newSegs, newKnown] = await Promise.all([audios.getSegments(audioId), speakersApi.list()]);
      setSegments(newSegs);
      setKnownSpeakers(newKnown);
      await refreshSuggestions();
      setReassignTarget(null);
      setReassignName('');
      setMatchSuggestions([]);
      setMergeNotice(`Reassigned as "${s.name}". Voice samples merged.`);
      setTimeout(() => setMergeNotice(null), 6000);
    } catch (e: any) {
      alert(e?.message ?? 'Reassign failed.');
    } finally {
      setReassigning(false);
    }
  };

  const toggleUntracked = async (sid: number, currentlyUntracked: boolean) => {
    setTrackingBusyIds(prev => new Set(prev).add(sid));
    try {
      const updated = await speakersApi.setUntracked(sid, !currentlyUntracked);
      setKnownSpeakers(prev => prev.map(s => (s.id === sid ? updated : s)));
    } catch (e: any) {
      alert(e.message ?? 'Failed to update tracking.');
    } finally {
      setTrackingBusyIds(prev => { const s = new Set(prev); s.delete(sid); return s; });
    }
  };

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
          attributionsApi.listForAudio(audioId)
            .then(rows => { if (!cancelled) setAttributionMap(new Map(rows.map(r => [r.speakerId, r]))); })
            .catch(() => {});
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

  const handleConfirmAttribution = async (speakerId: number) => {
    setConfirmingIds(prev => new Set(prev).add(speakerId));
    try {
      const result = await attributionsApi.confirm(audioId, speakerId);
      // Mark confirmed locally so the badge hides without waiting for a refetch.
      setAttributionMap(prev => {
        const next = new Map(prev);
        const row = next.get(speakerId);
        if (row) next.set(speakerId, { ...row, confirmed: true });
        return next;
      });
      setMergeNotice(`Match confirmed. ${result.added} voice sample${result.added === 1 ? '' : 's'} added to this speaker.`);
      setTimeout(() => setMergeNotice(null), 6000);
    } catch {
      setMergeNotice('Failed to confirm attribution.');
      setTimeout(() => setMergeNotice(null), 4000);
    } finally {
      setConfirmingIds(prev => { const s = new Set(prev); s.delete(speakerId); return s; });
    }
  };

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
    try {
      await speakersApi.split(audioId, splitSourceSpeakerId, Array.from(selectedSegmentIds));
      const [newSegs, newKnown] = await Promise.all([audios.getSegments(audioId), speakersApi.list()]);
      setSegments(newSegs);
      setKnownSpeakers(newKnown);
      await refreshSuggestions();
      exitSplitMode();
    } catch (e: any) {
      window.alert(e.message ?? 'Split failed.');
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
      const k = knownSpeakers.find(s => s.id === seg.speakerId);
      speakers.push({
        id: seg.speakerId, name: seg.speakerName, color: seg.speakerColor,
        imagePath: seg.speakerImagePath ?? null,
        isUntracked: k?.isUntracked ?? false,
      });
    }
  }

  const duration = audio?.duration ?? 0;

  // Decode audio → waveform peaks colored by speaker
  useEffect(() => {
    if (!audio || segments.length === 0) return;
    const url = audios.fileUrl(audioId);
    const NUM_BARS = 400;
    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => new AudioContext().decodeAudioData(buf))
      .then(decoded => {
        const data = decoded.getChannelData(0);
        const step = Math.floor(data.length / NUM_BARS);
        const peaks = Array.from({ length: NUM_BARS }, (_, i) => {
          let max = 0;
          for (let j = 0; j < step; j++) max = Math.max(max, Math.abs(data[i * step + j] ?? 0));
          const t = (i / NUM_BARS) * decoded.duration;
          const seg = segments.find(s => t >= s.startTime && t < s.endTime);
          return { amp: max, color: seg?.speakerColor ?? '#3f3f46' };
        });
        setWaveformPeaks(peaks);
      })
      .catch(() => {});
  }, [audio?.id, segments.length]);

  // Draw waveform canvas
  useEffect(() => {
    const canvas = waveformRef.current;
    if (!canvas || waveformPeaks.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const barW = W / waveformPeaks.length;
    const centerY = H / 2;
    waveformPeaks.forEach(({ amp, color }, i) => {
      const h = Math.max(2, amp * H * 0.9);
      ctx.fillStyle = color;
      ctx.fillRect(i * barW, centerY - h / 2, Math.max(barW - 0.5, 1), h);
    });
    // playhead
    if (duration > 0) {
      const x = (currentTime / duration) * W;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(x - 1, 0, 2, H);
    }
  }, [waveformPeaks, currentTime, duration]);

  const getCurrentSegment = () => segments.find(seg => currentTime >= seg.startTime && currentTime < seg.endTime);
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || imageUploadTargetId == null) return;
    setImageUploadBusyId(imageUploadTargetId);
    try {
      await speakersApi.uploadImage(imageUploadTargetId, file);
      const [audioData, segsData] = await Promise.all([audios.get(audioId), audios.getSegments(audioId)]);
      setAudio(audioData);
      setSegments(segsData);
    } finally {
      setImageUploadBusyId(null);
      setImageUploadTargetId(null);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const reassignTrimmed = reassignName.trim();
  const reassignMatch = reassignTrimmed
    ? knownSpeakers.find(s => s.id !== reassignTarget?.id && s.name.trim().toLowerCase() === reassignTrimmed.toLowerCase())
    : undefined;
  const pickerMatches = knownSpeakers.filter(s =>
    s.id !== reassignTarget?.id &&
    (!reassignTrimmed || s.name.toLowerCase().includes(reassignTrimmed.toLowerCase()))
  );

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

  if (loading) return <Loader />;

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

  return (<>
    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
    <div className="p-6 space-y-5">
      <button onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 text-sm transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Analysis</div>
          <h1 className="text-white text-2xl font-bold tracking-tight">{audio.name}</h1>
          <div className="flex items-center gap-4 text-zinc-300 text-xs font-mono mt-1 flex-wrap">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(duration)}</span>
            <span>{speakers.length} speaker{speakers.length !== 1 ? 's' : ''}</span>
            {audio.uploadedBy && <span>by {audio.uploadedBy}</span>}
            <span className="font-mono text-zinc-300">ID:{id}</span>
          </div>
        </div>
        <div className="w-full sm:w-72">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              value={recSearchQuery}
              onChange={e => setRecSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && recSearchQuery.trim()) {
                  navigate(`/search?q=${encodeURIComponent(recSearchQuery.trim())}&audioId=${audioId}`);
                }
              }}
              placeholder="Search this recording… (Enter)"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-md pl-9 pr-3 py-2 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-all"
            />
          </div>
        </div>
      </div>

      {isProcessing && (
        <div className="flex items-center gap-3 bg-amber-500/8 border border-amber-500/25 rounded-md px-4 py-3">
          <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
          <div>
            <p className="text-amber-200 text-sm font-medium">ML pipeline running</p>
            <p className="text-zinc-300 text-xs">Segments will appear when analysis completes.</p>
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
                    <span className="text-zinc-200"> might be </span>
                    <span className="text-white font-medium">{sg.suggestedSpeaker.name}</span>
                    <span className="text-zinc-300 font-mono"> ({pct}%)</span>
                  </p>
                </div>
                <button onClick={() => handleAcceptSuggestion(sg)} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs rounded-md transition-colors">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                  Confirm
                </button>
                <button onClick={() => handleRejectSuggestion(sg)} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 text-zinc-200 text-xs rounded-md transition-colors">
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
              <Link to={`/transcript/${id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded-md transition-colors">
                <FileText className="w-3.5 h-3.5" />Transcript
              </Link>
              <Link to="/network"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-md transition-colors">
                <Network className="w-3.5 h-3.5" />Network
              </Link>
              {segments.some(s => s.suspicionScore != null) && (
                <button
                  type="button"
                  onClick={() => setShowHeatmap(s => !s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 border text-xs rounded-md transition-colors ${
                    showHeatmap
                      ? 'bg-orange-500/15 border-orange-500/40 text-orange-300'
                      : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300'
                  }`}
                >
                  {showHeatmap ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  Coded-Language Heatmap
                </button>
              )}
            </div>

            {/* Waveform */}
            {duration > 0 && (
              <div className="mb-5">
                <div className="bg-black border border-zinc-900 rounded h-16 overflow-hidden cursor-pointer"
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    const t = ratio * duration;
                    if (audioRef.current) audioRef.current.currentTime = t;
                    setCurrentTime(t);
                  }}>
                  <canvas ref={waveformRef} width={800} height={64} className="w-full h-full" />
                </div>

                {/* Suspicion heatmap — toggled by the button in the action row */}
                {showHeatmap && segments.some(s => s.suspicionScore != null) && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest">
                        Coded-Language Heatmap
                      </span>
                      <span className="text-zinc-300 text-[10px] font-mono">
                        click to jump · {segments.filter(s => (s.suspicionScore ?? 0) > 0.65).length} flagged
                      </span>
                    </div>
                    <div className="bg-black border border-zinc-900 rounded h-4 relative overflow-hidden">
                      {segments.map(seg => {
                        const left = (seg.startTime / duration) * 100;
                        const width = ((seg.endTime - seg.startTime) / duration) * 100;
                        const score = seg.suspicionScore ?? 0;
                        let color = 'rgba(82, 82, 91, 0.35)'; // zinc fade for low scores
                        if (score > 0.80) color = 'rgba(239, 68, 68, 0.85)';   // red-500
                        else if (score > 0.65) color = 'rgba(249, 115, 22, 0.8)'; // orange-500
                        else if (score > 0.45) color = 'rgba(245, 158, 11, 0.65)'; // amber-500
                        else if (score > 0.25) color = 'rgba(132, 204, 22, 0.4)'; // lime-500
                        return (
                          <div
                            key={seg.id}
                            className="absolute top-0 bottom-0 cursor-pointer hover:ring-1 hover:ring-white/40 transition-shadow"
                            style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%`, background: color }}
                            onClick={() => {
                              if (audioRef.current) audioRef.current.currentTime = seg.startTime;
                              setCurrentTime(seg.startTime);
                            }}
                            title={`${seg.speakerName}: ${(seg.suspicionScore ?? 0).toFixed(2)} — ${seg.text.slice(0, 80)}`}
                          />
                        );
                      })}
                      <div className="absolute top-0 bottom-0 w-px bg-white z-10"
                        style={{ left: `${(currentTime / duration) * 100}%` }} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-zinc-300">
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-zinc-700" />idle</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-lime-500/50" />0.25+</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-amber-500/70" />0.45+</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-orange-500/80" />0.65+</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-500/85" />0.80+</span>
                    </div>
                  </div>
                )}

                <div className="flex justify-between text-zinc-200 text-xs font-mono mt-1">
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
                <Volume2 className="w-3.5 h-3.5 text-zinc-200 shrink-0" />
                <input type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="flex-1 accent-blue-500" />
              </div>
              {currentSegment && (
                <span className="text-zinc-200 text-xs font-mono shrink-0">{currentSegment.speakerName}</span>
              )}
            </div>

            {currentSegment && (
              <div className="mt-4 p-3 bg-black border border-zinc-900 rounded">
                <div className="flex items-center gap-2 mb-1.5">
                  <SpeakerAvatar
                    speakerId={currentSegment.speakerId}
                    name={currentSegment.speakerName}
                    color={currentSegment.speakerColor}
                    imagePath={currentSegment.speakerImagePath}
                    size={22}
                  />
                  <span className="text-white text-sm font-medium">{currentSegment.speakerName}</span>
                  <span className="text-zinc-200 text-xs font-mono">
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
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Speaker Segments</span>
              {segments.length > 0 && (
                splitMode ? (
                  <button onClick={exitSplitMode}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded-md transition-colors">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                ) : (
                  <button onClick={() => setSplitMode(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors">
                    <Scissors className="w-3.5 h-3.5" /> Split Speaker
                  </button>
                )
              )}
            </div>

            {splitMode && (
              <div className="px-5 py-2.5 bg-blue-500/5 border-b border-blue-500/20">
                <p className="text-blue-300/80 text-xs">Select segments belonging to a different person. Only segments from the same source speaker can be added.</p>
              </div>
            )}

            {segments.length === 0 ? (
              <p className="text-zinc-200 text-sm px-5 py-6">No segments found.</p>
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
                        isSelected ? 'bg-blue-500/10 border-l-2 border-l-blue-500'
                        : isActive ? 'bg-blue-500/8 border-l-2 border-l-blue-500'
                        : 'hover:bg-zinc-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 mb-1">
                        {splitMode && (
                          <input type="checkbox" checked={isSelected} disabled={lockedToOther}
                            onChange={() => toggleSegmentForSplit(seg.id, seg.speakerId)}
                            onClick={e => e.stopPropagation()}
                            className="w-3.5 h-3.5 accent-blue-500" />
                        )}
                        <SpeakerAvatar
                          speakerId={seg.speakerId}
                          name={seg.speakerName}
                          color={seg.speakerColor}
                          imagePath={seg.speakerImagePath}
                          size={22}
                        />
                        <span className="text-white text-sm font-medium">{seg.speakerName}</span>
                        <span className="text-zinc-200 text-xs font-mono ml-auto">
                          {formatTime(seg.startTime)}–{formatTime(seg.endTime)}
                        </span>
                      </div>
                      <p className="text-zinc-200 text-sm leading-relaxed">{seg.text}</p>
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
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Speakers</span>
            </div>
            {speakers.length === 0 ? (
              <p className="text-zinc-200 text-sm px-5 py-4">None identified.</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {speakers.map((spk) => {
                  const spkSegs = segments.filter(s => s.speakerId === spk.id);
                  const totalTime = spkSegs.reduce((acc, s) => acc + (s.endTime - s.startTime), 0);
                  const busy = trackingBusyIds.has(spk.id);
                  const attribution = attributionMap.get(spk.id);
                  // Badge + Confirm button appear only in the gray band: an
                  // auto-match strong enough to attribute but too weak for
                  // the matcher to feed back into the voice model on its own.
                  const showConfirmUI = attribution
                    && !attribution.confirmed
                    && attribution.confidence < 0.85;
                  const confirming = confirmingIds.has(spk.id);
                  return (
                    <div key={spk.id} className={`px-5 py-3 flex items-center gap-3 ${spk.isUntracked ? 'opacity-60' : ''}`}>
                      <SpeakerAvatar
                        speakerId={spk.id}
                        name={spk.name}
                        color={spk.color}
                        imagePath={spk.imagePath}
                        size={28}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link to={`/speaker/${spk.id}`} className="text-white text-sm hover:text-blue-400 transition-colors truncate">
                            {spk.name}
                          </Link>
                          {spk.isUntracked && (
                            <span className="text-[9px] font-mono uppercase tracking-wider px-1 py-0.5 rounded border border-zinc-700 bg-zinc-800/50 text-zinc-200" title="Hidden from connection graph">
                              <EyeOff className="w-2.5 h-2.5 inline" />
                            </span>
                          )}
                          {showConfirmUI && (
                            <span
                              className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300"
                              title="Auto-matched but not yet confirmed. The voice model won't learn from this recording until you confirm."
                            >
                              {Math.round(attribution!.confidence * 100)}% match
                            </span>
                          )}
                        </div>
                        <div className="text-zinc-200 text-xs font-mono">{spkSegs.length} seg · {formatTime(totalTime)}</div>
                      </div>
                      {showConfirmUI && (
                        <button
                          onClick={() => handleConfirmAttribution(spk.id)}
                          disabled={confirming}
                          title="Yes, that's them. Add these samples to the voice model."
                          className="text-emerald-300 hover:text-emerald-200 disabled:opacity-50 transition-colors p-1 shrink-0">
                          {confirming
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Check className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      <button
                        onClick={() => { setImageUploadTargetId(spk.id); imageInputRef.current?.click(); }}
                        disabled={imageUploadBusyId === spk.id}
                        title="Upload photo"
                        className="text-zinc-300 hover:text-blue-300 transition-colors p-1 shrink-0">
                        {imageUploadBusyId === spk.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Camera className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => toggleUntracked(spk.id, !!spk.isUntracked)}
                        disabled={busy}
                        title={spk.isUntracked ? 'Re-track this speaker' : 'Untrack (hide from graph)'}
                        className="text-zinc-300 hover:text-blue-300 transition-colors p-1 shrink-0">
                        {busy
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : spk.isUntracked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => { setReassignTarget(spk); setReassignName(''); }}
                        title="Reassign: this speaker is actually somebody else. Repoints their segments in this recording."
                        className="text-zinc-300 hover:text-red-400 transition-colors p-1 shrink-0">
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
                <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Alerts</span>
                <span className="ml-auto text-zinc-200 text-xs font-mono">{audioAlerts.length}</span>
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
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">File Metadata</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              {[
                { label: 'Uploaded', value: new Date(audio.uploadedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
                { label: 'Duration', value: formatTime(duration) },
                { label: 'Size', value: audio.fileSize > 0 ? (audio.fileSize / (1024 * 1024)).toFixed(1) + ' MB' : '-' },
                { label: 'By', value: audio.uploadedBy || '-' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200 text-xs uppercase tracking-wider">{label}</span>
                  <span className="text-zinc-300 text-xs font-mono">{value}</span>
                </div>
              ))}
              {audio.description && (
                <div className="pt-2 border-t border-zinc-800">
                  <p className="text-zinc-300 text-xs">{audio.description}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating split action bar */}
      {splitMode && selectedSegmentIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-zinc-950 border border-blue-500/40 rounded-md shadow-2xl flex items-center gap-3 px-5 py-3">
          <Scissors className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-white text-sm">
            <span className="font-mono">{selectedSegmentIds.size}</span> segment{selectedSegmentIds.size === 1 ? '' : 's'} selected
          </span>
          <button onClick={handleSplitConfirm} disabled={splitting}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs rounded flex items-center gap-1.5 transition-colors">
            {splitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
            Split into new speaker
          </button>
        </div>
      )}

      {/* Reassign modal */}
      {reassignTarget && (
        <div className={modalCls}>
          <div className={modalCard}>
            <div className="p-5 border-b border-zinc-800">
              <h2 className="text-white font-semibold">Wrong identification?</h2>
              <p className="text-zinc-300 text-xs mt-1">
                System identified this as <span className="text-zinc-300 font-mono">{reassignTarget.name}</span>. Enter the correct name — existing profiles will be merged.
              </p>
            </div>
            <div className="p-5 space-y-3">
              {(matchSuggestionsLoading || matchSuggestions.length > 0) && (
                <div>
                  <div className="flex items-center gap-1.5 text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1.5">
                    <Wand2 className="w-3 h-3 text-blue-300" />
                    Likely matches from voice
                  </div>
                  {matchSuggestionsLoading ? (
                    <div className="flex items-center gap-2 text-zinc-300 text-xs"><Loader2 className="w-3 h-3 animate-spin" /> Scanning…</div>
                  ) : (
                    <div className="space-y-1">
                      {matchSuggestions.filter(s => s.confidence >= 0.2).map(s => (
                        <button
                          key={s.id}
                          onClick={() => acceptReassignSuggestion(s)}
                          disabled={reassigning}
                          className="flex w-full items-center gap-2.5 px-2 py-1.5 bg-black hover:bg-zinc-800 border border-zinc-800 hover:border-blue-500/40 disabled:opacity-50 rounded-md transition-colors text-left"
                        >
                          <SpeakerAvatar speakerId={s.id} name={s.name} color={s.color} imagePath={s.imagePath} size={24} />
                          <span className="text-zinc-200 text-sm flex-1 truncate">{s.name}</span>
                          <span className="text-blue-300 text-[11px] font-mono">{Math.round(s.confidence * 100)}%</span>
                        </button>
                      ))}
                      {matchSuggestions.filter(s => s.confidence >= 0.2).length === 0 && (
                        <div className="text-zinc-300 text-[11px] font-mono italic">No confident matches in shared recordings.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="relative">
                <label className="text-zinc-300 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Or search your speakers</label>
                <input type="text" value={reassignName} onChange={e => setReassignName(e.target.value)}
                  placeholder="e.g. Ofir, Unknown Person…"
                  className="w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 transition-all font-mono"
                  autoFocus
                  onFocus={() => setShowSpeakerPicker(true)}
                  onBlur={() => setShowSpeakerPicker(false)}
                  onKeyDown={e => e.key === 'Enter' && handleReassign(false)} />
                {showSpeakerPicker && (
                  <div className="absolute left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-md shadow-xl z-10 max-h-48 overflow-y-auto">
                    {pickerMatches.length === 0 ? (
                      <div className="px-3 py-2 text-zinc-300 text-xs italic">No speakers found.</div>
                    ) : (
                      pickerMatches.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { setReassignName(s.name); setShowSpeakerPicker(false); }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-zinc-800 transition-colors text-left"
                        >
                          <SpeakerAvatar speakerId={s.id} name={s.name} color={s.color} imagePath={s.imagePath} size={22} />
                          <span className="text-zinc-200 text-sm flex-1 truncate">{s.name}</span>
                          {s.recordingCount > 0 && (
                            <span className="text-zinc-200 text-[10px] font-mono">{s.recordingCount} rec</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
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
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-md transition-colors">Cancel</button>
              {reassignMatch && (
                <button onClick={() => handleReassign(true)} disabled={reassigning}
                  className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm rounded-md transition-colors">
                  No, different person
                </button>
              )}
              <button onClick={() => handleReassign(false)} disabled={reassigning}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-md flex items-center gap-2 justify-center transition-colors">
                {reassigning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {reassignMatch ? 'Merge into existing' : 'Save as new person'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </>);
}
