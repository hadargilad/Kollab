import React, { useState, useEffect } from 'react';
import { User, Shield, IdCard, Calendar, KeyRound, Save, X, Edit3, CheckCircle2 } from 'lucide-react';
import { profile as profileApi } from '../lib/api';
import type { AuthUser } from '../lib/api';

interface Props {
  currentUser: AuthUser | null;
  onUpdateSuccess: (updatedData: Partial<AuthUser>) => void;
}

export default function Profile({ currentUser, onUpdateSuccess }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ firstName: '', lastName: '', password: '', confirmPassword: '' });
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setFormData(prev => ({ ...prev, firstName: currentUser.firstName || '', lastName: currentUser.lastName || '' }));
    }
  }, [currentUser]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password && formData.password !== formData.confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match!' });
      return;
    }
    setIsLoading(true);
    try {
      const result = await profileApi.updateMe(currentUser!.id, formData.firstName, formData.lastName, formData.password || undefined);
      onUpdateSuccess({ firstName: result.firstName, lastName: result.lastName });
      setIsEditing(false);
      setFormData(prev => ({ ...prev, password: '', confirmPassword: '' }));
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message ?? 'Update failed.' });
    } finally {
      setIsLoading(false);
    }
  };

  const inputCls = 'w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all';

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Account</div>
          <h1 className="text-white text-2xl font-bold tracking-tight">My Profile</h1>
          <p className="text-zinc-300 text-sm mt-0.5">Personal information and security settings</p>
        </div>
        {!isEditing && (
          <button onClick={() => setIsEditing(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-md transition-colors">
            <Edit3 className="w-3.5 h-3.5" /> Edit Profile
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl">
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-5 text-center">
          <div className="w-16 h-16 bg-zinc-800 border border-zinc-700 rounded mx-auto mb-3 flex items-center justify-center text-white text-xl font-bold font-mono">
            {currentUser?.firstName?.charAt(0)}{currentUser?.lastName?.charAt(0)}
          </div>
          <div className="text-white font-semibold">{currentUser?.firstName} {currentUser?.lastName}</div>
          <div className="text-zinc-300 text-xs font-mono mt-0.5">@{currentUser?.username}</div>
          <div className="mt-4 pt-4 border-t border-zinc-800 space-y-2.5 text-left">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="text-zinc-200 font-mono uppercase tracking-wider text-[10px]">{currentUser?.role}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-zinc-300 text-xs font-mono">
                {currentUser?.createdAt
                  ? new Date(currentUser.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>

        <div className="md:col-span-2">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-md">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
                <IdCard className="w-4 h-4 text-blue-400" />
                <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Personal Details</span>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">First Name</label>
                    {isEditing ? (
                      <input className={inputCls} value={formData.firstName}
                        onChange={e => setFormData({ ...formData, firstName: e.target.value })} />
                    ) : (
                      <div className="text-white text-sm py-2.5 px-1">{currentUser?.firstName || '—'}</div>
                    )}
                  </div>
                  <div>
                    <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Last Name</label>
                    {isEditing ? (
                      <input className={inputCls} value={formData.lastName}
                        onChange={e => setFormData({ ...formData, lastName: e.target.value })} />
                    ) : (
                      <div className="text-white text-sm py-2.5 px-1">{currentUser?.lastName || '—'}</div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">ID Number</label>
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-black border border-zinc-900 rounded text-zinc-300 text-sm font-mono">
                    <Shield className="w-3.5 h-3.5 shrink-0" /> {currentUser?.idNumber}
                  </div>
                </div>
              </div>
            </div>

            {isEditing && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-md">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800">
                  <KeyRound className="w-4 h-4 text-amber-400" />
                  <span className="text-zinc-200 text-xs font-mono uppercase tracking-widest">Change Password</span>
                </div>
                <div className="p-5 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">New Password</label>
                    <input type="password" placeholder="Leave blank to keep current" className={inputCls}
                      value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Confirm Password</label>
                    <input type="password" className={inputCls}
                      value={formData.confirmPassword} onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            {message.text && (
              <div className={`flex items-center gap-2 px-3 py-2.5 rounded text-xs ${
                message.type === 'error'
                  ? 'bg-red-500/8 border border-red-500/25 text-red-400'
                  : 'bg-emerald-500/8 border border-emerald-500/25 text-emerald-300'
              }`}>
                {message.type === 'error'
                  ? <X className="w-3.5 h-3.5 shrink-0" />
                  : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                <span>{message.text}</span>
              </div>
            )}

            {isEditing && (
              <div className="flex gap-2">
                <button type="submit" disabled={isLoading}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-md font-medium transition-colors">
                  <Save className="w-4 h-4" /> {isLoading ? 'Saving…' : 'Save Changes'}
                </button>
                <button type="button" onClick={() => setIsEditing(false)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-md transition-colors">
                  <X className="w-4 h-4" /> Cancel
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
