"use client";

import { Button } from "@carbon/react";
import { ArrowLeft } from "@carbon/react/icons";
import NextLink from "next/link";
import { useEffect, useState } from "react";
import { lerUltimaVista, VISTA_PADRAO } from "@/lib/ultima-vista";

/**
 * Volta para a última vista dos pedidos (Início, quadro ou lista). Link de verdade:
 * o servidor desenha a vista padrão, e o endereço guardado entra depois de montar.
 */
export function BotaoVoltar() {
  const [href, setHref] = useState(VISTA_PADRAO);
  useEffect(() => setHref(lerUltimaVista()), []);
  return <Button as={NextLink} href={href} kind="ghost" size="md" hasIconOnly renderIcon={ArrowLeft} iconDescription="Voltar" tooltipPosition="bottom" tooltipAlignment="start" />;
}
