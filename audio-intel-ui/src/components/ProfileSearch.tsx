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
      .catch(() => { if (!cancelled) setError('Failed to load speaker profiles. Make sure the backend is running.'); })
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

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'high':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'medium':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'low':
        return 'bg-green-500/10 text-green-400 border-green-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-GB', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-white text-3xl mb-2">Profile Search</h1>
          <p className="text-slate-400">
            Speakers identified from uploaded recordings. Search by name, voice ID, or risk level.
          </p>
        </div>

        <div className="mb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, voice identifier, or risk level..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-12 pr-4 py-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="mb-4 text-slate-400">
              {searchQuery
                ? `Found ${filteredProfiles.length} of ${profiles.length} profile${profiles.length !== 1 ? 's' : ''}`
                : `${profiles.length} speaker profile${profiles.length !== 1 ? 's' : ''}`}
            </div>

            {profiles.length === 0 ? (
              <div className="text-center py-16">
                <div className="bg-slate-900 border border-slate-800 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <User className="w-10 h-10 text-slate-600" />
                </div>
                <h3 className="text-white text-xl mb-2">No speakers yet</h3>
                <p className="text-slate-400">Upload an audio recording and detected speakers will appear here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {filteredProfiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-blue-500/50 transition-all cursor-pointer group"
                    onClick={() => navigate(`/speaker/${profile.id}`)}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <div
                          className="p-3 rounded-full"
                          style={{ backgroundColor: `${profile.color}20` }}
                        >
                          <User className="w-6 h-6" style={{ color: profile.color }} />
                        </div>
                        <div>
                          <h3 className="text-white text-lg">{profile.name}</h3>
                          <div className={`inline-flex items-center px-2 py-1 rounded border text-xs mt-1 ${getRiskColor(profile.riskLevel)}`}>
                            {profile.riskLevel.toUpperCase()} RISK
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-blue-400 transition-colors" />
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Fingerprint className="w-4 h-4 text-slate-500 shrink-0" />
                        <span className="text-slate-300 font-mono text-xs truncate" title={profile.voiceIdentifier}>
                          {profile.voiceIdentifier}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
                        <span className="text-slate-300">First detected: {formatDate(profile.firstDetected)}</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-800">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400 flex items-center gap-2">
                          <FileAudio className="w-4 h-4" />
                          Recordings
                        </span>
                        <span className="text-white">{profile.recordingCount}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {profiles.length > 0 && filteredProfiles.length === 0 && (
              <div className="text-center py-16">
                <div className="bg-slate-900 border border-slate-800 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <Search className="w-10 h-10 text-slate-600" />
                </div>
                <h3 className="text-white text-xl mb-2">No profiles found</h3>
                <p className="text-slate-400">Try adjusting your search query</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
