import { useEffect, useState } from 'react';

const ML_URL = 'http://localhost:8000/';
const POLL_INTERVAL_MS = 3000;

export function useMlStatus() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(ML_URL, { signal: controller.signal });
        clearTimeout(timeout);
        if (!cancelled && res.ok) {
          setReady(true);
          return;
        }
      } catch {
        // ignore — keep polling
      }
      if (!cancelled) timer = setTimeout(check, POLL_INTERVAL_MS);
    };

    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { ready };
}
