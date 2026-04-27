import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileAudio, Users, AlertTriangle, TrendingUp, Clock, ArrowRight, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { audios, speakers, alerts, type AudioRecord, type SpeakerRecord, type AlertRecord } from '../lib/api';

function getDayLabel(date: Date) {
  return date.toLocaleDateString('en-GB', { weekday: 'short' });
}

function buildWeeklyActivity(uploads: AudioRecord[]) {
  const days: { date: string; label: string; files: number }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push({ date: d.toDateString(), label: getDayLabel(d), files: 0 });
  }
  for (const u of uploads) {
    const ds = new Date(u.uploadedAt).toDateString();
    const entry = days.find(d => d.date === ds);
    if (entry) entry.files++;
  }
  return days.map(({ label, files }) => ({ date: label, files }));
}

function buildStatusDistribution(uploads: AudioRecord[]) {
  const counts = { processed: 0, processing: 0, failed: 0 };
  for (const u of uploads) {
    if (u.status in counts) counts[u.status as keyof typeof counts]++;
  }
  return [
    { label: 'Processed', count: counts.processed },
    { label: 'Processing', count: counts.processing },
    { label: 'Failed', count: counts.failed },
  ];
}

export default function Dashboard() {
  const [uploadList, setUploadList] = useState<AudioRecord[]>([]);
  const [speakerList, setSpeakerList] = useState<SpeakerRecord[]>([]);
  const [alertList, setAlertList] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([audios.list(), speakers.list(), alerts.list()])
      .then(([a, s, al]) => {
        setUploadList(a);
        setSpeakerList(s);
        setAlertList(al);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const processedCount = uploadList.filter(u => u.status === 'processed').length;
  const recentUploads = uploadList.slice(0, 4);
  const weeklyData = buildWeeklyActivity(uploadList);
  const statusData = buildStatusDistribution(uploadList);

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

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
    </div>
  );

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Intelligence Dashboard</h1>
        <p className="text-slate-400">Real-time audio analysis overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
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
          <div className="text-slate-400 text-sm">Audio Files Total</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-purple-600/10 p-3 rounded-lg">
              <Users className="w-6 h-6 text-purple-500" />
            </div>
          </div>
          <div className="text-white text-2xl mb-1">{speakerList.length}</div>
          <div className="text-slate-400 text-sm">Identified Speakers</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
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
          <div className="text-slate-400 text-sm">Pending Alerts</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <h2 className="text-white mb-4">Uploads — Last 7 Days</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Bar dataKey="files" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <h2 className="text-white mb-4">Files by Status</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={statusData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Bar dataKey="count" fill="#a855f7" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

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

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
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
