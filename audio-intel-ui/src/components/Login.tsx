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
      setErrorMessage(err.message ?? 'Invalid credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center">
            <KolLabLogo size={80} />
          </div>
          <h1 className="text-white text-2xl font-bold tracking-tight mt-4">
            Kol<span className="text-blue-400">L</span>ab
          </h1>
          <p className="text-zinc-200 text-xs font-mono mt-1 uppercase tracking-widest">
            Intelligence Management Platform
          </p>
        </div>

        {/* Card */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMessage && (
              <div className="flex items-start gap-2.5 bg-red-500/8 border border-red-500/25 text-red-400 px-3 py-2.5 rounded text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{errorMessage}</p>
              </div>
            )}

            <div>
              <label className="block text-zinc-300 text-xs font-mono uppercase tracking-widest mb-1.5">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-200" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-black border border-zinc-800 rounded px-3 pl-9 py-2.5 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all font-mono"
                  placeholder="username"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-zinc-300 text-xs font-mono uppercase tracking-widest mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-200" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-black border border-zinc-800 rounded px-3 pl-9 py-2.5 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all font-mono"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-2.5 rounded-md font-semibold text-sm tracking-wide transition-all mt-2 ${
                isLoading
                  ? 'bg-zinc-800 text-zinc-300 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-[0.98]'
              }`}
            >
              {isLoading ? 'Authenticating…' : 'Access System'}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-zinc-900 flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
            <span className="text-zinc-300 font-mono text-[10px] uppercase tracking-widest">
              Classified Access Only
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
