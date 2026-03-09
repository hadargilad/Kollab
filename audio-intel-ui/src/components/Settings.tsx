import { useState } from 'react';
import { Settings as SettingsIcon, Globe, Cpu, Sliders, Bell, Shield, Save } from 'lucide-react';

export default function Settings() {
  const [settings, setSettings] = useState({
    language: 'en',
    modelVersion: 'v3.2',
    speakerSimilarity: 75,
    confidenceThreshold: 60,
    autoProcessing: true,
    notifications: true,
    encryption: true,
  });

  const handleSave = () => {
    // Mock save
    alert('Settings saved successfully!');
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Settings</h1>
        <p className="text-slate-400">Configure system preferences and model parameters</p>
      </div>

      <div className="max-w-4xl space-y-6">
        {/* Language Settings */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <Globe className="w-6 h-6 text-blue-500" />
            <h2 className="text-white text-xl">Language Settings</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-slate-300 mb-2">Primary Language</label>
              <select
                value={settings.language}
                onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="ar">Arabic</option>
                <option value="zh">Chinese</option>
                <option value="ru">Russian</option>
              </select>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
              <div>
                <div className="text-white mb-1">Multi-language Detection</div>
                <div className="text-slate-400 text-sm">Automatically detect and transcribe multiple languages</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-700 peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Model Configuration */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <Cpu className="w-6 h-6 text-purple-500" />
            <h2 className="text-white text-xl">Model Configuration</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-slate-300 mb-2">Model Version</label>
              <select
                value={settings.modelVersion}
                onChange={(e) => setSettings({ ...settings, modelVersion: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="v3.2">v3.2 (Latest - Recommended)</option>
                <option value="v3.1">v3.1 (Stable)</option>
                <option value="v3.0">v3.0 (Legacy)</option>
              </select>
              <p className="text-slate-400 text-sm mt-2">
                Latest model includes improved speaker diarization and noise reduction
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-800 rounded-lg">
                <div className="text-slate-400 text-sm mb-2">Accuracy</div>
                <div className="text-white text-2xl">94.2%</div>
              </div>
              <div className="p-4 bg-slate-800 rounded-lg">
                <div className="text-slate-400 text-sm mb-2">Processing Speed</div>
                <div className="text-white text-2xl">2.3x</div>
              </div>
            </div>
          </div>
        </div>

        {/* Threshold Settings */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <Sliders className="w-6 h-6 text-cyan-500" />
            <h2 className="text-white text-xl">Threshold Settings</h2>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-slate-300">Speaker Similarity Threshold</label>
                <span className="text-white">{settings.speakerSimilarity}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="95"
                value={settings.speakerSimilarity}
                onChange={(e) => setSettings({ ...settings, speakerSimilarity: parseInt(e.target.value) })}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <p className="text-slate-400 text-sm mt-2">
                Higher values require stronger voice matches for speaker identification
              </p>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <label className="text-slate-300">Confidence Threshold</label>
                <span className="text-white">{settings.confidenceThreshold}%</span>
              </div>
              <input
                type="range"
                min="40"
                max="90"
                value={settings.confidenceThreshold}
                onChange={(e) => setSettings({ ...settings, confidenceThreshold: parseInt(e.target.value) })}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <p className="text-slate-400 text-sm mt-2">
                Minimum confidence score required for identity matches
              </p>
            </div>
          </div>
        </div>

        {/* System Preferences */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <Bell className="w-6 h-6 text-yellow-500" />
            <h2 className="text-white text-xl">System Preferences</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
              <div>
                <div className="text-white mb-1">Auto-processing</div>
                <div className="text-slate-400 text-sm">Automatically process uploaded audio files</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoProcessing}
                  onChange={(e) => setSettings({ ...settings, autoProcessing: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
              <div>
                <div className="text-white mb-1">Notifications</div>
                <div className="text-slate-400 text-sm">Receive alerts for completed analysis and matches</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.notifications}
                  onChange={(e) => setSettings({ ...settings, notifications: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-6 h-6 text-green-500" />
            <h2 className="text-white text-xl">Security</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
              <div>
                <div className="text-white mb-1">End-to-end Encryption</div>
                <div className="text-slate-400 text-sm">Encrypt all audio files and analysis data</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.encryption}
                  onChange={(e) => setSettings({ ...settings, encryption: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="p-4 bg-blue-600/10 border border-blue-600/30 rounded-lg">
              <p className="text-blue-300 text-sm">
                <Shield className="w-4 h-4 inline mr-2" />
                All data is stored securely and access is logged for audit purposes
              </p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end gap-4">
          <button className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors">
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            <Save className="w-5 h-5" />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
