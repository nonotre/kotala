import { Tag } from "@/components/carbon";
import type { Etiqueta } from "@/lib/dados";

const COR: Record<Etiqueta["tipo"], "gray" | "blue" | "green" | "magenta" | "red" | "warm-gray"> = {
  info: "gray",
  atencao: "blue",
  ok: "green",
  alerta: "magenta",
  urgente: "red",
};

export function Etiquetas({ lista }: { lista: Etiqueta[] }) {
  return (
    <span>
      {lista.map((e) => (
        <Tag key={e.texto} type={COR[e.tipo]} size="sm">
          {e.texto}
        </Tag>
      ))}
    </span>
  );
}
