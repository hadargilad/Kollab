import { useState, useEffect, useMemo } from 'react';
import { Search, User, FileAudio, Calendar, ArrowRight, Loader2, AlertCircle, Fingerprint, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { speakers as speakersApi, type SpeakerRecord } from '../lib/api';
import SpeakerAvatar from './SpeakerAvatar';

export default function ProfileSearch() {
  const [profiles, setProfiles] = useState<SpeakerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    speakersApi.list()
      .then(data => { if (!cancelled) setProfiles(data); })
      .catch(() => { if (!cancelled) setError('Failed to load speaker profiles.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filteredProfiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.voiceIdentifier.toLowerCase().includes(q) ||
      p.riskLevel.toLowerCase().includes(q)
    );
  }, [profiles, searchQuery]);

  const getRiskCls = (level: string) => {
    switch (level) {
      case 'high':   return 'bg-red-500/10 text-red-400 border-red-500/25';
      case 'medium': return 'bg-amber-500/10 text-amber-400 border-amber-500/25';
      case 'low':    return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25';
      default:       return 'bg-zinc-500/10 text-zinc-200 border-zinc-500/25';
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const toggleSelected = (id: number, e?: React.MouseEvent | React.ChangeEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchBusy(true); setBatchError('');
    try {
      const ids = Array.from(selectedIds);
      const res = await speakersApi.batchDelete(ids);
      const deletedSet = new Set(res.deleted);
      setProfiles(prev => prev.filter(p => !deletedSet.has(p.id)));
      setSelectedIds(new Set());
      setBatchConfirmOpen(false);
      if (res.failed.length > 0) {
        setBatchError(`${res.failed.length} speaker(s) could not be deleted.`);
      }
    } catch (e: any) {
      setBatchError(e?.message ?? 'Batch delete failed.');
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Intelligence</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Profile Search</h1>
        <p className="text-zinc-300 text-sm mt-0.5">Search by name, voice identifier, or risk level</p>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-200" />
        <input
          type="text"
          placeholder="Search profiles…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-black border border-zinc-800 rounded pl-9 pr-4 py-2.5 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 transition-all font-mono"
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-md p-6 text-center">
          <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-zinc-200 text-xs font-mono">
              {searchQuery
                ? `${filteredProfiles.length} / ${profiles.length} profiles`
                : `${profiles.length} profile${profiles.length !== 1 ? 's' : ''}`}
            </div>
            {selectedIds.size > 0 && (
              <>
                <span className="text-zinc-200 text-xs font-mono ml-2">· {selectedIds.size} selected</span>
                <button
                  onClick={() => setBatchConfirmOpen(true)}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete {selectedIds.size}
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs rounded transition-colors"
                >
                  Clear
                </button>
              </>
            )}
            {batchError && (
              <span className="text-red-400 text-xs font-mono w-full">{batchError}</span>
            )}
          </div>

          {profiles.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-zinc-900 rounded-md">
              <User className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
              <p className="text-zinc-200 text-sm">No speakers yet. Upload a recording to get started.</p>
            </div>
          ) : filteredProfiles.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-zinc-900 rounded-md">
              <Search className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
              <p className="text-zinc-200 text-sm">No profiles match your search.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filteredProfiles.map((profile) => (
                <div
                  key={profile.id}
                  className={`bg-zinc-900 border rounded-md p-5 hover:border-zinc-600 transition-colors cursor-pointer group ${
                    selectedIds.has(profile.id) ? 'border-blue-500/40 bg-blue-500/4' : 'border-zinc-800'
                  }`}
                  onClick={() => navigate(`/speaker/${profile.id}`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(profile.id)}
                        onClick={e => e.stopPropagation()}
                        onChange={() => toggleSelected(profile.id)}
                        className="w-4 h-4 accent-blue-500 shrink-0"
                      />
                      <SpeakerAvatar
                        speakerId={profile.id}
                        name={profile.name}
                        color={profile.color}
                        imagePath={profile.imagePath}
                        size={40}
                      />
                      <div>
                        <div className="text-white text-sm font-medium">{profile.name}</div>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase mt-0.5 ${getRiskCls(profile.riskLevel)}`}>
                          {profile.riskLevel} risk
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-zinc-300 group-hover:text-zinc-200 transition-colors shrink-0" />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Fingerprint className="w-3.5 h-3.5 text-zinc-200 shrink-0" />
                      <span className="text-zinc-300 font-mono text-xs truncate">{profile.voiceIdentifier}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-zinc-200 shrink-0" />
                      <span className="text-zinc-300 text-xs">First: {formatDate(profile.firstDetected)}</span>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center gap-1.5 text-zinc-200 text-xs">
                    <FileAudio className="w-3.5 h-3.5" />
                    <span className="font-mono">{profile.recordingCount} recording{profile.recordingCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {batchConfirmOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-red-500/10 border border-red-500/25 rounded flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </div>
                <h2 className="text-white font-semibold">Delete {selectedIds.size} speaker(s)?</h2>
              </div>
              <p className="text-zinc-200 text-sm">
                Their voice fingerprints and relations will be removed. Their transcript segments stay but become un-attributed (shown as "Unknown"). This cannot be undone.
              </p>
            </div>
            <div className="p-4 flex gap-2 justify-end">
              <button
                onClick={() => setBatchConfirmOpen(false)}
                disabled={batchBusy}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-sm rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchBusy}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded transition-colors flex items-center gap-2"
              >
                {batchBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Delete {selectedIds.size}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
