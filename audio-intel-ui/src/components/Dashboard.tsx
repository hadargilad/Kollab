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
      alerts.list(),
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
    if (!seconds) return '—';
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
          to="/alerts"
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
            Pending Alerts
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
              className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded transition-colors"
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
          <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Alerts</span>
            <Link to="/alerts" className="text-blue-400 hover:text-blue-300 text-[11px] font-mono transition-colors">
              View all →
            </Link>
          </div>

          {alertList.length === 0 ? (
            <div className="text-center py-10">
              <AlertTriangle className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-200 text-sm">No active alerts.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {alertList.slice(0, 5).map((alert) => (
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
                    <p className="text-zinc-200 text-[10px] font-mono mt-1">{timeAgo(alert.createdAt)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Coded-language hits — sits in the same row, matches the Alerts shape */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-md">
          <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Radar className="w-3.5 h-3.5 text-orange-300 shrink-0" />
              <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest truncate">Coded-Language</span>
            </div>
            <Link to="/alerts?category=coded_language" className="text-blue-400 hover:text-blue-300 text-[11px] font-mono transition-colors shrink-0">
              View all →
            </Link>
          </div>

          {codedList.length === 0 ? (
            <div className="text-center py-10">
              <Radar className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-200 text-sm">No detections.</p>
              <p className="text-zinc-300 text-xs mt-1">Flags fire above 0.65.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {codedList.slice(0, 5).map((a) => {
                const combined = a.subScores
                  ? 0.30 * (a.subScores.a ?? 0) + 0.20 * (a.subScores.b ?? 0)
                    + 0.25 * (a.subScores.c ?? 0) + 0.25 * (a.subScores.d ?? 0)
                  : 0;
                const tint = combined > 0.80 ? 'border-l-red-500 bg-red-500/4' : 'border-l-orange-500 bg-orange-500/4';
                const scoreColor = combined > 0.80 ? 'text-red-300' : 'text-orange-300';
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
                      <p className="text-zinc-300 text-xs leading-relaxed line-clamp-2">{a.message}</p>
                      <p className="text-zinc-200 text-[10px] font-mono mt-1">
                        <span className={scoreColor}>{combined.toFixed(2)}</span> · {timeAgo(a.createdAt)}
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
