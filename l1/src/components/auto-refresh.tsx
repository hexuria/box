"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ when }: { when: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!when) {
      return;
    }
    const timer = setInterval(() => {
      router.refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [when, router]);

  return null;
}
