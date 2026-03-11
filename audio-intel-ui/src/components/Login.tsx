import { useState, useEffect } from 'react'; // הוספנו useEffect
import { Shield, Lock, User } from 'lucide-react';

interface LoginProps {
  onLogin: (role: string) => void; // עדכנו ש-onLogin יקבל את התפקיד
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState(''); // הוספנו הודעת שגיאה למשתמש

  useEffect(() => {

    const handleMessage = (event: any) => {
      const message = event.data;
      
      if (message.type === 'LOGIN_SUCCESS') {
        onLogin(message.role); // מעבירים לאפליקציה שהצלחנו ואת התפקיד (Admin/Analyst)
      } else if (message.type === 'LOGIN_ERROR') {
        setErrorMessage('Invalid username or password');
      }
    };


    window.chrome.webview.addEventListener('message', handleMessage);
    
    return () => window.chrome.webview.removeEventListener('message', handleMessage);
  }, [onLogin]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(''); // איפוס שגיאה לפני ניסיון חדש
    
    // שליחת הנתונים ל-C#
    // @ts-ignore
    window.chrome.webview.postMessage({
      type: 'LOGIN_ATTEMPT',
      payload: { username: username, password: password }
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-800 rounded-lg shadow-2xl p-8 border border-slate-700">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-blue-600 p-4 rounded-full mb-4">
              <Shield className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-white text-3xl mb-2">Audio-Intel</h1>
            <p className="text-slate-400">Secure Intelligence Platform</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* הודעת שגיאה אם הפרטים לא נכונים */}
            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg text-sm text-center">
                {errorMessage}
              </div>
            )}

            <div>
              <label className="block text-slate-300 mb-2">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg pl-10 pr-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter username"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg pl-10 pr-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter password"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg transition-colors font-bold shadow-lg"
            >
              Secure Login
            </button>
          </form>

          <p className="text-slate-500 text-center mt-6 text-sm">
            Classified System • Authorized Personnel Only
          </p>
        </div>
      </div>
    </div>
  );
}