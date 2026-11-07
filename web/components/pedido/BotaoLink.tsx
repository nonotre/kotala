"use client";

import { Button } from "@carbon/react";
import NextLink from "next/link";
import type { ReactNode } from "react";

/** Botão que navega dentro do app, sem recarregar a página. */
export function BotaoLink({ href, children, kind = "secondary", size = "md" }: { href: string; children: ReactNode; kind?: "primary" | "secondary" | "tertiary" | "ghost"; size?: "sm" | "md" | "lg" }) {
  return (
    <Button as={NextLink} href={href} kind={kind} size={size}>
      {children}
    </Button>
  );
}
