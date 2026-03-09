import { useState } from 'react';
import { Upload, Search, Check, X, AlertCircle } from 'lucide-react';

interface Match {
  id: string;
  name: string;
  confidence: number;
  source: string;
  lastSeen: string;
  details: {
    age?: string;
    location?: string;
    occupation?: string;
  };
}

const mockMatches: Match[] = [
  {
    id: 'M-001',
    name: 'John Anderson',
    confidence: 87,
    source: 'Database Alpha',
    lastSeen: '2025-12-15',
    details: {
      age: '35-40',
      location: 'Regional Office',
      occupation: 'Operations Manager',
    },
  },
  {
    id: 'M-002',
    name: 'Michael Roberts',
    confidence: 72,
    source: 'Social Network Analysis',
    lastSeen: '2025-11-28',
    details: {
      age: '30-35',
      location: 'Sector 7',
      occupation: 'Logistics Coordinator',
    },
  },
  {
    id: 'M-003',
    name: 'James Mitchell',
    confidence: 65,
    source: 'External Database',
    lastSeen: '2025-10-12',
    details: {
      age: '40-45',
      location: 'Unknown',
      occupation: 'Consultant',
    },
  },
];

export default function IdentityMatching() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [showResults, setShowResults] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setShowResults(false);
    }
  };

  const handleAnalyze = () => {
    if (!selectedFile) return;
    
    setIsAnalyzing(true);
    // Simulate analysis
    setTimeout(() => {
      setMatches(mockMatches);
      setIsAnalyzing(false);
      setShowResults(true);
    }, 2000);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-500';
    if (confidence >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getConfidenceBg = (confidence: number) => {
    if (confidence >= 80) return 'bg-green-600/10 border-green-600/30';
    if (confidence >= 60) return 'bg-yellow-600/10 border-yellow-600/30';
    return 'bg-red-600/10 border-red-600/30';
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Identity Matching</h1>
        <p className="text-slate-400">Match voice samples with known identities</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Section */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h2 className="text-white mb-4">Upload Voice Sample</h2>
            
            <div className="border-2 border-dashed border-slate-700 rounded-lg p-8 text-center mb-6">
              <div className="flex flex-col items-center">
                <div className="bg-blue-600/10 p-4 rounded-full mb-4">
                  <Upload className="w-8 h-8 text-blue-500" />
                </div>
                {selectedFile ? (
                  <div>
                    <p className="text-white mb-2">{selectedFile.name}</p>
                    <p className="text-slate-400 text-sm mb-4">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                ) : (
                  <>
                    <h3 className="text-white mb-2">Drop voice sample here</h3>
                    <p className="text-slate-400 mb-4">or click to browse</p>
                  </>
                )}
                <label className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg cursor-pointer transition-colors">
                  {selectedFile ? 'Change File' : 'Select File'}
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {selectedFile && !showResults && (
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-700 text-white py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Analyzing Voice Pattern...
                  </>
                ) : (
                  <>
                    <Search className="w-5 h-5" />
                    Start Identity Match
                  </>
                )}
              </button>
            )}
          </div>

          {/* Results */}
          {showResults && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-white">Match Results</h2>
                <span className="text-slate-400 text-sm">{matches.length} potential matches found</span>
              </div>

              <div className="space-y-4">
                {matches.map((match, index) => (
                  <div
                    key={match.id}
                    className={`border rounded-lg p-6 ${getConfidenceBg(match.confidence)}`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-slate-400 text-sm">#{index + 1}</span>
                          <h3 className="text-white text-xl">{match.name}</h3>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-slate-400">ID: {match.id}</span>
                          <span className="text-slate-400">Source: {match.source}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-3xl mb-1 ${getConfidenceColor(match.confidence)}`}>
                          {match.confidence}%
                        </div>
                        <div className="text-slate-400 text-sm">Confidence</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-4">
                      {match.details.age && (
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Age Range</div>
                          <div className="text-white text-sm">{match.details.age}</div>
                        </div>
                      )}
                      {match.details.location && (
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Location</div>
                          <div className="text-white text-sm">{match.details.location}</div>
                        </div>
                      )}
                      {match.details.occupation && (
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Occupation</div>
                          <div className="text-white text-sm">{match.details.occupation}</div>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3">
                      <button className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors">
                        <Check className="w-4 h-4" />
                        Confirm Match
                      </button>
                      <button className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center justify-center gap-2 transition-colors">
                        <X className="w-4 h-4" />
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Info */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="w-5 h-5 text-blue-500" />
              <h3 className="text-white">How It Works</h3>
            </div>
            <div className="space-y-3 text-slate-300 text-sm">
              <p>1. Upload a clear voice sample (minimum 5 seconds)</p>
              <p>2. Our AI analyzes voice characteristics and patterns</p>
              <p>3. System searches across multiple databases</p>
              <p>4. Review matches ranked by confidence score</p>
              <p>5. Confirm or reject each match</p>
            </div>
          </div>

          {/* Confidence Guide */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Confidence Levels</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-green-600/10 flex items-center justify-center">
                  <span className="text-green-500">80+</span>
                </div>
                <div>
                  <div className="text-white text-sm">High Match</div>
                  <div className="text-slate-400 text-xs">Likely correct identity</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-yellow-600/10 flex items-center justify-center">
                  <span className="text-yellow-500">60+</span>
                </div>
                <div>
                  <div className="text-white text-sm">Medium Match</div>
                  <div className="text-slate-400 text-xs">Requires verification</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-red-600/10 flex items-center justify-center">
                  <span className="text-red-500">&lt;60</span>
                </div>
                <div>
                  <div className="text-white text-sm">Low Match</div>
                  <div className="text-slate-400 text-xs">Unlikely match</div>
                </div>
              </div>
            </div>
          </div>

          {/* Statistics */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Database Statistics</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Total Profiles</span>
                <span className="text-white">12,847</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Voice Samples</span>
                <span className="text-white">34,562</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Confirmed Matches</span>
                <span className="text-white">1,234</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Avg Match Time</span>
                <span className="text-white">2.4s</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
