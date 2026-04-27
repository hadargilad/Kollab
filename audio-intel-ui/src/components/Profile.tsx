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
      const result = await profileApi.updateMe(
        currentUser!.id,
        formData.firstName,
        formData.lastName,
        formData.password || undefined,
      );
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

  return (
    <div className="max-w-4xl mx-auto p-8 animate-in fade-in duration-500 text-white">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <User className="text-blue-500 w-8 h-8" /> My Profile
          </h1>
          <p className="text-slate-400 mt-1">Manage your personal information and security</p>
        </div>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-xl transition-all border border-slate-700"
          >
            <Edit3 className="w-4 h-4" /> Edit Profile
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left: Quick Stats */}
        <div className="md:col-span-1 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center shadow-xl">
            <div className="w-24 h-24 bg-linear-to-br from-blue-600 to-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl font-bold text-white shadow-lg shadow-blue-500/20">
              {currentUser?.firstName?.charAt(0)}{currentUser?.lastName?.charAt(0)}
            </div>
            <h2 className="text-xl font-bold text-white">{currentUser?.firstName} {currentUser?.lastName}</h2>
            <p className="text-blue-400 text-sm font-medium uppercase tracking-wider mt-1">@{currentUser?.username}</p>

            <div className="mt-6 pt-6 border-t border-slate-800 space-y-4">
              <div className="flex items-center gap-3 text-slate-400 text-sm justify-start">
                <Shield className="w-4 h-4 text-purple-500" />
                <span>Role: <strong>{currentUser?.role}</strong></span>
              </div>
              <div className="flex items-center gap-3 text-slate-400 text-sm justify-start">
                <Calendar className="w-4 h-4 text-emerald-500" />
                <span>Member since: {currentUser?.createdAt ? new Date(currentUser.createdAt).toLocaleDateString() : 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Form */}
        <div className="md:col-span-2">
          <form onSubmit={handleSave} className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
              <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                <IdCard className="text-blue-500 w-5 h-5" /> Personal Details
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase">First Name</label>
                  {isEditing ? (
                    <input
                      className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-white outline-none focus:border-blue-500 transition-all"
                      value={formData.firstName}
                      onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                    />
                  ) : (
                    <div className="text-white text-lg font-medium p-1">{currentUser?.firstName || 'Not Set'}</div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase">Last Name</label>
                  {isEditing ? (
                    <input
                      className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-white outline-none focus:border-blue-500 transition-all"
                      value={formData.lastName}
                      onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                    />
                  ) : (
                    <div className="text-white text-lg font-medium p-1">{currentUser?.lastName || 'Not Set'}</div>
                  )}
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-black text-slate-500 uppercase">ID Number</label>
                  <div className="w-full bg-slate-800/30 border border-slate-800 p-3 rounded-xl text-slate-500 flex items-center gap-2">
                    <Shield className="w-4 h-4" /> {currentUser?.idNumber}
                  </div>
                </div>
              </div>

              {isEditing && (
                <div className="mt-10 pt-8 border-t border-slate-800 space-y-6 animate-in slide-in-from-top-4">
                  <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                    <KeyRound className="text-orange-500 w-5 h-5" /> Change Password
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-500 uppercase ml-1">New Password</label>
                      <input
                        type="password"
                        placeholder="Leave blank to keep current"
                        className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-white outline-none focus:border-blue-500 transition-all"
                        value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-500 uppercase ml-1">Confirm Password</label>
                      <input
                        type="password"
                        className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-white outline-none focus:border-blue-500 transition-all"
                        value={formData.confirmPassword}
                        onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {isEditing && (
              <div className="flex items-center gap-4">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" /> {isLoading ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2"
                >
                  <X className="w-5 h-5" /> Cancel
                </button>
              </div>
            )}

            {message.text && (
              <div className={`p-4 rounded-xl flex items-center gap-3 ${
                message.type === 'error'
                  ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                  : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
              }`}>
                {message.type === 'error' ? <X className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                <span className="font-medium">{message.text}</span>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
