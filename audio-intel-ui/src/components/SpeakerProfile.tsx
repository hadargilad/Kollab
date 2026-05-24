import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { User, FileAudio, Calendar, Link2, Loader2, AlertCircle, Pencil, Check, X, Merge, Trash2, PlayCircle, Clock, ArrowLeft, Sparkles, ExternalLink, Camera, EyeOff, Eye, Wand2 } from 'lucide-react';
import { speakers, relations, type SpeakerRecord, type RelationRecord, type SpeakerAudioRecord, type MatchSuggestion } from '../lib/api';
import SpeakerAvatar from './SpeakerAvatar';

const RISK_COLORS = {
  low:    { bg: 'bg-emerald-500/8',  text: 'text-emerald-400',  border: 'border-emerald-500/25' },
  medium: { bg: 'bg-amber-500/8',    text: 'text-amber-400',    border: 'border-amber-500/25' },
  high:   { bg: 'bg-red-500/8',      text: 'text-red-400',      border: 'border-red-500/25' },
};

export default function SpeakerProfile() {
  const { id } = useParams<{ id: string }>();
  const speakerId = Number(id);
  const navigate = useNavigate();

  const [speaker, setSpeaker] = useState<SpeakerRecord | null>(null);
  const [connections, setConnections] = useState<RelationRecord[]>([]);
  const [recordings, setRecordings] = useState<SpeakerAudioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const recordingsRef = useRef<HTMLDivElement | null>(null);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editRisk, setEditRisk] = useState<'low' | 'medium' | 'high'>('low');
  const [saving, setSaving] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<{ targetName: string } | null>(null);
  const [mergeBanner, setMergeBanner] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageBust, setImageBust] = useState<number>(0);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageUpload = async (file: File) => {
    setImageError(null);
    setUploadingImage(true);
    try {
      const res = await speakers.uploadImage(speakerId, file);
      setSpeaker(prev => prev ? { ...prev, imagePath: res.imagePath } : prev);
      setImageBust(Date.now());
    } catch (e: any) {
      setImageError(e.message ?? 'Upload failed.');
    } finally {
      setUploadingImage(false);
    }
  };

  const [trackingBusy, setTrackingBusy] = useState(false);
  const toggleUntracked = async () => {
    if (!speaker) return;
    setTrackingBusy(true);
    try {
      const updated = await speakers.setUntracked(speakerId, !speaker.isUntracked);
      setSpeaker(updated);
    } catch (e: any) {
      alert(e.message ?? 'Failed to update tracking.');
    } finally {
      setTrackingBusy(false);
    }
  };

  const handleImageDelete = async () => {
    setImageError(null);
    setUploadingImage(true);
    try {
      await speakers.deleteImage(speakerId);
      setSpeaker(prev => prev ? { ...prev, imagePath: null } : prev);
      setImageBust(Date.now());
    } catch (e: any) {
      setImageError(e.message ?? 'Remove failed.');
    } finally {
      setUploadingImage(false);
    }
  };

  useEffect(() => {
    if (!speakerId) return;
    setLoading(true);
    setError('');
    Promise.all([speakers.get(speakerId), relations.list(), speakers.audios(speakerId)])
      .then(([spk, rels, audios]) => {
        setSpeaker(spk);
        setEditName(spk.name);
        setEditRisk(spk.riskLevel);
        setConnections(rels.filter(r => r.speakerA.id === speakerId || r.speakerB.id === speakerId));
        setRecordings(audios);
      })
      .catch(() => setError('Failed to load speaker profile.'))
      .finally(() => setLoading(false));
  }, [speakerId]);

  const formatDuration = (seconds: number) => {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const isAutoNamed = (name: string) => /^Speaker \d+$/i.test(name.trim());

  const startEdit = () => {
    if (!speaker) return;
    setEditName(speaker.name);
    setEditRisk(speaker.riskLevel);
    setEditing(true);
    // Only mine voice-match suggestions for unrecognized speakers — for a
    // named speaker like "Lewis Hamilton", a 40% match to someone else is noise.
    if (isAutoNamed(speaker.name)) {
      setSuggestionsLoading(true);
      speakers.matchSuggestions(speakerId, 5)
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
        .finally(() => setSuggestionsLoading(false));
    } else {
      setSuggestions([]);
      setSuggestionsLoading(false);
    }
  };

  const cancelEdit = () => { setEditing(false); setPendingMerge(null); setSuggestions([]); };

  const acceptSuggestion = async (s: MatchSuggestion) => {
    if (!speaker) return;
    // Trigger the same merge path the rename uses; backend auto-merges on name collision.
    setEditName(s.name);
    setSaving(true);
    setPendingMerge(null);
    try {
      const result = await speakers.update(speakerId, s.name, editRisk, false);
      if (result.merged && result.mergedIntoId) {
        navigate(`/speaker/${result.mergedIntoId}`, {
          state: { mergedFrom: speaker.name, into: result.mergedIntoName ?? s.name },
          replace: true,
        });
        return;
      }
      setSpeaker({ ...speaker, name: s.name, riskLevel: editRisk });
      setEditing(false);
      setSuggestions([]);
    } catch { /* leave editing open */ }
    finally { setSaving(false); }
  };

  const performDelete = async () => {
    if (!speaker) return;
    setDeleting(true);
    try {
      await speakers.remove(speakerId);
      navigate('/profile-search', { replace: true });
    } catch { setDeleting(false); }
  };

  const performSave = async (forceSeparate = false) => {
    if (!speaker) return;
    const trimmedName = editName.trim() || speaker.name;
    setSaving(true);
    setPendingMerge(null);
    try {
      const result = await speakers.update(speakerId, trimmedName, editRisk, forceSeparate);
      if (result.merged && result.mergedIntoId) {
        navigate(`/speaker/${result.mergedIntoId}`, {
          state: { mergedFrom: speaker.name, into: result.mergedIntoName ?? trimmedName },
          replace: true,
        });
        return;
      }
      setSpeaker({ ...speaker, name: trimmedName, riskLevel: editRisk });
      setEditing(false);
    } catch { /* keep editing open on failure */ } finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!speaker) return;
    const trimmedName = editName.trim() || speaker.name;
    if (trimmedName.toLowerCase() !== speaker.name.toLowerCase()) {
      try {
        const all = await speakers.list();
        const existing = all.find(s => s.id !== speakerId && s.name.trim().toLowerCase() === trimmedName.toLowerCase());
        if (existing) { setPendingMerge({ targetName: existing.name }); return; }
      } catch { /* fall through */ }
    }
    await performSave();
  };

  useEffect(() => {
    const state = (window.history.state && (window.history.state as { usr?: { mergedFrom?: string; into?: string } }).usr) || null;
    if (state?.mergedFrom && state?.into) {
      setMergeBanner(`Merged "${state.mergedFrom}" into "${state.into}".`);
      window.history.replaceState({ ...window.history.state, usr: null }, '');
      const t = setTimeout(() => setMergeBanner(null), 6000);
      return () => clearTimeout(t);
    }
  }, [speakerId]);

  const timeAgo = (dateString: string) => {
    const days = Math.floor((Date.now() - new Date(dateString).getTime()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
    </div>
  );

  if (error || !speaker) return (
    <div className="p-6">
      <div className="bg-red-500/5 border border-red-500/20 rounded-md p-6 text-center">
        <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-red-400 text-sm">{error || 'Speaker not found.'}</p>
      </div>
    </div>
  );

  const risk = RISK_COLORS[speaker.riskLevel];
  const modalCls = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4';
  const modalCard = 'bg-zinc-950 border border-zinc-800 rounded-md w-full shadow-2xl';

  return (
    <div className="p-6 space-y-5">
      <div>
        <button onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-zinc-100 text-sm mb-3 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Intelligence</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Speaker Profile</h1>
        <p className="text-zinc-300 text-sm mt-0.5">Voice identity and connection information</p>
      </div>

      {mergeBanner && (
        <div className="flex items-center gap-2.5 bg-blue-500/8 border border-blue-500/25 rounded-md px-4 py-3">
          <Merge className="w-4 h-4 text-blue-400 shrink-0" />
          <p className="text-blue-300 text-sm">{mergeBanner}</p>
        </div>
      )}

      {confirmDelete && (
        <div className={modalCls}>
          <div className={modalCard + ' max-w-md'}>
            <div className="p-5 border-b border-zinc-800">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-red-500/10 border border-red-500/25 rounded flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </div>
                <h2 className="text-white font-semibold">Delete speaker?</h2>
              </div>
              <p className="text-zinc-200 text-sm">
                This permanently removes <span className="text-white font-medium">{speaker.name}</span>,
                their {connections.length} connection{connections.length !== 1 ? 's' : ''} and voice samples.
                The {speaker.recordingCount} recording{speaker.recordingCount !== 1 ? 's' : ''} will keep their transcripts but those segments become unlabelled.
              </p>
            </div>
            <div className="p-5 flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(false)} disabled={deleting}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded transition-colors">
                Cancel
              </button>
              <button onClick={performDelete} disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded transition-colors">
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingMerge && (
        <div className={modalCls}>
          <div className={modalCard + ' max-w-md'}>
            <div className="p-5 border-b border-zinc-800">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-blue-500/10 border border-blue-500/25 rounded flex items-center justify-center">
                  <Merge className="w-4 h-4 text-blue-400" />
                </div>
                <h2 className="text-white font-semibold">Same person?</h2>
              </div>
              <p className="text-zinc-200 text-sm">
                Another profile named <span className="text-white font-medium">{pendingMerge.targetName}</span> already exists.
                Merging combines their recordings, connections, and voice samples and improves the voice print.
                If this is a different person who happens to share the name, save them as a separate profile instead.
              </p>
            </div>
            <div className="p-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button onClick={() => setPendingMerge(null)} disabled={saving}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded transition-colors">
                Cancel
              </button>
              <button onClick={() => performSave(true)} disabled={saving}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm rounded transition-colors">
                Save as separate person
              </button>
              <button onClick={() => performSave(false)} disabled={saving}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded transition-colors">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Yes, merge profiles
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-4">
                <div className="relative group shrink-0">
                  <SpeakerAvatar
                    speakerId={speaker.id}
                    name={speaker.name}
                    color={speaker.color}
                    imagePath={speaker.imagePath}
                    size={64}
                    bust={imageBust}
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={uploadingImage}
                    title={speaker.imagePath ? 'Change photo' : 'Upload photo'}
                    className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600 disabled:opacity-50 flex items-center justify-center transition-colors"
                  >
                    {uploadingImage
                      ? <Loader2 className="w-3.5 h-3.5 text-zinc-300 animate-spin" />
                      : <Camera className="w-3.5 h-3.5 text-zinc-300" />}
                  </button>
                  {speaker.imagePath && !uploadingImage && (
                    <button
                      type="button"
                      onClick={handleImageDelete}
                      title="Remove photo"
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-zinc-900 border border-zinc-700 hover:bg-red-500/15 hover:border-red-500/40 hover:text-red-400 text-zinc-200 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImageUpload(f);
                      e.target.value = '';
                    }}
                  />
                </div>
                <div>
                  {editing ? (
                    <div className="space-y-2">
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                        className="bg-black border border-zinc-700 rounded px-3 py-1.5 text-white text-lg font-bold focus:outline-none focus:border-blue-500 transition-all w-52" />
                      <div className="flex gap-1.5">
                        {(['low', 'medium', 'high'] as const).map(r => (
                          <button key={r} onClick={() => setEditRisk(r)}
                            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase border transition-colors ${
                              editRisk === r ? `${RISK_COLORS[r].bg} ${RISK_COLORS[r].text} ${RISK_COLORS[r].border}` : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                            }`}>
                            {r}
                          </button>
                        ))}
                      </div>
                      {(suggestionsLoading || suggestions.length > 0) && (
                        <div className="mt-3 max-w-md">
                          <div className="flex items-center gap-1.5 text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1.5">
                            <Wand2 className="w-3 h-3 text-blue-300" />
                            Likely matches from voice
                          </div>
                          {suggestionsLoading ? (
                            <div className="flex items-center gap-2 text-zinc-300 text-xs"><Loader2 className="w-3 h-3 animate-spin" /> Scanning…</div>
                          ) : (
                            <div className="space-y-1">
                              {suggestions.filter(s => s.confidence >= 0.2).map(s => (
                                <button
                                  key={s.id}
                                  onClick={() => acceptSuggestion(s)}
                                  disabled={saving}
                                  className="flex w-full items-center gap-2.5 px-2 py-1.5 bg-black hover:bg-zinc-800 border border-zinc-800 hover:border-blue-500/40 disabled:opacity-50 rounded transition-colors text-left"
                                >
                                  <SpeakerAvatar speakerId={s.id} name={s.name} color={s.color} imagePath={s.imagePath} size={24} />
                                  <span className="text-zinc-200 text-sm flex-1 truncate">{s.name}</span>
                                  <span className="text-blue-300 text-[11px] font-mono">
                                    {Math.round(s.confidence * 100)}%
                                  </span>
                                </button>
                              ))}
                              {suggestions.filter(s => s.confidence >= 0.2).length === 0 && (
                                <div className="text-zinc-300 text-[11px] font-mono italic">
                                  No confident matches in shared recordings.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-white text-xl font-bold">{speaker.name}</h2>
                        {speaker.isUntracked && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase border border-zinc-700 bg-zinc-800/50 text-zinc-200" title="Untracked — hidden from connection graph">
                            <EyeOff className="w-3 h-3" /> Untracked
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-200 text-xs font-mono mb-2">{speaker.voiceIdentifier}</p>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${risk.bg} ${risk.text} ${risk.border}`}>
                        {speaker.riskLevel} risk
                      </span>
                      {imageError && (
                        <p className="mt-2 text-red-400 text-xs">{imageError}</p>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {editing ? (
                  <>
                    <button onClick={saveEdit} disabled={saving}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded transition-colors">
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
                    </button>
                    <button onClick={cancelEdit}
                      className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded transition-colors">
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={startEdit}
                      className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded transition-colors">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button onClick={toggleUntracked} disabled={trackingBusy}
                      title={speaker.isUntracked ? 'Re-track in connection graph' : 'Hide from connection graph (e.g. interviewer or guest)'}
                      className={`flex items-center gap-1 px-3 py-1.5 border text-sm rounded transition-colors ${
                        speaker.isUntracked
                          ? 'bg-blue-600/20 hover:bg-blue-600/30 border-blue-500/40 text-blue-200'
                          : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300'
                      } disabled:opacity-50`}>
                      {trackingBusy
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : speaker.isUntracked
                          ? <><Eye className="w-3.5 h-3.5" /> Track</>
                          : <><EyeOff className="w-3.5 h-3.5" /> Untrack</>}
                    </button>
                    <button onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-red-500/10 border border-zinc-700 text-zinc-300 hover:text-red-400 text-sm rounded transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <Link to="/identity"
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors">
                  Match Identity
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button type="button" onClick={() => recordingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                disabled={recordings.length === 0}
                className="p-3 bg-black border border-zinc-900 rounded text-left transition-colors enabled:hover:border-zinc-700 disabled:cursor-default">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <FileAudio className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-zinc-200 text-[10px] font-mono uppercase tracking-wider">Recordings</span>
                </div>
                <div className="text-white text-xl font-bold font-mono">{recordings.length}</div>
              </button>
              <div className="p-3 bg-black border border-zinc-900 rounded">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Link2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-zinc-200 text-[10px] font-mono uppercase tracking-wider">Connections</span>
                </div>
                <div className="text-white text-xl font-bold font-mono">{connections.length}</div>
              </div>
              <div className="p-3 bg-black border border-zinc-900 rounded">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Calendar className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-zinc-200 text-[10px] font-mono uppercase tracking-wider">First Seen</span>
                </div>
                <div className="text-zinc-300 text-sm font-mono">{timeAgo(speaker.firstDetected)}</div>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
              <Link2 className="w-4 h-4 text-zinc-200" />
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Known Connections</span>
            </div>
            {connections.length === 0 ? (
              <div className="text-center py-10">
                <Link2 className="w-8 h-8 text-zinc-800 mx-auto mb-2" />
                <p className="text-zinc-200 text-sm">No connections recorded yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {connections.map((rel) => {
                  const other = rel.speakerA.id === speakerId ? rel.speakerB : rel.speakerA;
                  return (
                    <Link key={rel.id} to={`/speaker/${other.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-zinc-800/40 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${other.color}18` }}>
                          <User className="w-3.5 h-3.5" style={{ color: other.color }} />
                        </div>
                        <div>
                          <div className="text-white text-sm">{other.name}</div>
                          {rel.topic && <div className="text-zinc-200 text-xs font-mono">{rel.topic}</div>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-zinc-200 text-xs font-mono">{rel.interactionCount} interactions</div>
                        <div className="text-zinc-200 text-xs">{timeAgo(rel.lastContact)}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div ref={recordingsRef} className="bg-zinc-900 border border-zinc-800 rounded-md scroll-mt-6">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
              <FileAudio className="w-4 h-4 text-zinc-200" />
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Recordings</span>
            </div>
            {recordings.length === 0 ? (
              <div className="text-center py-10">
                <FileAudio className="w-8 h-8 text-zinc-800 mx-auto mb-2" />
                <p className="text-zinc-200 text-sm">No recordings yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {recordings.map((rec) => (
                  <Link key={rec.id} to={`/analysis/${rec.id}`}
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-zinc-800/40 transition-colors group">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 bg-blue-500/10 border border-blue-500/20 rounded flex items-center justify-center shrink-0">
                        <FileAudio className="w-4 h-4 text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-white text-sm truncate">{rec.name}</div>
                        <div className="flex items-center gap-3 text-zinc-200 text-xs font-mono mt-0.5">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(rec.uploadedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {formatDuration(rec.speakingTime)}
                          </span>
                          <span>{rec.segmentCount} seg{rec.segmentCount !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>
                    <PlayCircle className="w-4 h-4 text-zinc-300 group-hover:text-blue-400 transition-colors shrink-0 ml-3" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Voice Fingerprint</span>
            </div>
            <div className="p-5">
              <div className="space-y-2.5 mb-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-200 uppercase tracking-wider text-[10px]">Identifier</span>
                  <span className="text-zinc-300 font-mono text-[10px] break-all text-right max-w-[140px]">{speaker.voiceIdentifier}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-200 uppercase tracking-wider text-[10px]">First Seen</span>
                  <span className="text-zinc-300 text-xs font-mono">
                    {new Date(speaker.firstDetected).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                </div>
                {speaker.wikidataId && (
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-200 uppercase tracking-wider text-[10px] flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-blue-400" /> Wikidata
                    </span>
                    <a href={`https://www.wikidata.org/wiki/${speaker.wikidataId}`} target="_blank" rel="noopener noreferrer"
                      className="text-blue-400 hover:underline font-mono text-[10px] inline-flex items-center gap-1">
                      {speaker.wikidataId}<ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                )}
              </div>
              <div className="bg-black border border-zinc-900 rounded h-16 flex items-center justify-center gap-0.5 overflow-hidden px-2">
                {Array.from({ length: 48 }).map((_, i) => {
                  const h = 20 + ((Math.sin(i * 0.7) + Math.sin(i * 1.3)) * 0.5 + 1) * 40;
                  return (
                    <div key={i} className="w-0.5 rounded-full flex-shrink-0"
                      style={{ height: `${h}%`, backgroundColor: speaker.color, opacity: 0.6 }} />
                  );
                })}
              </div>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Risk Assessment</span>
            </div>
            <div className="p-5">
              <div className={`p-3.5 rounded border ${risk.bg} ${risk.border}`}>
                <div className={`text-sm font-bold font-mono uppercase mb-1 ${risk.text}`}>{speaker.riskLevel} Risk</div>
                <p className="text-zinc-300 text-xs">
                  {speaker.riskLevel === 'high'
                    ? 'Flagged for close monitoring.'
                    : speaker.riskLevel === 'medium'
                    ? 'Warrants periodic review.'
                    : 'No elevated risk indicators.'}
                </p>
              </div>
              {!editing && (
                <button onClick={startEdit}
                  className="mt-3 w-full py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm rounded transition-colors">
                  Update Risk Level
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
