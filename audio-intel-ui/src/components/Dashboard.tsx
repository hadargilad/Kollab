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
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
    return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) !== 1 ? 's' : ''} ago`;
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Intelligence Dashboard</h1>
        <p className="text-slate-400">Real-time audio analysis overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <Link
          to="/all-uploads"
          className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-blue-500/50 hover:bg-slate-900/80 transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="bg-blue-600/10 p-3 rounded-lg">
              <FileAudio className="w-6 h-6 text-blue-500" />
            </div>
            <span className="text-green-500 text-sm flex items-center gap-1">
              <TrendingUp className="w-4 h-4" />
              {processedCount} processed
            </span>
          </div>
          <div className="text-white text-2xl mb-1">{uploadList.length}</div>
          <div className="text-slate-400 text-sm flex items-center gap-1">
            Audio Files Total
            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>

        <Link
          to="/profile-search"
          className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-purple-500/50 hover:bg-slate-900/80 transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="bg-purple-600/10 p-3 rounded-lg">
              <Users className="w-6 h-6 text-purple-500" />
            </div>
          </div>
          <div className="text-white text-2xl mb-1">{speakerList.length}</div>
          <div className="text-slate-400 text-sm flex items-center gap-1">
            Identified Speakers
            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>

        <button
          type="button"
          onClick={() => alertsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          disabled={alertList.length === 0}
          className="bg-slate-900 border border-slate-800 rounded-lg p-6 text-left transition-colors enabled:hover:border-red-500/50 enabled:hover:bg-slate-900/80 disabled:cursor-default group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="bg-red-600/10 p-3 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            {alertList.length > 0 && (
              <span className="text-red-500 text-sm flex items-center gap-1">
                <Clock className="w-4 h-4" />
                New
              </span>
            )}
          </div>
          <div className="text-white text-2xl mb-1">{alertList.length}</div>
          <div className="text-slate-400 text-sm flex items-center gap-1">
            Pending Alerts
            {alertList.length > 0 && (
              <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>
        </button>
      </div>

      {/* System Health */}
      {systemStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-5 py-4 flex items-center gap-4">
            <div className="bg-blue-600/10 p-2.5 rounded-lg shrink-0">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-white text-xl font-semibold">{systemStats.totalUsers}</div>
              <div className="text-slate-400 text-xs">Registered Users</div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg px-5 py-4 flex items-center gap-4">
            <div className="bg-purple-600/10 p-2.5 rounded-lg shrink-0">
              <HardDrive className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <div className="text-white text-xl font-semibold">{formatBytes(systemStats.storageUsedBytes)}</div>
              <div className="text-slate-400 text-xs">Storage Used</div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg px-5 py-4 flex items-center gap-4">
            <div className={`p-2.5 rounded-lg shrink-0 ${systemStats.dbStatus ? 'bg-green-600/10' : 'bg-red-600/10'}`}>
              <Database className={`w-5 h-5 ${systemStats.dbStatus ? 'text-green-400' : 'text-red-400'}`} />
            </div>
            <div>
              <div className={`text-xl font-semibold ${systemStats.dbStatus ? 'text-green-400' : 'text-red-400'}`}>
                {systemStats.dbStatus ? 'Online' : 'Error'}
              </div>
              <div className="text-slate-400 text-xs">Database Status</div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg px-5 py-4 flex items-center gap-4">
            <div className="bg-cyan-600/10 p-2.5 rounded-lg shrink-0">
              <Activity className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="text-white text-xl font-semibold">{systemStats.uptime}</div>
              <div className="text-slate-400 text-xs">Server Uptime</div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Uploads and Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white">Recent Uploads</h2>
            <Link
              to="/all-uploads"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
            >
              View All
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          {recentUploads.length === 0 ? (
            <div className="text-center py-8">
              <FileAudio className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No uploads yet. Go to Upload to add your first recording.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentUploads.map((upload) => (
                <Link
                  key={upload.id}
                  to={upload.status === 'processed' ? `/analysis/${upload.id}` : '#'}
                  className="flex items-center justify-between p-4 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors border border-slate-700"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="bg-blue-600/10 p-2 rounded shrink-0">
                      <FileAudio className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm mb-1 truncate">{upload.name}</div>
                      <div className="text-slate-400 text-xs">{timeAgo(upload.uploadedAt)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-slate-400 text-sm">{formatDuration(upload.duration)}</div>
                    <div className="text-slate-400 text-sm">{upload.speakerCount} spk</div>
                    <div className={`px-3 py-1 rounded-full text-xs ${
                      upload.status === 'processed'
                        ? 'bg-green-600/10 text-green-500'
                        : upload.status === 'failed'
                        ? 'bg-red-600/10 text-red-500'
                        : 'bg-yellow-600/10 text-yellow-500'
                    }`}>
                      {upload.status}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div ref={alertsRef} className="bg-slate-900 border border-slate-800 rounded-lg p-6 scroll-mt-6">
          <h2 className="text-white mb-4">Recent Alerts</h2>
          {alertList.length === 0 ? (
            <div className="text-center py-8">
              <AlertTriangle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No alerts.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alertList.slice(0, 5).map((alert) => (
                <div key={alert.id} className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                  <div className="flex items-start gap-3">
                    <div className={`p-1 rounded mt-0.5 ${
                      alert.type === 'high' ? 'bg-red-600/10' :
                      alert.type === 'medium' ? 'bg-yellow-600/10' : 'bg-blue-600/10'
                    }`}>
                      <AlertTriangle className={`w-4 h-4 ${
                        alert.type === 'high' ? 'text-red-500' :
                        alert.type === 'medium' ? 'text-yellow-500' : 'text-blue-500'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-300 text-sm mb-1">{alert.message}</p>
                      <p className="text-slate-500 text-xs">{timeAgo(alert.createdAt)}</p>
                    </div>
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
