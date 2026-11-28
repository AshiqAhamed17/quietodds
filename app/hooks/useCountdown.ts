"use client";

import { useEffect, useState } from "react";

/// Seconds remaining until a unix timestamp, ticking once per second.
/// Returns 0 once the target has passed. SSR-safe (starts from a stable value).
export function useCountdown(targetUnixSeconds?: bigint | number): number {
  const target = targetUnixSeconds === undefined ? 0 : Number(targetUnixSeconds);
  const [now, setNow] = useState(nowSec);

  useEffect(() => {
    const iv = setInterval(() => setNow(nowSec()), 1000);
    return () => clearInterval(iv);
  }, []);

  return target ? Math.max(0, target - now) : 0;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
