"use client";
// Recarrega os dados da tela a cada poucos segundos (o card anda sozinho).
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AtualizaSozinho({ segundos = 3 }: { segundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, segundos * 1000);
    return () => clearInterval(t);
  }, [router, segundos]);
  return null;
}
