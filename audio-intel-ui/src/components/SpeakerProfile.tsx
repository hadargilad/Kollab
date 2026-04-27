import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { User, FileAudio, Calendar, Link2, Loader2, AlertCircle, Pencil, Check, X } from 'lucide-react';
import { speakers, relations, type SpeakerRecord, type RelationRecord } from '../lib/api';

const RISK_COLORS = {
  low:    { bg: 'bg-green-600/10',  text: 'text-green-400',  border: 'border-green-600/30' },
  medium: { bg: 'bg-yellow-600/10', text: 'text-yellow-400', border: 'border-yellow-600/30' },
  high:   { bg: 'bg-red-600/10',    text: 'text-red-400',    border: 'border-red-600/30' },
};

export default function SpeakerProfile() {
  const { id } = useParams<{ id: string }>();
  const speakerId = Number(id);

  const [speaker, setSpeaker] = useState<SpeakerRecord | null>(null);
  const [connections, setConnections] = useState<RelationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editRisk, setEditRisk] = useState<'low' | 'medium' | 'high'>('low');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!speakerId) return;
    Promise.all([speakers.get(speakerId), relations.list()])
      .then(([spk, rels]) => {
        setSpeaker(spk);
        setEditName(spk.name);
        setEditRisk(spk.riskLevel);
        setConnections(rels.filter(r => r.speakerA.id === speakerId || r.speakerB.id === speakerId));
      })
      .catch(() => setError('Failed to load speaker profile.'))
      .finally(() => setLoading(false));
  }, [speakerId]);

  const startEdit = () => {
    if (!speaker) return;
    setEditName(speaker.name);
    setEditRisk(speaker.riskLevel);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    if (!speaker) return;
    setSaving(true);
    try {
      await speakers.update(speakerId, editName.trim() || speaker.name, editRisk);
      setSpeaker({ ...speaker, name: editName.trim() || speaker.name, riskLevel: editRisk });
      setEditing(false);
    } catch {
      // keep editing open on failure
    } finally {
      setSaving(false);
    }
  };

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
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Speaker Profile</h1>
        <p className="text-slate-400">Voice identity and connection information</p>
      </div>

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
                  <button
                    onClick={startEdit}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm border border-slate-700 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
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
              <div className="p-4 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <FileAudio className="w-4 h-4 text-blue-500" />
                  <span className="text-slate-400 text-sm">Recordings</span>
                </div>
                <div className="text-white text-xl">{speaker.recordingCount}</div>
              </div>
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
