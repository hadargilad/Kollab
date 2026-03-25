import { useState, useEffect } from 'react';
import { Shield, Lock, User, AlertCircle } from 'lucide-react';

interface LoginProps {
  onLogin: (role: string) => void; 
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * Listen for error messages specifically for the Login component.
   * Success messages are handled by App.tsx to trigger navigation.
   */
  useEffect(() => {
    const handleBackendMessage = (message: any) => {
      if (message.type === 'LOGIN_ERROR') {
        setIsLoading(false);
        setErrorMessage('Invalid username or password. Please try again.');
      }
    };

    // Attach the secondary listener to the global dispatch function
    const originalDispatch = (window as any).dispatchWebMessage;
    (window as any).dispatchWebMessage = (message: any) => {
      if (originalDispatch) originalDispatch(message);
      handleBackendMessage(message);
    };

    return () => {
      (window as any).dispatchWebMessage = originalDispatch;
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null); // Reset error on new attempt
    
    const loginData = JSON.stringify({
      type: 'LOGIN_ATTEMPT',
      payload: { username, password },
      timestamp: Date.now()
    });

    document.title = "JSON:" + loginData;
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-blue-600 p-4 rounded-2xl shadow-lg shadow-blue-500/20 mb-4">
            <Shield className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-white text-3xl font-bold tracking-tight">Audio-Intel</h1>
          <p className="text-slate-400 mt-2">Intelligence Management Platform</p>
        </div>

        <div className="bg-slate-900 rounded-2xl shadow-2xl p-8 border border-slate-800">
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Error Message Display */}
            {errorMessage && (
              <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/50 text-red-500 p-4 rounded-xl text-sm animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
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