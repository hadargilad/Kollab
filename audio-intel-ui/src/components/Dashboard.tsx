import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileAudio, Users, AlertTriangle, TrendingUp, Clock, ArrowRight, Radar } from 'lucide-react';
import { audios, speakers, alerts, type AudioRecord, type SpeakerRecord, type AlertRecord } from '../lib/api';

export default function Dashboard() {
  const [uploadList, setUploadList] = useState<AudioRecord[]>([]);
  const [speakerList, setSpeakerList] = useState<SpeakerRecord[]>([]);
  const [alertList, setAlertList] = useState<AlertRecord[]>([]);
  const [codedList, setCodedList] = useState<AlertRecord[]>([]);
  const [, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      audios.list(),
      speakers.list(),
      // Split the two panels cleanly. The left card is "flagged keyword"
      // hits, the right card is coded-language. Sharing one all-categories
      // list used to double-count coded alerts across both panels.
      alerts.list({ category: 'dangerous_word' }),
      alerts.list({ category: 'coded_language' }),
    ])
      .then(([a, s, al, cl]) => {
        setUploadList(a);
        setSpeakerList(s);
        setAlertList(al);
        setCodedList(cl);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const processedCount = uploadList.filter(u => u.status === 'processed').length;
  const recentUploads = uploadList.slice(0, 4);

  const formatDuration = (seconds: number) => {
    if (!seconds) return '-';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const timeAgo = (dateString: string) => {
    const diff = Date.now() - new Date(dateString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const statusColor = (status: string) => {
    if (status === 'processed')  return 'text-emerald-400';
    if (status === 'processing') return 'text-amber-400';
    return 'text-red-400';
  };

  const alertAccent = (type: string) => {
    if (type === 'high')   return 'border-l-red-500 bg-red-500/4';
    if (type === 'medium') return 'border-l-amber-500 bg-amber-500/4';
    return 'border-l-blue-500 bg-blue-500/4';
  };

  const alertIcon = (type: string) => {
    if (type === 'high')   return 'text-red-500';
    if (type === 'medium') return 'text-amber-500';
    return 'text-blue-500';
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div>
        <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">
          Intel Operations
        </div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-zinc-300 text-sm mt-0.5">Real-time audio analysis overview</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          to="/all-uploads"
          className="bg-zinc-900 border border-zinc-800 border-l-2 border-l-blue-500 rounded-md p-5 hover:bg-zinc-800 hover:border-zinc-700 transition-all group"
        >
          <div className="flex items-start justify-between mb-3">
            <FileAudio className="w-5 h-5 text-blue-500" />
            <span className="text-emerald-400 text-xs font-mono flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              {processedCount} done
            </span>
          </div>
          <div className="text-white text-3xl font-bold font-mono">{uploadList.length}</div>
          <div className="text-zinc-300 text-xs mt-1 flex items-center gap-1">
            Audio Files
            <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5" />
          </div>
        </Link>

        <Link
          to="/profile-search"
          className="bg-zinc-900 border border-zinc-800 border-l-2 border-l-purple-500 rounded-md p-5 hover:bg-zinc-800 hover:border-zinc-700 transition-all group"
        >
          <div className="flex items-start justify-between mb-3">
            <Users className="w-5 h-5 text-purple-500" />
          </div>
          <div className="text-white text-3xl font-bold font-mono">{speakerList.length}</div>
          <div className="text-zinc-300 text-xs mt-1 flex items-center gap-1">
            Identified Speakers
            <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5" />
          </div>
        </Link>

        <Link
          to="/alerts?category=dangerous_word"
          className="bg-zinc-900 border border-zinc-800 border-l-2 border-l-red-500 rounded-md p-5 text-left transition-all hover:bg-zinc-800 hover:border-zinc-700 group block"
        >
          <div className="flex items-start justify-between mb-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            {alertList.length > 0 && (
              <span className="text-red-400 text-xs font-mono flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Active
              </span>
            )}
          </div>
          <div className="text-white text-3xl font-bold font-mono">{alertList.length}</div>
          <div className="text-zinc-300 text-xs mt-1 flex items-center gap-1">
            Flagged Keyword Hits
            <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5" />
          </div>
        </Link>
      </div>


      {/* Recent uploads + alerts + coded-language */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Uploads */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-md">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
            <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Recent Uploads</span>
            <Link
              to="/all-uploads"
              className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded-md transition-colors"
            >
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {recentUploads.length === 0 ? (
            <div className="text-center py-10">
              <FileAudio className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-200 text-sm">No uploads yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {recentUploads.map((upload) => (
                <Link
                  key={upload.id}
                  to={upload.status === 'processed' ? `/analysis/${upload.id}` : '#'}
                  className="flex items-center justify-between px-5 py-3 hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileAudio className="w-4 h-4 text-zinc-200 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-white text-sm truncate">{upload.name}</div>
                      <div className="text-zinc-200 text-xs font-mono">{timeAgo(upload.uploadedAt)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 ml-3">
                    <span className="text-zinc-200 text-xs font-mono hidden sm:block">{formatDuration(upload.duration)}</span>
                    <span className="text-zinc-200 text-xs hidden sm:block">{upload.speakerCount} spk</span>
                    <span className={`text-xs font-mono uppercase ${statusColor(upload.status)}`}>
                      {upload.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-md">
          <Link
            to="/alerts?category=dangerous_word"
            className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between hover:bg-white/3 transition-colors"
          >
            <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Flagged Keywords</span>
            <span className="text-blue-400 text-[11px] font-mono">View all →</span>
          </Link>

          {alertList.length === 0 ? (
            <div className="text-center py-10">
              <AlertTriangle className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-200 text-sm">No flagged keyword hits.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800 max-h-96 overflow-y-auto">
              {alertList.map((alert) => (
                <Link
                  key={alert.id}
                  to={alert.audioId && alert.segmentId
                    ? `/transcript/${alert.audioId}#seg-${alert.segmentId}`
                    : alert.audioId ? `/transcript/${alert.audioId}` : '/alerts'}
                  className={`flex items-start gap-3 px-5 py-3 border-l-2 hover:bg-zinc-800/40 transition-colors ${alertAccent(alert.type)}`}
                >
                  <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${alertIcon(alert.type)}`} />
                  <div className="min-w-0">
                    <p className="text-zinc-300 text-xs leading-relaxed">{alert.message}</p>
                    <p className="text-zinc-200 text-[10px] font-mono mt-1">
                      {alert.audioName && <span className="text-blue-400">{alert.audioName}</span>}
                      {alert.audioName && ' · '}
                      {timeAgo(alert.createdAt)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Coded-language hits — sits in the same row, matches the Alerts shape */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-md">
          <Link
            to="/alerts?category=coded_language"
            className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between gap-2 hover:bg-white/3 transition-colors"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <Radar className="w-3.5 h-3.5 text-orange-300 shrink-0" />
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest truncate">Coded-Language</span>
            </div>
            <span className="text-blue-400 text-[11px] font-mono shrink-0">View all →</span>
          </Link>

          {codedList.length === 0 ? (
            <div className="text-center py-10">
              <Radar className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-200 text-sm">No detections.</p>
              <p className="text-zinc-300 text-xs mt-1">Flags fire above 0.50.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800 max-h-96 overflow-y-auto">
              {codedList.map((a) => {
                // Match backend/nlp/coded_language.py `_combine`: when a
                // signal is null (e.g. Signal B "Rare wording" is floored on
                // a small corpus), skip it and renormalize the remaining
                // weights so the score sits on the same 0-1 scale. Naively
                // treating null as 0 gave a number ~25% lower than what the
                // backend actually used to fire the alert.
                const WEIGHTS = { a: 0.30, b: 0.20, c: 0.25, d: 0.25 } as const;
                let numerator = 0, denom = 0;
                if (a.subScores) {
                  for (const k of ['a', 'b', 'c', 'd'] as const) {
                    const v = a.subScores[k];
                    if (v != null) { numerator += v * WEIGHTS[k]; denom += WEIGHTS[k]; }
                  }
                }
                const combined = denom > 0 ? numerator / denom : 0;
                const tint = combined > 0.80 ? 'border-l-red-500 bg-red-500/4' : 'border-l-orange-500 bg-orange-500/4';
                const scoreColor = combined > 0.80 ? 'text-red-300' : 'text-orange-300';
                // The panel is already titled "Coded-Language" — the per-row
                // "Possible coded language:" prefix on the backend message
                // just repeats that. Strip it so the row shows the actual
                // snippet, which is the informative part.
                const cleanedMsg = a.message.replace(/^Possible coded language:\s*/i, '');
                return (
                  <Link
                    key={a.id}
                    to={a.audioId && a.segmentId
                      ? `/transcript/${a.audioId}#seg-${a.segmentId}`
                      : a.audioId ? `/transcript/${a.audioId}` : '/alerts'}
                    className={`flex items-start gap-3 px-5 py-3 border-l-2 hover:bg-zinc-800/40 transition-colors ${tint}`}
                  >
                    <Radar className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${scoreColor}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-zinc-300 text-xs leading-relaxed line-clamp-2">{cleanedMsg}</p>
                      <p className="text-zinc-200 text-[10px] font-mono mt-1">
                        <span className={scoreColor} title="Suspicion score: weighted mix of Off-topic / Rare wording / Unnatural / Coded phrase signals. Fires above 0.50.">
                          score {combined.toFixed(2)}
                        </span>
                        {a.audioName && ' · '}
                        {a.audioName && <span className="text-blue-400">{a.audioName}</span>}
                        {' · '}{timeAgo(a.createdAt)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
