import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, Search, FileText, AlertTriangle, User } from 'lucide-react';

interface TranscriptEntry {
  id: string;
  speakerId: string;
  speakerLabel: string;
  speakerColor: string;
  timestamp: string;
  text: string;
  keywords?: string[];
}

const transcript: TranscriptEntry[] = [
  {
    id: 't1',
    speakerId: 'spk-1',
    speakerLabel: 'Speaker A',
    speakerColor: '#3b82f6',
    timestamp: '00:00',
    text: 'We need to discuss the timeline for the operation.',
  },
  {
    id: 't2',
    speakerId: 'spk-2',
    speakerLabel: 'Speaker B',
    speakerColor: '#a855f7',
    timestamp: '00:04',
    text: 'Agreed. I think we should move forward by next week.',
    keywords: ['next week'],
  },
  {
    id: 't3',
    speakerId: 'spk-1',
    speakerLabel: 'Speaker A',
    speakerColor: '#3b82f6',
    timestamp: '00:08',
    text: 'That works. Have you coordinated with the team in sector 7?',
    keywords: ['sector 7'],
  },
  {
    id: 't4',
    speakerId: 'spk-3',
    speakerLabel: 'Speaker C',
    speakerColor: '#06b6d4',
    timestamp: '00:12',
    text: 'Yes, they are ready to proceed on our signal.',
  },
  {
    id: 't5',
    speakerId: 'spk-2',
    speakerLabel: 'Speaker B',
    speakerColor: '#a855f7',
    timestamp: '00:16',
    text: 'Perfect. Let me confirm the logistics and get back to you tomorrow.',
  },
  {
    id: 't6',
    speakerId: 'spk-1',
    speakerLabel: 'Speaker A',
    speakerColor: '#3b82f6',
    timestamp: '00:21',
    text: 'Sounds good. Talk soon.',
  },
];

const summary = {
  keyTopics: ['Timeline planning', 'Team coordination', 'Logistics confirmation'],
  entities: ['Sector 7', 'Team'],
  sentiment: 'Professional, coordinated',
  alerts: ['Reference to "operation" detected', 'Location mention: Sector 7'],
};

export default function TranscriptView() {
  const { id } = useParams();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTranscript = transcript.filter(entry =>
    entry.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-500/30 text-yellow-200">{part}</mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Transcript & Summary</h1>
        <p className="text-slate-400">File ID: {id}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Transcript */}
        <div className="lg:col-span-2 space-y-6">
          {/* Search & Controls */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search transcript..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors">
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
          </div>

          {/* Transcript */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-6">
              <FileText className="w-5 h-5 text-blue-500" />
              <h2 className="text-white">Full Transcript</h2>
            </div>
            <div className="space-y-4">
              {filteredTranscript.map((entry) => (
                <div key={entry.id} className="flex gap-4">
                  <div className="flex-shrink-0 w-20 text-slate-400 text-sm pt-1">
                    {entry.timestamp}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: entry.speakerColor }}
                      />
                      <Link
                        to={`/speaker/${entry.speakerId}`}
                        className="text-white hover:text-blue-400 transition-colors"
                      >
                        {entry.speakerLabel}
                      </Link>
                    </div>
                    <p className="text-slate-300">
                      {highlightText(entry.text, searchQuery)}
                    </p>
                    {entry.keywords && entry.keywords.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {entry.keywords.map((keyword, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded text-xs"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Summary Sidebar */}
        <div className="space-y-6">
          {/* Auto-generated Summary */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">AI Summary</h3>
            <div className="space-y-4">
              <div>
                <h4 className="text-slate-400 text-sm mb-2">Key Topics</h4>
                <div className="space-y-2">
                  {summary.keyTopics.map((topic, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span className="text-slate-300 text-sm">{topic}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-slate-400 text-sm mb-2">Entities Detected</h4>
                <div className="flex flex-wrap gap-2">
                  {summary.entities.map((entity, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-purple-600/20 text-purple-400 rounded-full text-sm"
                    >
                      {entity}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-slate-400 text-sm mb-2">Sentiment</h4>
                <p className="text-slate-300 text-sm">{summary.sentiment}</p>
              </div>
            </div>
          </div>

          {/* Alerts */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              <h3 className="text-white">Alerts</h3>
            </div>
            <div className="space-y-3">
              {summary.alerts.map((alert, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-yellow-600/10 border border-yellow-600/30 rounded-lg"
                >
                  <p className="text-yellow-300 text-sm">{alert}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Participants */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-5 h-5 text-blue-500" />
              <h3 className="text-white">Participants</h3>
            </div>
            <div className="space-y-2">
              {Array.from(new Set(transcript.map(t => t.speakerId))).map(speakerId => {
                const speaker = transcript.find(t => t.speakerId === speakerId)!;
                const count = transcript.filter(t => t.speakerId === speakerId).length;
                return (
                  <Link
                    key={speakerId}
                    to={`/speaker/${speakerId}`}
                    className="flex items-center justify-between p-3 bg-slate-800 rounded-lg hover:bg-slate-750 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: speaker.speakerColor }}
                      />
                      <span className="text-white text-sm">{speaker.speakerLabel}</span>
                    </div>
                    <span className="text-slate-400 text-sm">{count} turns</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
