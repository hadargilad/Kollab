import { useState, useEffect, useMemo } from 'react';
import { Search, User, FileAudio, Calendar, ArrowRight, Loader2, AlertCircle, Fingerprint } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { speakers as speakersApi, type SpeakerRecord } from '../lib/api';

export default function ProfileSearch() {
  const [profiles, setProfiles] = useState<SpeakerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
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
      default:       return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/25';
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest mb-1">Intelligence</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Profile Search</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Search by name, voice identifier, or risk level</p>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
        <input
          type="text"
          placeholder="Search profiles…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-black border border-zinc-800 rounded pl-9 pr-4 py-2.5 text-white text-sm placeholder-zinc-700 focus:outline-none focus:border-blue-500 transition-all font-mono"
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
          <div className="text-zinc-600 text-xs font-mono">
            {searchQuery
              ? `${filteredProfiles.length} / ${profiles.length} profiles`
              : `${profiles.length} profile${profiles.length !== 1 ? 's' : ''}`}
          </div>

          {profiles.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-zinc-900 rounded-md">
              <User className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-600 text-sm">No speakers yet. Upload a recording to get started.</p>
            </div>
          ) : filteredProfiles.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-zinc-900 rounded-md">
              <Search className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-600 text-sm">No profiles match your search.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filteredProfiles.map((profile) => (
                <div
                  key={profile.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-md p-5 hover:border-zinc-600 transition-colors cursor-pointer group"
                  onClick={() => navigate(`/speaker/${profile.id}`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${profile.color}18` }}>
                        <User className="w-5 h-5" style={{ color: profile.color }} />
                      </div>
                      <div>
                        <div className="text-white text-sm font-medium">{profile.name}</div>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase mt-0.5 ${getRiskCls(profile.riskLevel)}`}>
                          {profile.riskLevel} risk
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors shrink-0" />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Fingerprint className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      <span className="text-zinc-500 font-mono text-xs truncate">{profile.voiceIdentifier}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      <span className="text-zinc-500 text-xs">First: {formatDate(profile.firstDetected)}</span>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center gap-1.5 text-zinc-600 text-xs">
                    <FileAudio className="w-3.5 h-3.5" />
                    <span className="font-mono">{profile.recordingCount} recording{profile.recordingCount !== 1 ? 's' : ''}</span>
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
