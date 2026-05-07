'use client';

import { useEffect, useState } from 'react';

export function BrowserCheck({ children }: { children: React.ReactNode }) {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const hasAPI =
      'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    setSupported(hasAPI);
  }, []);

  if (supported === null) return null; // SSR: render nothing

  if (!supported) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-xl font-bold text-zinc-100">Chrome or Edge Required</h1>
          <p className="text-zinc-400 text-sm">
            Alpha Copilot uses the Web Speech API for real-time audio capture.
            This API is only available in Chrome and Edge.
            Please open this page in Chrome.
          </p>
          <p className="text-zinc-600 text-xs">
            Your current browser does not support <code>SpeechRecognition</code>.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
