"use client";

import { useEffect, useState } from "react";

/**
 * False until the page's JavaScript has taken over. Buttons that work through
 * JavaScript stay disabled until then, so an early tap on a slow phone is not
 * silently lost.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
