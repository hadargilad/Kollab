import { useState } from 'react';
import { Lock, User, AlertCircle } from 'lucide-react';
import { auth, type AuthUser } from '../lib/api';
import KolLabLogo from './KolLabLogo';

interface LoginProps {
  onLogin: (user: AuthUser) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const user = await auth.login(username, password);
      onLogin(user);
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Invalid username or password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <KolLabLogo size={80} />
          <h1 className="text-white text-3xl font-bold tracking-tight mt-2">
            Kol<span className="text-blue-400">L</span>ab
          </h1>
          <p className="text-slate-400 mt-2">Intelligence Management Platform</p>
        </div>

        <div className="bg-slate-900 rounded-2xl shadow-2xl p-8 border border-slate-800">
          <form onSubmit={handleSubmit} className="space-y-6">

            {errorMessage && (
              <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/50 text-red-500 p-4 rounded-xl text-sm animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p>{errorMessage}</p>
              </div>
            )}

            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-11 pr-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all"
                  placeholder="UserName"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-11 pr-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all"
                  placeholder="Password"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-3.5 rounded-xl font-bold text-white transition-all shadow-lg ${
                isLoading
                  ? 'bg-slate-800 cursor-not-allowed text-slate-500'
                  : 'bg-blue-600 hover:bg-blue-500 active:scale-95 shadow-blue-600/20'
              }`}
            >
              {isLoading ? 'Verifying Credentials...' : 'Login'}
            </button>
          </form>

          <div className="mt-8 flex items-center justify-center gap-2 text-slate-600 uppercase tracking-widest text-[10px] font-bold">
            <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>
            Classified Access Only
          </div>
        </div>
      </div>
    </div>
  );
}
