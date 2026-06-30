import { useState, useEffect } from 'react';
import { CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import KolLabLogo from './KolLabLogo';

interface Props {
  onReady: () => void;
}

const STEPS = [
  { id: 'backend', label: 'Connecting to backend service...' },
  { id: 'ready',   label: 'System ready' },
];

async function pingUrl(url: string, timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default function StartupScreen({ onReady }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setStepIndex(0);
      setFailed(false);

      let backendOk = false;
      for (let i = 0; i < 15; i++) {
        if (cancelled) return;
        backendOk = await pingUrl('http://localhost:8001/');
        if (backendOk) break;
        await new Promise(r => setTimeout(r, 2000));
      }
      if (cancelled) return;

      if (!backendOk) { setFailed(true); return; }

      setStepIndex(1);
      await new Promise(r => setTimeout(r, 300));
      if (!cancelled) onReady();
    };

    run();
    return () => { cancelled = true; };
  }, [attempt]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative flex flex-col items-center gap-8 w-full max-w-xs">
        {/* Boot header */}
        <div className="text-center text-zinc-300 font-mono text-[10px] tracking-widest w-full">
          Kollab v2.0 // Secure Boot
        </div>

        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <KolLabLogo size={72} />
          <div className="text-center">
            <h1 className="text-white text-2xl font-bold tracking-tight">
              Kol<span className="text-blue-400">L</span>ab
            </h1>
            <p className="text-zinc-200 text-xs font-mono tracking-widest mt-0.5">
              Intelligence Management Platform
            </p>
          </div>
        </div>

        {/* Steps */}
        {!failed && (
          <div className="w-full bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden">
            {STEPS.map((step, i) => {
              const done    = i < stepIndex;
              const active  = i === stepIndex;
              const pending = i > stepIndex;
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 border-zinc-900 transition-all ${
                    active ? 'bg-blue-500/5' : ''
                  }`}
                >
                  {done    && <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />}
                  {active  && <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />}
                  {pending && <div className="w-4 h-4 rounded-full border border-zinc-700 shrink-0" />}
                  <span className={`text-xs font-mono ${
                    done ? 'text-zinc-200' : active ? 'text-zinc-300' : 'text-zinc-300'
                  }`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {!failed && stepIndex === 0 && (
          <p className="text-zinc-300 text-xs font-mono text-center">
            Waiting for backend to start…
          </p>
        )}

        {failed && (
          <div className="w-full bg-red-500/5 border border-red-500/25 rounded-md p-5 text-center space-y-3">
            <AlertCircle className="w-7 h-7 text-red-500 mx-auto" />
            <p className="text-red-300 text-sm font-medium">Connection failed</p>
            <p className="text-zinc-300 text-xs font-mono">
              Make sure Docker Desktop is running, then restart the app.
            </p>
            <button
              onClick={() => setAttempt(a => a + 1)}
              className="mt-1 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-md transition-colors font-mono"
            >
              RETRY
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
