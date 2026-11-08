import { RegrasCompra } from "@/components/conta/RegrasCompra";
import { regrasDeCompra } from "@/lib/regras";

export const dynamic = "force-dynamic";

/** Regras de compra em vigor (prazos, consulta, negociação, mapa e empresa), só para ler. */
export default function Regras() {
  return <RegrasCompra grupos={regrasDeCompra()} />;
}
