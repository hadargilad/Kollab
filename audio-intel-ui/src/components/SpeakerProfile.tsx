import { useParams, Link } from 'react-router-dom';
import { User, FileAudio, Hash, Calendar, MapPin, Link2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const speakerData = {
  'spk-1': {
    id: 'SPK-00234',
    name: 'Speaker A',
    knownIdentity: 'Unknown',
    color: '#3b82f6',
    voiceFingerprint: 'VF-89A3-B2C1-4D7E',
    firstDetected: 'Dec 15, 2025',
    totalRecordings: 12,
    totalDuration: '2h 34m',
    topics: ['Operations', 'Logistics', 'Team coordination'],
    connections: [
      { id: 'spk-2', name: 'Speaker B', interactions: 8, lastContact: '2 days ago' },
      { id: 'spk-3', name: 'Speaker C', interactions: 3, lastContact: '1 week ago' },
    ],
    recordings: [
      { id: 'AUD-2025-0847', date: 'Dec 30, 2025', duration: '12:34' },
      { id: 'AUD-2025-0823', date: 'Dec 28, 2025', duration: '08:15' },
      { id: 'AUD-2025-0801', date: 'Dec 25, 2025', duration: '15:42' },
    ],
    activityData: [
      { month: 'Jul', count: 2 },
      { month: 'Aug', count: 1 },
      { month: 'Sep', count: 3 },
      { month: 'Oct', count: 2 },
      { month: 'Nov', count: 1 },
      { month: 'Dec', count: 3 },
    ],
  },
};

export default function SpeakerProfile() {
  const { id } = useParams();
  const speaker = speakerData[id as keyof typeof speakerData] || speakerData['spk-1'];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Speaker Profile</h1>
        <p className="text-slate-400">Detailed voice and identity information</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Profile */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${speaker.color}20` }}
                >
                  <User className="w-8 h-8" style={{ color: speaker.color }} />
                </div>
                <div>
                  <h2 className="text-white text-2xl mb-1">{speaker.name}</h2>
                  <p className="text-slate-400">ID: {speaker.id}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="px-3 py-1 bg-slate-800 text-slate-300 rounded-full text-sm">
                      {speaker.knownIdentity}
                    </span>
                  </div>
                </div>
              </div>
              <Link
                to="/identity"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Match Identity
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <FileAudio className="w-4 h-4 text-blue-500" />
                  <span className="text-slate-400 text-sm">Recordings</span>
                </div>
                <div className="text-white text-xl">{speaker.totalRecordings}</div>
              </div>
              <div className="p-4 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-purple-500" />
                  <span className="text-slate-400 text-sm">Duration</span>
                </div>
                <div className="text-white text-xl">{speaker.totalDuration}</div>
              </div>
              <div className="p-4 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Link2 className="w-4 h-4 text-cyan-500" />
                  <span className="text-slate-400 text-sm">Connections</span>
                </div>
                <div className="text-white text-xl">{speaker.connections.length}</div>
              </div>
              <div className="p-4 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Hash className="w-4 h-4 text-green-500" />
                  <span className="text-slate-400 text-sm">Topics</span>
                </div>
                <div className="text-white text-xl">{speaker.topics.length}</div>
              </div>
            </div>
          </div>

          {/* Voice Fingerprint */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Voice Fingerprint</h3>
            <div className="bg-slate-800 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-sm">Fingerprint ID</span>
                <span className="text-white font-mono">{speaker.voiceFingerprint}</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-sm">First Detected</span>
                <span className="text-white">{speaker.firstDetected}</span>
              </div>
            </div>
            
            {/* Waveform Visualization */}
            <div className="bg-slate-800 rounded-lg p-4 h-32 flex items-center justify-center gap-1">
              {Array.from({ length: 50 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full transition-all"
                  style={{
                    height: `${Math.random() * 80 + 20}%`,
                    backgroundColor: speaker.color,
                    opacity: 0.6 + Math.random() * 0.4,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Activity Chart */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Activity Timeline</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={speaker.activityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#e2e8f0' }}
                />
                <Bar dataKey="count" fill={speaker.color} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Related Recordings */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Related Recordings</h3>
            <div className="space-y-2">
              {speaker.recordings.map((recording) => (
                <Link
                  key={recording.id}
                  to={`/analysis/${recording.id}`}
                  className="flex items-center justify-between p-4 bg-slate-800 rounded-lg hover:bg-slate-750 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <FileAudio className="w-5 h-5 text-blue-500" />
                    <div>
                      <div className="text-white">{recording.id}</div>
                      <div className="text-slate-400 text-sm">{recording.date}</div>
                    </div>
                  </div>
                  <div className="text-slate-400">{recording.duration}</div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Topics */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Detected Topics</h3>
            <div className="space-y-2">
              {speaker.topics.map((topic, idx) => (
                <div
                  key={idx}
                  className="px-3 py-2 bg-slate-800 text-slate-300 rounded-lg text-sm"
                >
                  {topic}
                </div>
              ))}
            </div>
          </div>

          {/* Connections */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Known Connections</h3>
            <div className="space-y-3">
              {speaker.connections.map((connection) => (
                <Link
                  key={connection.id}
                  to={`/speaker/${connection.id}`}
                  className="block p-4 bg-slate-800 rounded-lg hover:bg-slate-750 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-slate-400" />
                    <span className="text-white">{connection.name}</span>
                  </div>
                  <div className="text-slate-400 text-sm space-y-1">
                    <div>{connection.interactions} interactions</div>
                    <div className="text-xs">Last: {connection.lastContact}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* External Profiles */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">External Profiles</h3>
            <div className="text-slate-400 text-sm text-center py-8">
              <MapPin className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p>No external profiles linked</p>
              <button className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors text-sm">
                Search Databases
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
