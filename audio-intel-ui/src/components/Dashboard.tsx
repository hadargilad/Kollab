import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { FileAudio, Users, AlertTriangle, TrendingUp, Clock, ArrowRight, HardDrive, Database, Activity } from 'lucide-react';
import { audios, speakers, alerts, stats, type AudioRecord, type SpeakerRecord, type AlertRecord, type SystemStats } from '../lib/api';

export default function Dashboard() {
  const [uploadList, setUploadList] = useState<AudioRecord[]>([]);
  const [speakerList, setSpeakerList] = useState<SpeakerRecord[]>([]);
  const [alertList, setAlertList] = useState<AlertRecord[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [, setLoading] = useState(true);
  const alertsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    Promise.all([audios.list(), speakers.list(), alerts.list(), stats.get()])
      .then(([a, s, al, st]) => {
        setUploadList(a);
        setSpeakerList(s);
        setAlertList(al);
        setSystemStats(st);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const processedCount = uploadList.filter(u => u.status === 'processed').length;
  const recentUploads = uploadList.slice(0, 4);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
    if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`;
    if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

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
        <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest mb-1">
          Intel Operations
        </div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Real-time audio analysis overview</p>
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
          <div className="text-zinc-500 text-xs mt-1 flex items-center gap-1">
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
          <div className="text-zinc-500 text-xs mt-1 flex items-center gap-1">
            Identified Speakers
            <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5" />
          </div>
        </Link>

        <button
          type="button"
          onClick={() => alertsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          disabled={alertList.length === 0}
          className="bg-zinc-900 border border-zinc-800 border-l-2 border-l-red-500 rounded-md p-5 text-left transition-all enabled:hover:bg-zinc-800 enabled:hover:border-zinc-700 disabled:cursor-default group"
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
          <div className="text-zinc-500 text-xs mt-1 flex items-center gap-1">
            Pending Alerts
            {alertList.length > 0 && (
              <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5" />
            )}
          </div>
        </button>
      </div>

      {/* System health */}
      {systemStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: Users,     color: 'text-blue-400',    value: systemStats.totalUsers,                label: 'Registered Users' },
            { icon: HardDrive, color: 'text-purple-400',  value: formatBytes(systemStats.storageUsedBytes), label: 'Storage Used' },
            { icon: Database,  color: systemStats.dbStatus ? 'text-emerald-400' : 'text-red-400',
              value: systemStats.dbStatus ? 'Online' : 'Error', label: 'Database' },
            { icon: Activity,  color: 'text-cyan-400',    value: systemStats.uptime,                    label: 'Uptime' },
          ].map(({ icon: Icon, color, value, label }) => (
            <div key={label} className="bg-zinc-950 border border-zinc-900 rounded-md px-4 py-3 flex items-center gap-3">
              <Icon className={`w-4 h-4 ${color} shrink-0`} />
              <div className="min-w-0">
                <div className={`font-mono font-semibold text-sm truncate ${color}`}>{value}</div>
                <div className="text-zinc-600 text-xs">{label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent uploads + alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Uploads */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-md">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
            <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Recent Uploads</span>
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
              <p className="text-zinc-600 text-sm">No uploads yet.</p>
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
                    <FileAudio className="w-4 h-4 text-zinc-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-white text-sm truncate">{upload.name}</div>
                      <div className="text-zinc-600 text-xs font-mono">{timeAgo(upload.uploadedAt)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 ml-3">
                    <span className="text-zinc-600 text-xs font-mono hidden sm:block">{formatDuration(upload.duration)}</span>
                    <span className="text-zinc-600 text-xs hidden sm:block">{upload.speakerCount} spk</span>
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
        <div ref={alertsRef} className="bg-zinc-900 border border-zinc-800 rounded-md scroll-mt-6">
          <div className="px-5 py-3.5 border-b border-zinc-800">
            <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Alerts</span>
          </div>

          {alertList.length === 0 ? (
            <div className="text-center py-10">
              <AlertTriangle className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-600 text-sm">No active alerts.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {alertList.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 px-5 py-3 border-l-2 ${alertAccent(alert.type)}`}
                >
                  <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${alertIcon(alert.type)}`} />
                  <div className="min-w-0">
                    <p className="text-zinc-300 text-xs leading-relaxed">{alert.message}</p>
                    <p className="text-zinc-600 text-[10px] font-mono mt-1">{timeAgo(alert.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
