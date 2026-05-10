import { useState, useEffect, useRef } from 'react';
import { Globe, Cpu, Sliders, Bell, Shield, Save, UserCheck, Upload, Trash2, Plus, Loader2, ShieldAlert } from 'lucide-react';
import { speakers, dangerousWords, type SpeakerRecord, type DangerousWordRecord } from '../lib/api';

export default function Settings({ isAdmin }: { isAdmin?: boolean }) {
  const [settings, setSettings] = useState({
    language: 'en',
    modelVersion: 'v3.2',
    speakerSimilarity: 75,
    confidenceThreshold: 60,
    autoProcessing: true,
    notifications: true,
    encryption: true,
  });

  const [knownSpeakers, setKnownSpeakers] = useState<SpeakerRecord[]>([]);
  const [speakersLoading, setSpeakersLoading] = useState(true);
  const [addName, setAddName] = useState('');
  const [addFile, setAddFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [flaggedWords, setFlaggedWords] = useState<DangerousWordRecord[]>([]);
  const [newWord, setNewWord] = useState('');
  const [newSeverity, setNewSeverity] = useState<'low' | 'medium' | 'high'>('high');
  const [addingWord, setAddingWord] = useState(false);
  const [wordError, setWordError] = useState('');
  const [removingWordIds, setRemovingWordIds] = useState<Set<number>>(new Set());

  const loadSpeakers = async () => {
    try {
      const all = await speakers.list();
      setKnownSpeakers(all.filter(s => s.sampleCount > 0));
    } catch { /* ignore */ }
    finally { setSpeakersLoading(false); }
  };

  useEffect(() => { loadSpeakers(); }, []);

  const loadWords = async () => {
    try { setFlaggedWords(await dangerousWords.list()); } catch { /* ignore */ }
  };

  useEffect(() => { if (isAdmin) loadWords(); }, [isAdmin]);

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

  const handleAddSpeaker = async () => {
    if (!addName.trim() || !addFile) return;
    setAdding(true); setAddError(''); setAddSuccess('');
    try {
      await speakers.enroll(addName.trim(), addFile);
      setAddSuccess(`"${addName.trim()}" registered successfully.`);
      setAddName(''); setAddFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadSpeakers();
    } catch (e: any) {
      setAddError(e.message ?? 'Failed to register speaker.');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteSpeaker = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await speakers.remove(id);
      await loadSpeakers();
    } catch { /* ignore */ }
    finally { setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const handleSave = () => alert('Settings saved successfully!');

  const cardCls = 'bg-zinc-900 border border-zinc-800 rounded-md';
  const inputCls = 'w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all';
  const selectCls = 'w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 appearance-none transition-all';

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <label className="relative inline-flex items-center cursor-pointer shrink-0">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
      <div className="w-9 h-5 bg-zinc-700 peer-focus:ring-1 peer-focus:ring-blue-500/40 rounded-full peer
        peer-checked:after:translate-x-full peer-checked:after:border-white
        after:content-[''] after:absolute after:top-[2px] after:left-[2px]
        after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all
        peer-checked:bg-blue-600" />
    </label>
  );

  const SectionHeader = ({ icon: Icon, iconColor, label }: { icon: any; iconColor: string; label: string }) => (
    <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-zinc-800">
      <Icon className={`w-4 h-4 ${iconColor}`} />
      <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">{label}</span>
    </div>
  );

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest mb-1">Configuration</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-zinc-500 text-sm mt-0.5">System preferences and model parameters</p>
      </div>

      <div className="max-w-3xl space-y-4">
        {/* Language */}
        <div className={cardCls}>
          <SectionHeader icon={Globe} iconColor="text-blue-400" label="Language" />
          <div className="p-5 space-y-4">
            <div>
              <label className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Primary Language</label>
              <select value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value })} className={selectCls}>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="ar">Arabic</option>
                <option value="zh">Chinese</option>
                <option value="ru">Russian</option>
              </select>
            </div>
            <div className="flex items-center justify-between p-3 bg-black border border-zinc-900 rounded">
              <div>
                <div className="text-zinc-300 text-sm">Multi-language Detection</div>
                <div className="text-zinc-600 text-xs mt-0.5">Detect and transcribe multiple languages automatically</div>
              </div>
              <Toggle checked={true} onChange={() => {}} />
            </div>
          </div>
        </div>

        {/* Model */}
        <div className={cardCls}>
          <SectionHeader icon={Cpu} iconColor="text-purple-400" label="Model Configuration" />
          <div className="p-5 space-y-4">
            <div>
              <label className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Model Version</label>
              <select value={settings.modelVersion} onChange={(e) => setSettings({ ...settings, modelVersion: e.target.value })} className={selectCls}>
                <option value="v3.2">v3.2 — Latest (Recommended)</option>
                <option value="v3.1">v3.1 — Stable</option>
                <option value="v3.0">v3.0 — Legacy</option>
              </select>
              <p className="text-zinc-600 text-xs font-mono mt-1.5">Improved speaker diarization and noise reduction</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[['Accuracy', '94.2%'], ['Processing Speed', '2.3×']].map(([label, val]) => (
                <div key={label} className="p-3 bg-black border border-zinc-900 rounded">
                  <div className="text-zinc-600 text-xs uppercase tracking-wider mb-1">{label}</div>
                  <div className="text-white text-xl font-bold font-mono">{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

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
                  <label className="text-zinc-400 text-sm">{label}</label>
                  <span className="text-white text-sm font-mono">
                    {settings[key as keyof typeof settings]}%
                  </span>
                </div>
                <input type="range" min={min} max={max}
                  value={settings[key as keyof typeof settings] as number}
                  onChange={(e) => setSettings({ ...settings, [key]: parseInt(e.target.value) })}
                  className="w-full h-1 rounded appearance-none cursor-pointer accent-blue-500 bg-zinc-800" />
                <p className="text-zinc-600 text-xs font-mono mt-1.5">{hint}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Preferences */}
        <div className={cardCls}>
          <SectionHeader icon={Bell} iconColor="text-amber-400" label="System Preferences" />
          <div className="p-5 space-y-3">
            {[
              { key: 'autoProcessing', label: 'Auto-processing', hint: 'Automatically process uploaded audio files' },
              { key: 'notifications',  label: 'Notifications',   hint: 'Alerts for completed analysis and matches' },
            ].map(({ key, label, hint }) => (
              <div key={key} className="flex items-center justify-between p-3 bg-black border border-zinc-900 rounded">
                <div>
                  <div className="text-zinc-300 text-sm">{label}</div>
                  <div className="text-zinc-600 text-xs mt-0.5">{hint}</div>
                </div>
                <Toggle
                  checked={settings[key as keyof typeof settings] as boolean}
                  onChange={(v) => setSettings({ ...settings, [key]: v })}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Security */}
        <div className={cardCls}>
          <SectionHeader icon={Shield} iconColor="text-emerald-400" label="Security" />
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between p-3 bg-black border border-zinc-900 rounded">
              <div>
                <div className="text-zinc-300 text-sm">End-to-end Encryption</div>
                <div className="text-zinc-600 text-xs mt-0.5">Encrypt all audio files and analysis data</div>
              </div>
              <Toggle checked={settings.encryption} onChange={(v) => setSettings({ ...settings, encryption: v })} />
            </div>
            <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded flex items-center gap-2.5">
              <Shield className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <p className="text-blue-300 text-xs">All data stored securely. Access is logged for audit purposes.</p>
            </div>
          </div>
        </div>

        {/* Known Speakers */}
        <div className={cardCls}>
          <SectionHeader icon={UserCheck} iconColor="text-emerald-400" label="Known Speakers" />
          <div className="p-5 space-y-4">
            <p className="text-zinc-500 text-xs">
              Register voice profiles so the system can identify people across recordings.
              Use a clean 10–30 second clip with only that person speaking.
            </p>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="Full name (e.g. Ofir)"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddSpeaker()}
                className={inputCls + ' flex-1'}
              />
              <label className="flex items-center gap-2 px-3 py-2.5 bg-black border border-zinc-800 hover:border-zinc-600 rounded text-zinc-400 cursor-pointer transition-colors text-xs shrink-0">
                <Upload className="w-3.5 h-3.5" />
                {addFile ? addFile.name.slice(0, 20) + (addFile.name.length > 20 ? '…' : '') : 'Choose audio'}
                <input ref={fileInputRef} type="file" accept="audio/*" className="hidden"
                  onChange={e => setAddFile(e.target.files?.[0] ?? null)} />
              </label>
              <button onClick={handleAddSpeaker} disabled={adding || !addName.trim() || !addFile}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded transition-colors shrink-0">
                {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Register
              </button>
            </div>

            {addSuccess && (
              <div className="px-3 py-2 bg-emerald-500/8 border border-emerald-500/25 rounded text-emerald-300 text-xs">{addSuccess}</div>
            )}
            {addError && (
              <div className="px-3 py-2 bg-red-500/8 border border-red-500/25 rounded text-red-400 text-xs">{addError}</div>
            )}

            {speakersLoading ? (
              <div className="flex items-center gap-2 text-zinc-600 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…</div>
            ) : knownSpeakers.length === 0 ? (
              <div className="text-zinc-700 text-xs font-mono py-4 text-center border border-dashed border-zinc-900 rounded">
                No voice profiles registered yet.
              </div>
            ) : (
              <div className="space-y-1.5">
                {knownSpeakers.map(spk => (
                  <div key={spk.id} className="flex items-center justify-between px-3 py-2.5 bg-black border border-zinc-900 rounded">
                    <div>
                      <span className={`text-sm ${spk.name.startsWith('speaker_') ? 'text-zinc-500 font-mono' : 'text-zinc-300'}`}>
                        {spk.name}
                      </span>
                      <span className="ml-2 text-zinc-700 text-xs font-mono">{spk.sampleCount} sample{spk.sampleCount !== 1 ? 's' : ''}</span>
                    </div>
                    <button onClick={() => handleDeleteSpeaker(spk.id)} disabled={deletingIds.has(spk.id)}
                      className="p-1 text-zinc-700 hover:text-red-400 disabled:opacity-40 transition-colors">
                      {deletingIds.has(spk.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Flagged Keywords — admin only */}
        {isAdmin && (
          <div className={cardCls}>
            <SectionHeader icon={ShieldAlert} iconColor="text-red-400" label="Flagged Keywords" />
            <div className="p-5 space-y-4">
              <p className="text-zinc-500 text-xs">
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
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded transition-colors shrink-0">
                  {addingWord ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Add
                </button>
              </div>

              {wordError && (
                <div className="px-3 py-2 bg-red-500/8 border border-red-500/25 rounded text-red-400 text-xs">{wordError}</div>
              )}

              {flaggedWords.length === 0 ? (
                <div className="text-zinc-700 text-xs font-mono py-4 text-center border border-dashed border-zinc-900 rounded">
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
                          className="p-1 text-zinc-700 hover:text-red-400 disabled:opacity-40 transition-colors">
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

        {/* Save */}
        <div className="flex justify-end gap-2">
          <button className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded transition-colors">
            Reset to Defaults
          </button>
          <button onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors">
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
