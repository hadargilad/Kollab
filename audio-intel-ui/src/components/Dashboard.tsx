import { Link } from 'react-router-dom';
import { FileAudio, Users, Network, AlertTriangle, TrendingUp, Clock, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const activityData = [
  { date: 'Mon', files: 12 },
  { date: 'Tue', files: 19 },
  { date: 'Wed', files: 15 },
  { date: 'Thu', files: 25 },
  { date: 'Fri', files: 22 },
  { date: 'Sat', files: 8 },
  { date: 'Sun', files: 5 },
];

const speakerData = [
  { month: 'Jan', speakers: 45 },
  { month: 'Feb', speakers: 52 },
  { month: 'Mar', speakers: 61 },
  { month: 'Apr', speakers: 58 },
  { month: 'May', speakers: 73 },
  { month: 'Jun', speakers: 89 },
];

const recentUploads = [
  { id: 'AUD-2025-0847', filename: 'intercept_alpha_dec30.wav', duration: '12:34', status: 'completed', speakers: 3 },
  { id: 'AUD-2025-0846', filename: 'call_monitoring_546.mp3', duration: '08:15', status: 'processing', speakers: 2 },
  { id: 'AUD-2025-0845', filename: 'meeting_transcript_12.wav', duration: '45:02', status: 'completed', speakers: 5 },
  { id: 'AUD-2025-0844', filename: 'phone_call_789.mp3', duration: '06:47', status: 'completed', speakers: 2 },
];

const alerts = [
  { id: 1, type: 'high', message: 'New speaker matched to existing profile SPK-00234', time: '10 min ago' },
  { id: 2, type: 'medium', message: 'Keyword "operation" detected in 3 conversations', time: '1 hour ago' },
  { id: 3, type: 'low', message: 'Network cluster analysis completed', time: '2 hours ago' },
];

export default function Dashboard() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Intelligence Dashboard</h1>
        <p className="text-slate-400">Real-time audio analysis overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-blue-600/10 p-3 rounded-lg">
              <FileAudio className="w-6 h-6 text-blue-500" />
            </div>
            <span className="text-green-500 text-sm flex items-center gap-1">
              <TrendingUp className="w-4 h-4" />
              +12%
            </span>
          </div>
          <div className="text-white text-2xl mb-1">1,847</div>
          <div className="text-slate-400 text-sm">Audio Files Processed</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-purple-600/10 p-3 rounded-lg">
              <Users className="w-6 h-6 text-purple-500" />
            </div>
            <span className="text-green-500 text-sm flex items-center gap-1">
              <TrendingUp className="w-4 h-4" />
              +8%
            </span>
          </div>
          <div className="text-white text-2xl mb-1">342</div>
          <div className="text-slate-400 text-sm">Identified Speakers</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-cyan-600/10 p-3 rounded-lg">
              <Network className="w-6 h-6 text-cyan-500" />
            </div>
            <span className="text-green-500 text-sm flex items-center gap-1">
              <TrendingUp className="w-4 h-4" />
              +15%
            </span>
          </div>
          <div className="text-white text-2xl mb-1">89</div>
          <div className="text-slate-400 text-sm">Active Networks</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-red-600/10 p-3 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <span className="text-red-500 text-sm flex items-center gap-1">
              <Clock className="w-4 h-4" />
              New
            </span>
          </div>
          <div className="text-white text-2xl mb-1">12</div>
          <div className="text-slate-400 text-sm">Pending Alerts</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <h2 className="text-white mb-4">Weekly Activity</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={activityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Bar dataKey="files" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <h2 className="text-white mb-4">Speaker Growth</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={speakerData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Line type="monotone" dataKey="speakers" stroke="#a855f7" strokeWidth={2} />
            </LineChart>
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
          <div className="space-y-3">
            {recentUploads.map((upload) => (
              <Link
                key={upload.id}
                to={`/analysis/${upload.id}`}
                className="flex items-center justify-between p-4 bg-slate-800 rounded-lg hover:bg-slate-750 transition-colors border border-slate-700"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="bg-blue-600/10 p-2 rounded">
                    <FileAudio className="w-5 h-5 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm mb-1 truncate">{upload.filename}</div>
                    <div className="text-slate-400 text-xs">{upload.id}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-slate-400 text-sm">{upload.duration}</div>
                  <div className="text-slate-400 text-sm">{upload.speakers} speakers</div>
                  <div className={`px-3 py-1 rounded-full text-xs ${
                    upload.status === 'completed' 
                      ? 'bg-green-600/10 text-green-500' 
                      : 'bg-yellow-600/10 text-yellow-500'
                  }`}>
                    {upload.status}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <h2 className="text-white mb-4">Recent Alerts</h2>
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="p-4 bg-slate-800 rounded-lg border border-slate-700"
              >
                <div className="flex items-start gap-3">
                  <div className={`p-1 rounded mt-0.5 ${
                    alert.type === 'high' ? 'bg-red-600/10' :
                    alert.type === 'medium' ? 'bg-yellow-600/10' :
                    'bg-blue-600/10'
                  }`}>
                    <AlertTriangle className={`w-4 h-4 ${
                      alert.type === 'high' ? 'text-red-500' :
                      alert.type === 'medium' ? 'text-yellow-500' :
                      'text-blue-500'
                    }`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-slate-300 text-sm mb-1">{alert.message}</p>
                    <p className="text-slate-500 text-xs">{alert.time}</p>
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