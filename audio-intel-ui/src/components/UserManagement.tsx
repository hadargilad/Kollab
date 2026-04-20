import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Shield, Trash2, Edit2, Search, RefreshCw, X, ShieldAlert, KeyRound, UserCheck, ChevronDown } from 'lucide-react';

interface UserRecord {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  idNumber: string;
  role: string;
  createdAt: string;
}

interface Props {
  currentUser: { username: string; role: string } | null;
}

export default function UserManagement({ currentUser }: Props) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [pendingAction, setPendingAction] = useState<{type: 'DELETE' | 'EDIT', user: UserRecord} | null>(null);
  const [verifyError, setVerifyError] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [formData, setFormData] = useState({
    id: 0,
    username: '',
    password: '',
    firstName: '',
    lastName: '',
    idNumber: '',
    role: 'Analyst'
  });
  const [formError, setFormError] = useState('');

  const formatName = (name: string) => {
    return name
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  useEffect(() => {
    fetchUsers();
    const handleMessage = (message: any) => {
      if (message.type === 'USERS_LIST_DATA') {
        setUsers(message.payload);
        setIsLoading(false);
      }
      if (message.type === 'USER_ADDED_SUCCESS' || message.type === 'USER_UPDATED_SUCCESS' || message.type === 'USER_DELETED_SUCCESS') {
        setIsModalOpen(false);
        setIsVerifyOpen(false);
        setAdminPassword('');
        setFormError('');
        fetchUsers();
      }
      if (message.type === 'SECURITY_ALERT') {
        setVerifyError(message.message);
      }
      if (message.type === 'FORM_ERROR') {
        setFormError(message.message); 
      }
    };

    const originalDispatch = (window as any).dispatchWebMessage;
    (window as any).dispatchWebMessage = (message: any) => {
      if (originalDispatch) originalDispatch(message);
      handleMessage(message);
    };
    return () => { (window as any).dispatchWebMessage = originalDispatch; };
  }, []);

  const fetchUsers = () => {
    setIsLoading(true);
    document.title = "JSON:" + JSON.stringify({ type: 'GET_USERS_LIST', timestamp: Date.now() });
  };

  const triggerSecureAction = (type: 'DELETE' | 'EDIT', user: UserRecord) => {
    setPendingAction({ type, user });
    setAdminPassword('');
    setVerifyError('');   
    setIsVerifyOpen(true);
  };

  const confirmSecureAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingAction || !currentUser) return;

    if (pendingAction.type === 'DELETE') {
      document.title = "JSON:" + JSON.stringify({
        type: 'VERIFY_AND_EXECUTE',
        payload: { 
          actionType: 'DELETE', 
          targetUserId: pendingAction.user.id, 
          adminUsername: currentUser.username, 
          adminPassword: adminPassword 
        }
      });
    } else if (pendingAction.type === 'EDIT') {
      const u = pendingAction.user;
      setFormData({
        id: u.id,
        username: u.username,
        password: '', 
        firstName: u.firstName,
        lastName: u.lastName,
        idNumber: u.idNumber,
        role: u.role
      });
      setFormError('');
      setIsEditMode(true);
      setIsModalOpen(true);
      setIsVerifyOpen(false);
    }
  };

  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanFirstName = formatName(formData.firstName);
    const cleanLastName = formatName(formData.lastName);

    const idRegex = /^\d{9}$/;
    if (!idRegex.test(formData.idNumber)) {
        setFormError("ID Number must be exactly 9 digits.");
        return;
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!isEditMode || formData.password) {
        if (!passwordRegex.test(formData.password)) {
            setFormError("Security Violation: Password requirement not met.");
            return;
        }
    }

    const finalData = {
      ...formData,
      firstName: cleanFirstName,
      lastName: cleanLastName
    };

    document.title = "JSON:" + JSON.stringify({ 
      type: isEditMode ? 'UPDATE_USER' : 'ADD_NEW_USER', 
      payload: finalData 
    });
  };

  const filteredUsers = users.filter(user => 
    user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.lastName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-8 max-w-7xl mx-auto animate-in fade-in duration-500">
      {/* Header, Search & Table... (אותו דבר כמו קודם) */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Users className="text-blue-500 w-8 h-8" /> User Management
          </h1>
          <p className="text-slate-400 mt-1">Personnel access and security roles</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchUsers} className="p-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
            <RefreshCw className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={() => { 
                setFormError('');
                setIsEditMode(false); 
                setFormData({id:0, username:'', password:'', firstName:'', lastName:'', idNumber:'', role:'Analyst'}); 
                setIsModalOpen(true); 
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-bold transition-all"
          >
            <UserPlus className="w-5 h-5" /> Add New User
          </button>
        </div>
      </div>

      {/* Table & Filtering logic remains the same */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl mb-10">
         <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-800/50 text-slate-300 text-sm uppercase tracking-wider">
              <th className="px-6 py-4 font-semibold">User Details</th>
              <th className="px-6 py-4 font-semibold">Security Role</th>
              <th className="px-6 py-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-slate-800/30 transition-colors group text-sm">
                <td className="px-6 py-4">
                   <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-blue-400 font-bold border border-slate-700">
                      {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                    </div>
                    <div>
                      <div className="text-white font-medium flex items-center gap-2">
                        {user.firstName} {user.lastName}
                        {user.username === currentUser?.username && (
                          <span className="bg-blue-500/20 text-blue-400 text-[10px] px-2 py-0.5 rounded-md border border-blue-500/30 flex items-center gap-1 font-bold">
                            <UserCheck className="w-3 h-3" /> ME
                          </span>
                        )}
                      </div>
                      <div className="text-slate-500 text-xs">ID: {user.idNumber} | @{user.username}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                    user.role === 'Admin' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  }`}>
                    <Shield className="w-3 h-3" /> {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                   <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => triggerSecureAction('EDIT', user)} className="p-2 text-slate-400 hover:text-white"><Edit2 className="w-4 h-4" /></button>
                    {user.username !== currentUser?.username && (
                      <button onClick={() => triggerSecureAction('DELETE', user)} className="p-2 text-slate-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
         </table>
      </div>

      {/* VERIFICATION MODAL*/}

      {isVerifyOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-red-500/20 p-6 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShieldAlert className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-xl font-bold text-white">Security Verification</h2>
              <p className="text-slate-400 text-sm mt-2">
                Re-enter your admin password to authorize the {pendingAction?.type.toLowerCase()} of this user.
              </p>
            </div>
            <form onSubmit={confirmSecureAction} className="space-y-4">
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input 
                  type="password" 
                  autoFocus 
                  required 
                  placeholder="Admin Password"
                  className="w-full bg-slate-950 border border-slate-800 p-3 pl-10 rounded-xl text-white outline-none focus:ring-2 focus:ring-red-500/50"
                  value={adminPassword} 
                  onChange={e => setAdminPassword(e.target.value)}
                />
              </div>
              {verifyError && <p className="text-red-500 text-xs font-bold text-center">{verifyError}</p>}
              <div className="flex gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsVerifyOpen(false)} 
                  className="flex-1 bg-slate-800 py-3 rounded-xl text-white font-bold"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="flex-1 bg-red-600 hover:bg-red-500 py-3 rounded-xl text-white font-bold"
                >
                  Authorize
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-800">
              <h2 className="text-xl font-bold text-white flex items-center gap-2 uppercase tracking-tight">
                {isEditMode ? <Edit2 className="text-blue-500" /> : <UserPlus className="text-blue-500" />}
                {isEditMode ? 'Update User' : 'New User'}
              </h2>
              <button onClick={() => setIsModalOpen(false)}><X className="text-slate-500 hover:text-white" /></button>
            </div>
            
            <form onSubmit={handleSaveUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-black ml-1">First Name</label>
                  <input placeholder="Enter first name" className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-white placeholder:text-slate-500 focus:border-blue-500 outline-none" value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} required/>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-black ml-1">Last Name</label>
                  <input placeholder="Enter last name" className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-white placeholder:text-slate-500 focus:border-blue-500 outline-none" value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} required/>
                </div>
              </div>

              {/* ID NUMBER FIELD*/}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase font-black ml-1">ID Number (9 Digits)</label>
                <input 
                  placeholder="012345678" 
                  maxLength={9} 
                  className={`w-full bg-slate-950 border ${formError.includes('Identification Number') ? 'border-red-500' : 'border-slate-800'} p-3 rounded-xl text-white placeholder:text-slate-500 outline-none focus:border-blue-500`} 
                  value={formData.idNumber} 
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, ''); 
                    setFormData({...formData, idNumber: val}); 
                    if (formError.includes('Identification Number')) setFormError('');
                  }} 
                  required
                />
                {formError.includes('Identification Number') && (
                  <p className="text-[10px] text-red-500 ml-1 flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                    <ShieldAlert className="w-3 h-3" /> ID Number already exists in the system
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase font-black ml-1">System Username</label>
                <input 
                  placeholder="username" 
                  className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-white placeholder:text-slate-500 disabled:opacity-50 outline-none" 
                  value={formData.username} 
                  onChange={e => setFormData({...formData, username: e.target.value})} 
                  required 
                  disabled={isEditMode}
                />
              </div>
              
              {/* Password Field & Requirements */}
              {(!isEditMode || formData.username === currentUser?.username) && (
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-black ml-1">
                    {isEditMode ? 'Change Password (leave blank to keep current)' : 'Temporary Password'}
                  </label>
                  <input type="password" placeholder="••••••••" className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-white placeholder:text-slate-500 outline-none focus:border-blue-500" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} required={!isEditMode}/>
                  
                  <div className="mt-2 p-3 bg-slate-800/30 rounded-lg border border-slate-800/50">
                    <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <li className={`text-[10px] flex items-center gap-1 ${formData.password.length >= 8 ? 'text-emerald-500' : 'text-slate-500'}`}>
                        {formData.password.length >= 8 ? '✓' : '•'} 8+ Characters
                      </li>
                      <li className={`text-[10px] flex items-center gap-1 ${/[A-Z]/.test(formData.password) ? 'text-emerald-500' : 'text-slate-500'}`}>
                        {/[A-Z]/.test(formData.password) ? '✓' : '•'} Uppercase
                      </li>
                      <li className={`text-[10px] flex items-center gap-1 ${/[a-z]/.test(formData.password) ? 'text-emerald-500' : 'text-slate-500'}`}>
                        {/[a-z]/.test(formData.password) ? '✓' : '•'} Lowercase
                      </li>
                      <li className={`text-[10px] flex items-center gap-1 ${/[0-9]/.test(formData.password) ? 'text-emerald-500' : 'text-slate-500'}`}>
                        {/[0-9]/.test(formData.password) ? '✓' : '•'} Number & Special
                      </li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Role Selection */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase font-black ml-1">Security Role</label>
                <div className="relative">
                  <select className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-white appearance-none outline-none focus:border-blue-500 cursor-pointer" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                    <option value="Analyst">Intelligence Analyst</option>
                    <option value="Admin">System Administrator</option>
                  </select>
                  <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  </div>
                </div>
              </div>

              {/* General Form Error (Password validation, etc.) */}
              {formError && !formError.includes('Identification Number') && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] p-3 rounded-xl flex items-center gap-2 animate-pulse">
                  <ShieldAlert className="w-4 h-4" />
                  <span>{formError}</span>
                </div>
              )}

              <button className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-xl text-white font-bold transition-all shadow-lg shadow-blue-600/20 mt-4">
                {isEditMode ? 'Save Profile Updates' : 'Add New User'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}