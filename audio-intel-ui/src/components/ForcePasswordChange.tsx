import React, { useState } from 'react';
import { Lock, ShieldCheck, AlertCircle } from 'lucide-react';

interface Props {
  user: { username: string };
  onSuccess: () => void;
}

export default function ForcePasswordChange({ user, onSuccess }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!passwordRegex.test(newPassword)) {
      setError("Password does not meet security requirements.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    // Send to C# to update the password and flip the ForceChange flag
    const request = {
      type: 'UPDATE_USER_PASSWORD',
      payload: {
        username: user.username,
        newPassword: newPassword
      }
    };
    document.title = "JSON:" + JSON.stringify(request);

    // We'll listen for a success message from C# to call onSuccess()
    // For now, let's assume success for the UI flow
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-md w-full shadow-2xl">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 bg-blue-600/10 rounded-full flex items-center justify-center mb-4">
            <ShieldCheck className="w-8 h-8 text-blue-500" />
          </div>
          <h2 className="text-2xl font-bold text-white">Security Update Required</h2>
          <p className="text-slate-400 mt-2">
            This is your first login, {user.username}. For your protection, you must choose a new secure password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase">New Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 pl-10 text-white outline-none focus:ring-2 focus:ring-blue-600 transition-all"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase">Confirm Password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-blue-600 transition-all"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <ul className="text-[10px] text-slate-500 space-y-1 px-1">
            <li className={newPassword.length >= 8 ? "text-green-500" : ""}>• At least 8 characters</li>
            <li className={/[A-Z]/.test(newPassword) ? "text-green-500" : ""}>• Uppercase & lowercase letters</li>
            <li className={/\d/.test(newPassword) ? "text-green-500" : ""}>• At least one number</li>
            <li className={/[@$!%*?&]/.test(newPassword) ? "text-green-500" : ""}>• Special character (@$!%*?&)</li>
          </ul>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl mt-4 transition-all active:scale-[0.98] shadow-lg shadow-blue-600/20"
          >
            Update Password & Continue
          </button>
        </form>
      </div>
    </div>
  );
}