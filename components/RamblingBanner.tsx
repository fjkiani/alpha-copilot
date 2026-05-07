/**
 * RamblingBanner — Isolated 90-second speaking guard
 * Owns its own timer state. Reads from speakingStartRef (a React ref, NOT state)
 * so ticking every 1s does NOT propagate re-renders to page.tsx or siblings.
 */
'use client';

import { useState, useEffect } from 'react';

const RAMBLING_THRESHOLD_MS = 90_000;
const CHECK_INTERVAL_MS = 1000;

export default function RamblingBanner({
  speakingStartRef,
}: {
  speakingStartRef: React.MutableRefObject<number | null>;
}) {
  const [isRambling, setIsRambling] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const start = speakingStartRef?.current;
      if (start && Date.now() - start >= RAMBLING_THRESHOLD_MS) {
        setIsRambling(true);
      } else {
        setIsRambling(false);
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [speakingStartRef]);

  if (!isRambling) return null;

  return (
    <div className="bg-yellow-900/80 border-b border-yellow-600 text-yellow-200 text-sm font-semibold text-center py-2 px-4">
      ⚠️ WRAP IT UP — You&apos;ve been talking for 90+ seconds
    </div>
  );
}
