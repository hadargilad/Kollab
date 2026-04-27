import { useState, useEffect } from 'react';
import { CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import KolLabLogo from './KolLabLogo';

interface Props {
  onReady: () => void;
}

const STEPS = [
  { id: 'backend', label: 'Connecting to backend service...' },
  { id: 'ml',      label: 'Loading ML models...' },
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

      // Phase 1: backend — poll every 2 s up to 15 times (~30 s)
      let backendOk = false;
      for (let i = 0; i < 15; i++) {
        if (cancelled) return;
        backendOk = await pingUrl('http://127.0.0.1:8001/');
        if (backendOk) break;
        await new Promise(r => setTimeout(r, 2000));
      }
      if (cancelled) return;

      if (!backendOk) {
        setFailed(true);
        return;
      }

      // Backend is up
      setStepIndex(1);

      // Phase 2: ML service — models can take ~2 min to load, poll every 3 s up to 60 times
      let mlOk = false;
      for (let i = 0; i < 60; i++) {
        if (cancelled) return;
        mlOk = await pingUrl('http://127.0.0.1:8000/');
        if (mlOk) break;
        await new Promise(r => setTimeout(r, 3000));
      }
      if (cancelled) return;

      if (!mlOk) {
        setFailed(true);
        return;
      }

      setStepIndex(2);
      await new Promise(r => setTimeout(r, 500));
      if (!cancelled) onReady();
    };

    run();
    return () => { cancelled = true; };
  }, [attempt]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-8 w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <KolLabLogo size={90} />
          <div className="text-center">
            <h1 className="text-white text-3xl font-bold tracking-tight">
              Kol<span className="text-blue-400">L</span>ab
            </h1>
            <p className="text-slate-400 mt-1">Intelligence Management Platform</p>
          </div>
        </div>

        {/* Steps */}
        {!failed && (
          <div className="w-full space-y-3">
            {STEPS.map((step, i) => {
              const done    = i < stepIndex;
              const active  = i === stepIndex;
              const pending = i > stepIndex;
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 ${
                    active  ? 'bg-slate-800 border border-slate-700' :
                    done    ? 'opacity-60' : 'opacity-25'
                  }`}
                >
                  {done    && <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />}
                  {active  && <Loader2 className="w-5 h-5 text-blue-400 animate-spin shrink-0" />}
                  {pending && <div className="w-5 h-5 rounded-full border-2 border-slate-600 shrink-0" />}
                  <span className={`text-sm ${done ? 'text-slate-400' : active ? 'text-white' : 'text-slate-600'}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Retry hint for backend phase */}
        {!failed && stepIndex === 0 && (
          <p className="text-slate-500 text-xs text-center">
            Waiting for backend to start…
          </p>
        )}

        {/* ML loading hint */}
        {!failed && stepIndex === 1 && (
          <p className="text-slate-500 text-xs text-center">
            Loading Whisper &amp; speaker models — this may take 1–2 minutes on first start.
          </p>
        )}

        {/* Failed state */}
        {failed && (
          <div className="w-full bg-red-500/10 border border-red-500/30 rounded-lg p-5 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
            <p className="text-red-300 text-sm font-medium">Could not connect to services</p>
            <p className="text-slate-400 text-xs">
              Make sure Docker Desktop is running, then restart the app.
            </p>
            <button
              onClick={() => setAttempt(a => a + 1)}
              className="mt-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
