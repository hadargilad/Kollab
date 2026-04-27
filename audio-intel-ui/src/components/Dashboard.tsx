import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  FileAudio, Users, Network, AlertTriangle, 
  TrendingUp, Clock, ArrowRight, Database, HardDrive 
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, LineChart, Line 
} from 'recharts';

// Static data for charts (to be connected to Backend in future tasks)
const activityData = [
  { date: 'Mon', files: 12 }, { date: 'Tue', files: 19 }, { date: 'Wed', files: 15 },
  { date: 'Thu', files: 25 }, { date: 'Fri', files: 22 }, { date: 'Sat', files: 8 }, { date: 'Sun', files: 5 },
];

const speakerData = [
  { month: 'Jan', speakers: 45 }, { month: 'Feb', speakers: 52 }, { month: 'Mar', speakers: 61 },
  { month: 'Apr', speakers: 58 }, { month: 'May', speakers: 73 }, { month: 'Jun', speakers: 89 },
];

// Placeholder data for alerts and recent uploads
const recentUploads = [
  { id: 'AUD-2025-0847', filename: 'intercept_alpha_dec30.wav', duration: '12:34', status: 'completed', speakers: 3 },
  { id: 'AUD-2025-0846', filename: 'call_monitoring_546.mp3', duration: '08:15', status: 'processing', speakers: 2 },
  { id: 'AUD-2025-0845', filename: 'meeting_transcript_12.wav', duration: '45:02', status: 'completed', speakers: 5 },
];

const alerts = [
  { id: 1, type: 'high', message: 'New speaker matched to existing profile SPK-00234', time: '10 min ago' },
  { id: 2, type: 'medium', message: 'Keyword "operation" detected in 3 conversations', time: '1 hour ago' },
];

export default function Dashboard() {
  // State for real-time system statistics from C# Backend
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalFiles: 0,
    storageUsedBytes: 0,
    uptime: '0d 0h 0m',
    dbStatus: false
  });

  useEffect(() => {
    // Request initial stats from Backend
    document.title = "JSON:" + JSON.stringify({ type: 'GET_ADMIN_STATS' });

    const handleMessage = (event: any) => {
      const message = event.detail;
      
      if (message?.type === 'ADMIN_STATS_DATA' && message.payload) {
        // SAFE MAPPING: Handle both PascalCase (C#) and camelCase (JS)
        const p = message.payload;
        setStats({
          totalUsers: p.TotalUsers ?? p.totalUsers ?? 0,
          totalFiles: p.TotalFiles ?? p.totalFiles ?? 0,
          storageUsedBytes: p.StorageUsedBytes ?? p.storageUsedBytes ?? 0,
          uptime: p.Uptime ?? p.uptime ?? '0d 0h 0m',
          dbStatus: p.DbStatus ?? p.dbStatus ?? false
        });
      }
    };

    window.addEventListener('adminStatsReceived', handleMessage as any);
    return () => window.removeEventListener('adminStatsReceived', handleMessage as any);
  }, []);

  // Helper to format raw bytes into human-readable strings
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="p-8 animate-in fade-in duration-700">
      {/* Header Section */}
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-white text-3xl font-bold mb-2">Intelligence Dashboard</h1>
          <p className="text-slate-400">Real-time system health and audio analysis overview</p>
        </div>
        <div className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border ${
          stats.dbStatus ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'
        }`}>
          <Database className="w-4 h-4" />
          SYSTEM: {stats.dbStatus ? 'ONLINE' : 'OFFLINE'}
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Files Processed Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl hover:border-blue-500/50 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-blue-600/10 p-3 rounded-xl group-hover:bg-blue-600/20 transition-colors">
              <FileAudio className="w-6 h-6 text-blue-500" />
            </div>
            <span className="text-blue-500 text-xs font-bold uppercase tracking-widest">Processing</span>
          </div>
          <div className="text-white text-3xl font-bold mb-1 tracking-tight">{stats.totalFiles.toLocaleString()}</div>
          <div className="text-slate-400 text-sm">Audio Files Processed</div>
        </div>

        {/* System Users Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl hover:border-purple-500/50 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-purple-600/10 p-3 rounded-xl group-hover:bg-purple-600/20 transition-colors">
              <Users className="w-6 h-6 text-purple-500" />
            </div>
            <span className="text-purple-500 text-xs font-bold uppercase tracking-widest">Users</span>
          </div>
          <div className="text-white text-3xl font-bold mb-1 tracking-tight">{stats.totalUsers}</div>
          <div className="text-slate-400 text-sm">Authorized Users</div>
        </div>

        {/* Database Size Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl hover:border-cyan-500/50 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-cyan-600/10 p-3 rounded-xl group-hover:bg-cyan-600/20 transition-colors">
              <HardDrive className="w-6 h-6 text-cyan-500" />
            </div>
            <span className="text-cyan-500 text-xs font-bold uppercase tracking-widest">Data</span>
          </div>
          <div className="text-white text-3xl font-bold mb-1 tracking-tight">{formatBytes(stats.storageUsedBytes)}</div>
          <div className="text-slate-400 text-sm">Database Storage</div>
        </div>

        {/* System Uptime Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl hover:border-orange-500/50 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-orange-600/10 p-3 rounded-xl group-hover:bg-orange-600/20 transition-colors">
              <Clock className="w-6 h-6 text-orange-500" />
            </div>
            <span className="text-orange-500 text-xs font-bold uppercase tracking-widest">Service</span>
          </div>
          <div className="text-white text-2xl font-bold mb-1 tracking-tight uppercase">{stats.uptime}</div>
          <div className="text-slate-400 text-sm">System Uptime</div>
        </div>
      </div>

      {/* Visual Analytics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h2 className="text-white font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" /> Weekly Processing Activity
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={activityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }}
                cursor={{ fill: '#1e293b' }}
              />
              <Bar dataKey="files" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h2 className="text-white font-bold mb-4 flex items-center gap-2">
            <Network className="w-4 h-4 text-purple-500" /> Speaker Identification Growth
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={speakerData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="month" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }} />
              <Line type="monotone" dataKey="speakers" stroke="#a855f7" strokeWidth={3} dot={{ fill: '#a855f7', strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Row: Recent Records & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-white font-bold">Recent Processing Queue</h2>
            <Link to="/all-uploads" className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm transition-colors font-medium">
              View All Queue <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {recentUploads.map((upload) => (
              <Link key={upload.id} to={`/analysis/${upload.id}`} className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl hover:bg-slate-800 transition-all border border-slate-700/50 group">
                <div className="flex items-center gap-4 flex-1">
                  <div className="bg-blue-600/10 p-2 rounded-lg group-hover:bg-blue-600/20">
                    <FileAudio className="w-5 h-5 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium mb-0.5 truncate">{upload.filename}</div>
                    <div className="text-slate-500 text-xs tracking-tight">{upload.id}</div>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-slate-400 text-xs font-medium">{upload.duration}</div>
                  <div className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter ${
                    upload.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500 animate-pulse'
                  }`}>
                    {upload.status}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h2 className="text-white font-bold mb-6">Intelligence Alerts</h2>
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="p-4 bg-slate-800/30 rounded-xl border border-slate-700/50 hover:bg-slate-800/50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`p-1.5 rounded-lg mt-0.5 ${
                    alert.type === 'high' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'
                  }`}>
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-slate-300 text-sm leading-relaxed mb-1">{alert.message}</p>
                    <p className="text-slate-500 text-[10px] uppercase font-bold flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {alert.time}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}