import React, { useState, useEffect } from 'react';
import { UserPlus, Shield, Trash2, Edit2, RefreshCw, X, ShieldAlert, KeyRound, ChevronDown } from 'lucide-react';
import { users as usersApi, auth } from '../lib/api';
import type { UserRecord } from '../lib/api';

interface Props {
  currentUser: { username: string; role: string } | null;
}

export default function UserManagement({ currentUser }: Props) {
  const [userList, setUserList] = useState<UserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [pendingAction, setPendingAction] = useState<{ type: 'DELETE' | 'EDIT'; user: UserRecord } | null>(null);
  const [verifyError, setVerifyError] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [formData, setFormData] = useState({
    id: 0, username: '', password: '', firstName: '', lastName: '', idNumber: '', role: 'Analyst',
  });
  const [formError, setFormError] = useState('');

  const formatName = (name: string) =>
    name.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const data = await usersApi.list();
      setUserList(data);
    } catch { /* keep previous list */ }
    finally { setIsLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  const triggerSecureAction = (type: 'DELETE' | 'EDIT', user: UserRecord) => {
    setPendingAction({ type, user });
    setAdminPassword('');
    setVerifyError('');
    setIsVerifyOpen(true);
  };

  const confirmSecureAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingAction || !currentUser) return;
    setVerifyError('');
    try {
      const { valid } = await auth.verifyAdmin(currentUser.username, adminPassword);
      if (!valid) { setVerifyError('Wrong Admin Password!'); return; }
      if (pendingAction.type === 'DELETE') {
        await usersApi.remove(pendingAction.user.id, currentUser.username, adminPassword);
        setIsVerifyOpen(false);
        setAdminPassword('');
        fetchUsers();
      } else {
        const u = pendingAction.user;
        setFormData({ id: u.id, username: u.username, password: '', firstName: u.firstName, lastName: u.lastName, idNumber: u.idNumber, role: u.role });
        setFormError('');
        setIsEditMode(true);
        setIsModalOpen(true);
        setIsVerifyOpen(false);
      }
    } catch (err: any) {
      setVerifyError(err.message ?? 'Verification failed.');
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const cleanFirstName = formatName(formData.firstName);
    const cleanLastName = formatName(formData.lastName);
    if (!/^\d{9}$/.test(formData.idNumber)) { setFormError('ID Number must be exactly 9 digits.'); return; }
    // Must match the UI checklist below: lowercase, uppercase, AND
    // (digit OR special). The previous regex required *both* a digit and a
    // special character even though the UI showed a single "Number/special" check.
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\d@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!isEditMode || formData.password) {
      if (!passwordRegex.test(formData.password)) { setFormError('Security Violation: Password requirement not met.'); return; }
    }
    try {
      if (isEditMode) {
        await usersApi.update(formData.id, { firstName: cleanFirstName, lastName: cleanLastName, idNumber: formData.idNumber, role: formData.role, password: formData.password });
      } else {
        await usersApi.create({ username: formData.username, password: formData.password, role: formData.role, firstName: cleanFirstName, lastName: cleanLastName, idNumber: formData.idNumber });
      }
      setIsModalOpen(false);
      setFormError('');
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message ?? 'An error occurred.');
    }
  };

  const filteredUsers = userList.filter(u =>
    u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.lastName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const inputCls = 'w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 transition-all font-mono';
  const selectCls = 'w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 appearance-none transition-all font-mono';

  const modalCls = 'fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4';
  const modalCard = 'bg-zinc-950 border border-zinc-800 rounded-md w-full shadow-2xl';

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Admin</div>
          <h1 className="text-white text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-zinc-300 text-sm mt-0.5">Personnel access and security roles</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchUsers}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 rounded-md transition-colors">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <div className="relative">
            <input type="text" placeholder="Search users…" value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="bg-black border border-zinc-800 rounded px-3 py-2 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 transition-all w-44" />
          </div>
          <button
            onClick={() => {
              setFormError('');
              setIsEditMode(false);
              setFormData({ id: 0, username: '', password: '', firstName: '', lastName: '', idNumber: '', role: 'Analyst' });
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md font-medium transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Add User
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="px-5 py-3 text-zinc-200 text-[10px] font-mono uppercase tracking-widest">User</th>
              <th className="px-5 py-3 text-zinc-200 text-[10px] font-mono uppercase tracking-widest">Role</th>
              <th className="px-5 py-3 text-zinc-200 text-[10px] font-mono uppercase tracking-widest">Joined</th>
              <th className="px-5 py-3 text-right text-zinc-200 text-[10px] font-mono uppercase tracking-widest">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-zinc-800/40 transition-colors group">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 text-xs font-mono font-bold shrink-0">
                      {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium">{user.firstName} {user.lastName}</span>
                        {user.username === currentUser?.username && (
                          <span className="bg-blue-500/15 text-blue-400 text-[9px] px-1.5 py-0.5 rounded border border-blue-500/25 font-mono uppercase tracking-wider">
                            YOU
                          </span>
                        )}
                      </div>
                      <div className="text-zinc-200 text-xs font-mono mt-0.5">
                        {user.idNumber} · @{user.username}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${
                    user.role === 'Admin'
                      ? 'bg-purple-500/10 text-purple-400 border-purple-500/25'
                      : 'bg-blue-500/10 text-blue-400 border-blue-500/25'
                  }`}>
                    <Shield className="w-2.5 h-2.5" />{user.role}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className="text-zinc-200 text-xs font-mono">
                    {new Date(user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => triggerSecureAction('EDIT', user)}
                      className="p-1.5 text-zinc-200 hover:text-white hover:bg-zinc-700 rounded-md transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {user.username !== currentUser?.username && (
                      <button onClick={() => triggerSecureAction('DELETE', user)}
                        className="p-1.5 text-zinc-200 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Security verification modal */}
      {isVerifyOpen && (
        <div className={modalCls} style={{ zIndex: 60 }}>
          <div className={modalCard + ' max-w-sm'}>
            <div className="p-5 text-center border-b border-zinc-800">
              <div className="w-10 h-10 bg-red-500/10 border border-red-500/25 rounded flex items-center justify-center mx-auto mb-3">
                <ShieldAlert className="w-5 h-5 text-red-400" />
              </div>
              <h2 className="text-white font-semibold">Security Verification</h2>
              <p className="text-zinc-300 text-xs mt-1">
                Re-enter your admin password to authorize the {pendingAction?.type.toLowerCase()} of this account.
              </p>
            </div>
            <form onSubmit={confirmSecureAction} className="p-5 space-y-3">
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-200" />
                <input type="password" autoFocus required placeholder="Admin password"
                  className={inputCls + ' pl-9'}
                  value={adminPassword} onChange={e => setAdminPassword(e.target.value)} />
              </div>
              {verifyError && <p className="text-red-400 text-xs font-mono text-center">{verifyError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setIsVerifyOpen(false)}
                  className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-md transition-colors">
                  Cancel
                </button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm rounded-md font-medium transition-colors">
                  Authorize
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/edit modal */}
      {isModalOpen && (
        <div className={modalCls}>
          <div className={modalCard + ' max-w-md overflow-y-auto max-h-[90vh]'}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 sticky top-0 bg-zinc-950">
              <h2 className="text-white font-semibold flex items-center gap-2">
                {isEditMode ? <Edit2 className="w-4 h-4 text-blue-400" /> : <UserPlus className="w-4 h-4 text-blue-400" />}
                {isEditMode ? 'Edit User' : 'New User'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-200 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">First Name</label>
                  <input placeholder="First name" className={inputCls} value={formData.firstName}
                    onChange={e => setFormData({ ...formData, firstName: e.target.value })} required />
                </div>
                <div>
                  <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Last Name</label>
                  <input placeholder="Last name" className={inputCls} value={formData.lastName}
                    onChange={e => setFormData({ ...formData, lastName: e.target.value })} required />
                </div>
              </div>

              <div>
                <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">ID Number (9 digits)</label>
                <input placeholder="012345678" maxLength={9}
                  className={`${inputCls} ${formError.includes('ID') ? 'border-red-500' : ''}`}
                  value={formData.idNumber}
                  onChange={e => { const val = e.target.value.replace(/\D/g, ''); setFormData({ ...formData, idNumber: val }); if (formError.includes('ID')) setFormError(''); }}
                  required />
              </div>

              <div>
                <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Username</label>
                <input placeholder="username" className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`}
                  value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })}
                  required disabled={isEditMode} />
              </div>

              <div>
                <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">
                  {isEditMode ? 'New Password (blank = keep current)' : 'Temporary Password'}
                </label>
                <input type="password" placeholder="••••••••" className={inputCls}
                  value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })}
                  required={!isEditMode} />
                <div className="mt-2 p-2.5 bg-black border border-zinc-900 rounded grid grid-cols-2 gap-x-3 gap-y-1">
                  {[
                    [formData.password.length >= 8, '8+ chars'],
                    [/[A-Z]/.test(formData.password), 'Uppercase'],
                    [/[a-z]/.test(formData.password), 'Lowercase'],
                    [/[0-9@$!%*?&]/.test(formData.password), 'Number/special'],
                  ].map(([ok, label]) => (
                    <span key={label as string} className={`text-[10px] font-mono flex items-center gap-1 ${ok ? 'text-emerald-400' : 'text-zinc-300'}`}>
                      {ok ? '✓' : '○'} {label as string}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Security Role</label>
                <div className="relative">
                  <select className={selectCls + ' cursor-pointer'} value={formData.role}
                    onChange={e => setFormData({ ...formData, role: e.target.value })}>
                    <option value="Analyst">Intelligence Analyst</option>
                    <option value="Admin">System Administrator</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-200 pointer-events-none" />
                </div>
              </div>

              {formError && (
                <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/25 rounded px-3 py-2.5 text-red-400 text-xs">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <button type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors">
                {isEditMode ? 'Save Changes' : 'Create User'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
