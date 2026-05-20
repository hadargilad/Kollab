import { useState } from 'react';
import { Lock, ShieldCheck, AlertCircle } from 'lucide-react';
import { auth } from '../lib/api';

interface Props {
  user: { username: string };
  onSuccess: () => void;
}

export default function ForcePasswordChange({ user, onSuccess }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setError('');

    if (!passwordRegex.test(newPassword)) {
      setError('Password does not meet security requirements.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      await auth.changePassword(user.username, newPassword);
      onSuccess();
    } catch (err: any) {
      setError(err.message ?? 'Failed to update password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const checks = [
    { label: 'At least 8 characters', ok: newPassword.length >= 8 },
    { label: 'Uppercase & lowercase letters', ok: /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) },
    { label: 'At least one number', ok: /\d/.test(newPassword) },
    { label: 'Special character (@$!%*?&)', ok: /[@$!%*?&]/.test(newPassword) },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center p-4">
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative bg-zinc-950 border border-zinc-800 rounded-md w-full max-w-sm p-6 shadow-2xl">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/25 rounded flex items-center justify-center mb-4">
            <ShieldCheck className="w-6 h-6 text-blue-400" />
          </div>
          <h2 className="text-white font-bold text-lg">Security Update Required</h2>
          <p className="text-zinc-300 text-xs font-mono mt-1.5">
            First login detected — set a new secure password to continue, {user.username}.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-zinc-300 text-[10px] font-mono uppercase tracking-widest block mb-1.5">
              New Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-200" />
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded px-3 pl-9 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="text-zinc-300 text-[10px] font-mono uppercase tracking-widest block mb-1.5">
              Confirm Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-200" />
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded px-3 pl-9 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
              />
            </div>
          </div>

          {/* Requirements */}
          <div className="bg-black border border-zinc-900 rounded p-3 space-y-1">
            {checks.map((c) => (
              <div key={c.label} className="flex items-center gap-2 text-xs font-mono">
                <span className={c.ok ? 'text-emerald-400' : 'text-zinc-300'}>
                  {c.ok ? '✓' : '○'}
                </span>
                <span className={c.ok ? 'text-zinc-200' : 'text-zinc-200'}>{c.label}</span>
              </div>
            ))}
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-500/8 border border-red-500/25 rounded px-3 py-2.5 text-red-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded text-sm transition-all active:scale-[0.98]"
          >
            {isLoading ? 'Updating…' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
