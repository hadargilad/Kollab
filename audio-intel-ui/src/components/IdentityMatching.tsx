import { useState } from 'react';
import { Upload, Search, Check, X, AlertCircle } from 'lucide-react';

interface Match {
  id: string;
  name: string;
  confidence: number;
  source: string;
  lastSeen: string;
  details: { age?: string; location?: string; occupation?: string };
}

const mockMatches: Match[] = [
  { id: 'M-001', name: 'John Anderson', confidence: 87, source: 'Database Alpha', lastSeen: '2025-12-15',
    details: { age: '35-40', location: 'Regional Office', occupation: 'Operations Manager' } },
  { id: 'M-002', name: 'Michael Roberts', confidence: 72, source: 'Social Network Analysis', lastSeen: '2025-11-28',
    details: { age: '30-35', location: 'Sector 7', occupation: 'Logistics Coordinator' } },
  { id: 'M-003', name: 'James Mitchell', confidence: 65, source: 'External Database', lastSeen: '2025-10-12',
    details: { age: '40-45', location: 'Unknown', occupation: 'Consultant' } },
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
    setTimeout(() => { setMatches(mockMatches); setIsAnalyzing(false); setShowResults(true); }, 2000);
  };

  const getConfidenceCls = (c: number) =>
    c >= 80 ? 'text-emerald-400' : c >= 60 ? 'text-amber-400' : 'text-red-400';

  const getConfidenceBorder = (c: number) =>
    c >= 80 ? 'border-l-emerald-500' : c >= 60 ? 'border-l-amber-500' : 'border-l-red-500';

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest mb-1">Analysis</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Identity Matching</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Match voice samples with known identities</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
              <Upload className="w-4 h-4 text-blue-400" />
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Voice Sample</span>
            </div>
            <div className="p-5">
              <div className="border-2 border-dashed border-zinc-800 hover:border-zinc-600 rounded-md p-8 text-center mb-4 transition-colors">
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 bg-zinc-800 border border-zinc-700 rounded-md flex items-center justify-center mb-4">
                    <Upload className="w-5 h-5 text-zinc-500" />
                  </div>
                  {selectedFile ? (
                    <>
                      <p className="text-white text-sm font-medium mb-1">{selectedFile.name}</p>
                      <p className="text-zinc-600 text-xs font-mono">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </>
                  ) : (
                    <>
                      <p className="text-zinc-400 text-sm mb-1">Drop voice sample here</p>
                      <p className="text-zinc-700 text-xs font-mono">MP3 · WAV · M4A</p>
                    </>
                  )}
                  <label className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded cursor-pointer transition-colors">
                    {selectedFile ? 'Change File' : 'Select File'}
                    <input type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={handleFileSelect} className="hidden" />
                  </label>
                </div>
              </div>

              {selectedFile && !showResults && (
                <button onClick={handleAnalyze} disabled={isAnalyzing}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm rounded transition-colors flex items-center justify-center gap-2">
                  {isAnalyzing ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Analyzing…</>
                  ) : (
                    <><Search className="w-4 h-4" /> Start Identity Match</>
                  )}
                </button>
              )}
            </div>
          </div>

          {showResults && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-md">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
                <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Match Results</span>
                <span className="text-zinc-600 text-xs font-mono">{matches.length} candidates</span>
              </div>
              <div className="divide-y divide-zinc-800">
                {matches.map((match, i) => (
                  <div key={match.id} className={`px-5 py-4 border-l-2 ${getConfidenceBorder(match.confidence)}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-zinc-600 text-xs font-mono">#{i + 1}</span>
                          <span className="text-white text-sm font-medium">{match.name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono text-zinc-600">
                          <span>{match.id}</span>
                          <span>·</span>
                          <span>{match.source}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold font-mono ${getConfidenceCls(match.confidence)}`}>{match.confidence}%</div>
                        <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-wider">Confidence</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {match.details.age && (
                        <div className="bg-black border border-zinc-900 rounded px-2.5 py-2">
                          <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-wider mb-0.5">Age Range</div>
                          <div className="text-zinc-300 text-xs font-mono">{match.details.age}</div>
                        </div>
                      )}
                      {match.details.location && (
                        <div className="bg-black border border-zinc-900 rounded px-2.5 py-2">
                          <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-wider mb-0.5">Location</div>
                          <div className="text-zinc-300 text-xs font-mono">{match.details.location}</div>
                        </div>
                      )}
                      {match.details.occupation && (
                        <div className="bg-black border border-zinc-900 rounded px-2.5 py-2">
                          <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-wider mb-0.5">Occupation</div>
                          <div className="text-zinc-300 text-xs font-mono">{match.details.occupation}</div>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button className="flex-1 py-2 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-600/30 text-emerald-300 text-xs rounded flex items-center justify-center gap-1.5 transition-colors">
                        <Check className="w-3.5 h-3.5" /> Confirm Match
                      </button>
                      <button className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded flex items-center justify-center gap-1.5 transition-colors">
                        <X className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
              <AlertCircle className="w-4 h-4 text-blue-400" />
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">How It Works</span>
            </div>
            <div className="p-5 space-y-2 text-zinc-500 text-xs font-mono">
              {[
                '1. Upload a clear voice sample (min 5s)',
                '2. AI analyzes voice characteristics',
                '3. System queries registered profiles',
                '4. Results ranked by confidence',
                '5. Confirm or reject each match',
              ].map(t => <p key={t}>{t}</p>)}
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Confidence Levels</span>
            </div>
            <div className="p-5 space-y-2">
              {[
                { label: 'HIGH MATCH', range: '≥ 80%', cls: 'text-emerald-400 border-emerald-500/25 bg-emerald-500/8' },
                { label: 'MEDIUM',    range: '60–79%', cls: 'text-amber-400 border-amber-500/25 bg-amber-500/8' },
                { label: 'LOW',       range: '< 60%',  cls: 'text-red-400 border-red-500/25 bg-red-500/8' },
              ].map(({ label, range, cls }) => (
                <div key={label} className={`flex items-center justify-between px-3 py-2 rounded border text-xs font-mono ${cls}`}>
                  <span>{label}</span><span>{range}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">Database Stats</span>
            </div>
            <div className="p-5 space-y-3">
              {[['Total Profiles', '12,847'], ['Voice Samples', '34,562'], ['Confirmed Matches', '1,234'], ['Avg Match Time', '2.4s']].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-zinc-600 text-xs uppercase tracking-wider">{label}</span>
                  <span className="text-zinc-300 text-xs font-mono">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
