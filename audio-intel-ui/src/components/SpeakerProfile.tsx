import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { User, FileAudio, Calendar, Link2, Loader2, AlertCircle, Pencil, Check, X, Merge, Trash2, PlayCircle, Clock, ArrowLeft, Sparkles, ExternalLink } from 'lucide-react';
import { speakers, relations, type SpeakerRecord, type RelationRecord, type SpeakerAudioRecord } from '../lib/api';

const RISK_COLORS = {
  low:    { bg: 'bg-green-600/10',  text: 'text-green-400',  border: 'border-green-600/30' },
  medium: { bg: 'bg-yellow-600/10', text: 'text-yellow-400', border: 'border-yellow-600/30' },
  high:   { bg: 'bg-red-600/10',    text: 'text-red-400',    border: 'border-red-600/30' },
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

  const scrollToRecordings = () => {
    recordingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const startEdit = () => {
    if (!speaker) return;
    setEditName(speaker.name);
    setEditRisk(speaker.riskLevel);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setPendingMerge(null);
  };

  const performDelete = async () => {
    if (!speaker) return;
    setDeleting(true);
    try {
      await speakers.remove(speakerId);
      navigate('/profile-search', { replace: true });
    } catch {
      setDeleting(false);
    }
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
    } catch {
      // keep editing open on failure
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!speaker) return;
    const trimmedName = editName.trim() || speaker.name;
    // If another speaker already has this name, ask the user to confirm the merge.
    if (trimmedName.toLowerCase() !== speaker.name.toLowerCase()) {
      try {
        const all = await speakers.list();
        const existing = all.find(
          s => s.id !== speakerId && s.name.trim().toLowerCase() === trimmedName.toLowerCase(),
        );
        if (existing) {
          setPendingMerge({ targetName: existing.name });
          return;
        }
      } catch {
        // If the lookup fails, fall through and let the backend decide.
      }
    }
    await performSave();
  };

  // Show a one-shot banner if we just landed here from a merge redirect.
  useEffect(() => {
    const state = (window.history.state && (window.history.state as { usr?: { mergedFrom?: string; into?: string } }).usr) || null;
    if (state?.mergedFrom && state?.into) {
      setMergeBanner(`Merged "${state.mergedFrom}" into "${state.into}". Their recordings and connections now live here.`);
      window.history.replaceState({ ...window.history.state, usr: null }, '');
      const t = setTimeout(() => setMergeBanner(null), 6000);
      return () => clearTimeout(t);
    }
  }, [speakerId]);

  const timeAgo = (dateString: string) => {
    const diff = Date.now() - new Date(dateString).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) !== 1 ? 's' : ''} ago`;
    return `${Math.floor(days / 30)} month${Math.floor(days / 30) !== 1 ? 's' : ''} ago`;
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
    </div>
  );

  if (error || !speaker) return (
    <div className="p-8">
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-400">{error || 'Speaker not found.'}</p>
      </div>
    </div>
  );

  const risk = RISK_COLORS[speaker.riskLevel];

  return (
    <div className="p-8">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Speaker Profile</h1>
        <p className="text-slate-400">Voice identity and connection information</p>
      </div>

      {mergeBanner && (
        <div className="mb-6 flex items-center gap-3 bg-blue-500/10 border border-blue-500/30 rounded-lg px-5 py-4">
          <Merge className="w-5 h-5 text-blue-400 shrink-0" />
          <p className="text-blue-200 text-sm">{mergeBanner}</p>
        </div>
      )}

      {confirmDelete && speaker && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg w-full max-w-md">
            <div className="p-6 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="bg-red-600/20 p-2 rounded-lg">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <h2 className="text-white text-lg">Delete speaker?</h2>
              </div>
              <p className="text-slate-400 text-sm mt-3">
                This permanently removes <span className="text-white font-medium">{speaker.name}</span>,
                their {connections.length} connection{connections.length !== 1 ? 's' : ''} and their voice samples
                from the recogniser. The {speaker.recordingCount} audio recording{speaker.recordingCount !== 1 ? 's' : ''} they
                appear in will keep their transcripts, but those segments will become unlabelled.
              </p>
            </div>
            <div className="p-6 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={performDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingMerge && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg w-full max-w-md">
            <div className="p-6 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="bg-blue-600/20 p-2 rounded-lg">
                  <Merge className="w-5 h-5 text-blue-400" />
                </div>
                <h2 className="text-white text-lg">Same person?</h2>
              </div>
              <p className="text-slate-400 text-sm mt-3">
                Another profile named <span className="text-white font-medium">{pendingMerge.targetName}</span> already exists.
                Merging combines their recordings, connections, and voice samples and improves the voice print.
                If this is a different person who happens to share the name, save them as a separate profile instead.
              </p>
            </div>
            <div className="p-6 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
              <button
                onClick={() => setPendingMerge(null)}
                disabled={saving}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => performSave(true)}
                disabled={saving}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                No, save as separate person
              </button>
              <button
                onClick={() => performSave(false)}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2 justify-center"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Yes, merge profiles
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main profile */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${speaker.color}20` }}
                >
                  <User className="w-8 h-8" style={{ color: speaker.color }} />
                </div>

                <div>
                  {editing ? (
                    <div className="space-y-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        {(['low', 'medium', 'high'] as const).map(r => (
                          <button
                            key={r}
                            onClick={() => setEditRisk(r)}
                            className={`px-3 py-1 rounded-full text-xs capitalize border transition-colors ${
                              editRisk === r
                                ? `${RISK_COLORS[r].bg} ${RISK_COLORS[r].text} ${RISK_COLORS[r].border}`
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 className="text-white text-2xl mb-1">{speaker.name}</h2>
                      <p className="text-slate-500 text-sm font-mono mb-2">{speaker.voiceIdentifier}</p>
                      <span className={`px-3 py-1 rounded-full text-xs capitalize border ${risk.bg} ${risk.text} ${risk.border}`}>
                        {speaker.riskLevel} risk
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                {editing ? (
                  <>
                    <button
                      onClick={saveEdit}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={startEdit}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm border border-slate-700 transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmDelete(true)}
                      title="Delete speaker"
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-red-600/20 text-slate-400 hover:text-red-400 rounded-lg text-sm border border-slate-700 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </>
                )}
                <Link
                  to="/identity"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
                >
                  Match Identity
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <button
                type="button"
                onClick={scrollToRecordings}
                disabled={recordings.length === 0}
                className="p-4 bg-slate-800 rounded-lg text-left transition-colors enabled:hover:bg-slate-700 enabled:hover:ring-1 enabled:hover:ring-blue-500/50 disabled:cursor-default"
              >
                <div className="flex items-center gap-2 mb-2">
                  <FileAudio className="w-4 h-4 text-blue-500" />
                  <span className="text-slate-400 text-sm">Recordings</span>
                </div>
                <div className="text-white text-xl">{recordings.length}</div>
              </button>
              <div className="p-4 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Link2 className="w-4 h-4 text-cyan-500" />
                  <span className="text-slate-400 text-sm">Connections</span>
                </div>
                <div className="text-white text-xl">{connections.length}</div>
              </div>
              <div className="p-4 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-purple-500" />
                  <span className="text-slate-400 text-sm">First Detected</span>
                </div>
                <div className="text-white text-sm">{timeAgo(speaker.firstDetected)}</div>
              </div>
            </div>
          </div>

          {/* Connections */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Known Connections</h3>
            {connections.length === 0 ? (
              <div className="text-center py-8">
                <Link2 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">No connections recorded yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {connections.map((rel) => {
                  const other = rel.speakerA.id === speakerId ? rel.speakerB : rel.speakerA;
                  return (
                    <Link
                      key={rel.id}
                      to={`/speaker/${other.id}`}
                      className="flex items-center justify-between p-4 bg-slate-800 border border-slate-700 rounded-lg hover:border-slate-600 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${other.color}20` }}>
                          <User className="w-4 h-4" style={{ color: other.color }} />
                        </div>
                        <div>
                          <div className="text-white text-sm">{other.name}</div>
                          {rel.topic && <div className="text-slate-500 text-xs">{rel.topic}</div>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-slate-300 text-sm">{rel.interactionCount} interaction{rel.interactionCount !== 1 ? 's' : ''}</div>
                        <div className="text-slate-500 text-xs">{timeAgo(rel.lastContact)}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recordings */}
          <div ref={recordingsRef} className="bg-slate-900 border border-slate-800 rounded-lg p-6 scroll-mt-6">
            <h3 className="text-white mb-4">Recordings featuring this speaker</h3>
            {recordings.length === 0 ? (
              <div className="text-center py-8">
                <FileAudio className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">This speaker hasn't been heard in any recording yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recordings.map((rec) => (
                  <Link
                    key={rec.id}
                    to={`/analysis/${rec.id}`}
                    className="flex items-center justify-between p-4 bg-slate-800 border border-slate-700 rounded-lg hover:border-blue-500/50 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="bg-blue-600/20 p-2 rounded-lg shrink-0">
                        <FileAudio className="w-4 h-4 text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-white text-sm truncate">{rec.name}</div>
                        <div className="text-slate-500 text-xs flex items-center gap-3 mt-0.5">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(rec.uploadedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Spoke {formatDuration(rec.speakingTime)}
                          </span>
                          <span>{rec.segmentCount} segment{rec.segmentCount !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>
                    <PlayCircle className="w-5 h-5 text-slate-600 group-hover:text-blue-400 transition-colors shrink-0 ml-3" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Voice fingerprint */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Voice Fingerprint</h3>
            <div className="bg-slate-800 rounded-lg p-4 mb-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Identifier</span>
                <span className="text-white font-mono text-xs break-all text-right max-w-35">
                  {speaker.voiceIdentifier}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">First seen</span>
                <span className="text-white">
                  {new Date(speaker.firstDetected).toLocaleDateString('en-GB', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </span>
              </div>
              {speaker.wikidataId && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                    Wikidata
                  </span>
                  <a
                    href={`https://www.wikidata.org/wiki/${speaker.wikidataId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline font-mono text-xs inline-flex items-center gap-1"
                  >
                    {speaker.wikidataId}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>

            {/* Decorative waveform */}
            <div className="bg-slate-800 rounded-lg p-4 h-24 flex items-center justify-center gap-0.5 overflow-hidden">
              {Array.from({ length: 48 }).map((_, i) => {
                const h = 20 + ((Math.sin(i * 0.7) + Math.sin(i * 1.3)) * 0.5 + 1) * 40;
                return (
                  <div
                    key={i}
                    className="w-1 rounded-full"
                    style={{ height: `${h}%`, backgroundColor: speaker.color, opacity: 0.7 }}
                  />
                );
              })}
            </div>
          </div>

          {/* Risk level */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Risk Assessment</h3>
            <div className={`p-4 rounded-lg border ${risk.bg} ${risk.border}`}>
              <div className={`text-lg font-bold capitalize mb-1 ${risk.text}`}>{speaker.riskLevel} Risk</div>
              <p className="text-slate-400 text-xs">
                {speaker.riskLevel === 'high'
                  ? 'This speaker is flagged for close monitoring.'
                  : speaker.riskLevel === 'medium'
                  ? 'This speaker warrants periodic review.'
                  : 'No elevated risk indicators detected.'}
              </p>
            </div>
            {!editing && (
              <button
                onClick={startEdit}
                className="mt-3 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg border border-slate-700 transition-colors"
              >
                Update Risk Level
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
