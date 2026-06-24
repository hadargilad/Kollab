import { useState, useEffect } from 'react';
import { Sliders, Save, Trash2, Plus, Loader2, ShieldAlert, Sparkles, Eye, X } from 'lucide-react';
import { dangerousWords, euphemisms, type DangerousWordRecord, type EuphemismRecord } from '../lib/api';

export default function Settings({ isAdmin }: { isAdmin?: boolean }) {
  const [settings, setSettings] = useState({
    speakerSimilarity: 75,
    confidenceThreshold: 60,
  });

  const [flaggedWords, setFlaggedWords] = useState<DangerousWordRecord[]>([]);
  const [newWord, setNewWord] = useState('');
  const [newSeverity, setNewSeverity] = useState<'low' | 'medium' | 'high'>('high');
  const [addingWord, setAddingWord] = useState(false);
  const [wordError, setWordError] = useState('');
  const [removingWordIds, setRemovingWordIds] = useState<Set<number>>(new Set());

  const [allEuphList, setAllEuphList] = useState<EuphemismRecord[]>([]);
  const [newEuph, setNewEuph] = useState('');
  const [newEuphSeverity, setNewEuphSeverity] = useState<'low' | 'medium' | 'high'>('high');
  const [addingEuph, setAddingEuph] = useState(false);
  const [euphError, setEuphError] = useState('');
  const [removingEuphIds, setRemovingEuphIds] = useState<Set<number>>(new Set());
  const [showBuiltInModal, setShowBuiltInModal] = useState(false);
  const euphList = allEuphList.filter(e => e.createdBy != null);
  const builtInEuphList = allEuphList.filter(e => e.createdBy == null);

  const loadWords = async () => {
    try { setFlaggedWords(await dangerousWords.list()); } catch { /* ignore */ }
  };

  useEffect(() => { if (isAdmin) loadWords(); }, [isAdmin]);

  const loadEuphemisms = async () => {
    try {
      // Keep the full list — user-added shows in the main UI; built-in seeds
      // + auto-mined entries are exposed via the "View built-in" modal so the
      // detector inventory is reachable without cluttering Settings.
      setAllEuphList(await euphemisms.list());
    } catch { /* ignore */ }
  };

  useEffect(() => { if (isAdmin) loadEuphemisms(); }, [isAdmin]);

  const handleAddEuph = async () => {
    if (!newEuph.trim()) return;
    setAddingEuph(true); setEuphError('');
    try {
      await euphemisms.add(newEuph.trim(), newEuphSeverity);
      setNewEuph('');
      await loadEuphemisms();
    } catch (e: any) {
      setEuphError(e.message ?? 'Failed to add euphemism.');
    } finally { setAddingEuph(false); }
  };

  const handleRemoveEuph = async (id: number) => {
    setRemovingEuphIds(prev => new Set(prev).add(id));
    try { await euphemisms.remove(id); await loadEuphemisms(); } catch { /* ignore */ }
    finally { setRemovingEuphIds(prev => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const handleAddWord = async () => {
    if (!newWord.trim()) return;
    setAddingWord(true); setWordError('');
    try {
      await dangerousWords.add(newWord.trim(), newSeverity);
      setNewWord('');
      await loadWords();
    } catch (e: any) {
      setWordError(e.message ?? 'Failed to add word.');
    } finally { setAddingWord(false); }
  };

  const handleRemoveWord = async (id: number) => {
    setRemovingWordIds(prev => new Set(prev).add(id));
    try { await dangerousWords.remove(id); await loadWords(); } catch { /* ignore */ }
    finally { setRemovingWordIds(prev => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const handleSave = () => alert('Settings saved successfully!');

  const cardCls = 'bg-zinc-900 border border-zinc-800 rounded-md';
  const inputCls = 'w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all';

  const SectionHeader = ({ icon: Icon, iconColor, label }: { icon: any; iconColor: string; label: string }) => (
    <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-zinc-800">
      <Icon className={`w-4 h-4 ${iconColor}`} />
      <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">{label}</span>
    </div>
  );

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Configuration</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-zinc-300 text-sm mt-0.5">System preferences and model parameters</p>
      </div>

      <div className="max-w-3xl space-y-4">
        {/* Thresholds */}
        <div className={cardCls}>
          <SectionHeader icon={Sliders} iconColor="text-cyan-400" label="Threshold Settings" />
          <div className="p-5 space-y-5">
            {[
              { key: 'speakerSimilarity', label: 'Speaker Similarity', min: 50, max: 95, hint: 'Higher values require stronger voice matches' },
              { key: 'confidenceThreshold', label: 'Confidence Threshold', min: 40, max: 90, hint: 'Minimum score for identity matches' },
            ].map(({ key, label, min, max, hint }) => (
              <div key={key}>
                <div className="flex justify-between mb-2">
                  <label className="text-zinc-200 text-sm">{label}</label>
                  <span className="text-white text-sm font-mono">
                    {settings[key as keyof typeof settings]}%
                  </span>
                </div>
                <input type="range" min={min} max={max}
                  value={settings[key as keyof typeof settings] as number}
                  onChange={(e) => setSettings({ ...settings, [key]: parseInt(e.target.value) })}
                  className="w-full h-1 rounded appearance-none cursor-pointer accent-blue-500 bg-zinc-800" />
                <p className="text-zinc-200 text-xs font-mono mt-1.5">{hint}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Flagged Keywords — admin only */}
        {isAdmin && (
          <div className={cardCls}>
            <SectionHeader icon={ShieldAlert} iconColor="text-red-400" label="Flagged Keywords" />
            <div className="p-5 space-y-4">
              <p className="text-zinc-300 text-xs">
                Words that trigger an alert when detected in any audio transcript. Case-insensitive.
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Keyword…"
                  value={newWord}
                  onChange={e => setNewWord(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddWord()}
                  className={inputCls + ' flex-1'}
                />
                <select value={newSeverity} onChange={e => setNewSeverity(e.target.value as 'low' | 'medium' | 'high')}
                  className="bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 appearance-none transition-all">
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <button onClick={handleAddWord} disabled={addingWord || !newWord.trim()}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-md transition-colors shrink-0">
                  {addingWord ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Add
                </button>
              </div>

              {wordError && (
                <div className="px-3 py-2 bg-red-500/8 border border-red-500/25 rounded text-red-400 text-xs">{wordError}</div>
              )}

              {flaggedWords.length === 0 ? (
                <div className="text-zinc-300 text-xs font-mono py-4 text-center border border-dashed border-zinc-900 rounded">
                  No flagged keywords defined.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {flaggedWords.map(w => {
                    const severityCls = w.severity === 'high'
                      ? 'text-red-400 bg-red-500/10 border-red-500/25'
                      : w.severity === 'medium'
                        ? 'text-amber-400 bg-amber-500/10 border-amber-500/25'
                        : 'text-blue-400 bg-blue-500/10 border-blue-500/25';
                    return (
                      <div key={w.id} className="flex items-center justify-between px-3 py-2.5 bg-black border border-zinc-900 rounded">
                        <div className="flex items-center gap-3">
                          <span className="text-zinc-300 text-sm font-mono">{w.word}</span>
                          <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${severityCls}`}>
                            {w.severity}
                          </span>
                        </div>
                        <button onClick={() => handleRemoveWord(w.id)} disabled={removingWordIds.has(w.id)}
                          className="p-1 text-zinc-300 hover:text-red-400 disabled:opacity-40 transition-colors">
                          {removingWordIds.has(w.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Euphemism Dictionary — admin only */}
        {isAdmin && (
          <div className={cardCls}>
            <SectionHeader icon={Sparkles} iconColor="text-amber-400" label="Coded-Language Phrases" />
            <div className="p-5 space-y-4">
              <p className="text-zinc-300 text-xs">
                Suspicious phrases used as a hint for the coded-language detector. Any segment whose
                meaning is close to one of these phrases gets flagged. Add a phrase below to teach
                the system a new one.
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Phrase or short expression…"
                  value={newEuph}
                  onChange={e => setNewEuph(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddEuph()}
                  className={inputCls + ' flex-1'}
                />
                <select value={newEuphSeverity} onChange={e => setNewEuphSeverity(e.target.value as 'low' | 'medium' | 'high')}
                  className="bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 appearance-none transition-all">
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <button onClick={handleAddEuph} disabled={addingEuph || !newEuph.trim()}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-md transition-colors shrink-0">
                  {addingEuph ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Add
                </button>
                <button onClick={handleExpandEuph} disabled={expanding}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 text-sm rounded-md transition-colors shrink-0">
                  {expanding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Expand
                </button>
                <button
                  type="button"
                  onClick={() => setShowBuiltInModal(true)}
                  disabled={builtInEuphList.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 text-sm rounded-md transition-colors shrink-0"
                >
                  <Eye className="w-3.5 h-3.5" />
                  View built-in ({builtInEuphList.length})
                </button>
              </div>

              {euphError && (
                <div className="px-3 py-2 bg-red-500/8 border border-red-500/25 rounded text-red-400 text-xs">{euphError}</div>
              )}

              {euphList.length > 0 && (
                <div className="space-y-1.5 max-h-105 overflow-y-auto pr-1">
                  {euphList.map(e => {
                    const severityCls = e.severity === 'high'
                      ? 'text-red-400 bg-red-500/10 border-red-500/25'
                      : e.severity === 'medium'
                        ? 'text-amber-400 bg-amber-500/10 border-amber-500/25'
                        : 'text-blue-400 bg-blue-500/10 border-blue-500/25';
                    return (
                      <div key={e.id} className="flex items-center justify-between px-3 py-2.5 bg-black border border-zinc-900 rounded">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-zinc-300 text-sm font-mono truncate">{e.phrase}</span>
                          <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${severityCls}`}>
                            {e.severity}
                          </span>
                          {e.confidence != null && (
                            <span className="text-[10px] font-mono text-zinc-200 shrink-0">
                              {Math.round(e.confidence * 100)}%
                            </span>
                          )}
                        </div>
                        <button onClick={() => handleRemoveEuph(e.id)} disabled={removingEuphIds.has(e.id)}
                          className="p-1 text-zinc-300 hover:text-red-400 disabled:opacity-40 transition-colors">
                          {removingEuphIds.has(e.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Save */}
        <div className="flex justify-end gap-2">
          <button className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-md transition-colors">
            Reset to Defaults
          </button>
          <button onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors">
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </div>

      {showBuiltInModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowBuiltInModal(false)}
        >
          <div
            className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="text-white text-sm font-medium">Built-in Coded-Language Phrases</span>
                <span className="text-zinc-300 text-[10px] font-mono uppercase tracking-widest">
                  {builtInEuphList.length}
                </span>
              </div>
              <button
                onClick={() => setShowBuiltInModal(false)}
                className="p-1 text-zinc-300 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 pt-3 pb-2">
              <p className="text-zinc-300 text-xs">
                These phrases are seeded by the system. They stay active for the detector even if removed from the visible list above.
              </p>
            </div>
            <div className="px-5 pb-5 overflow-y-auto space-y-1.5">
              {builtInEuphList.map(e => {
                const severityCls = e.severity === 'high'
                  ? 'text-red-400 bg-red-500/10 border-red-500/25'
                  : e.severity === 'medium'
                    ? 'text-amber-400 bg-amber-500/10 border-amber-500/25'
                    : 'text-blue-400 bg-blue-500/10 border-blue-500/25';
                return (
                  <div key={e.id} className="flex items-center justify-between px-3 py-2.5 bg-black border border-zinc-900 rounded">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-zinc-300 text-sm font-mono truncate">{e.phrase}</span>
                      <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${severityCls}`}>
                        {e.severity}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveEuph(e.id)}
                      disabled={removingEuphIds.has(e.id)}
                      className="p-1 text-zinc-300 hover:text-red-400 disabled:opacity-40 transition-colors"
                    >
                      {removingEuphIds.has(e.id)
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
