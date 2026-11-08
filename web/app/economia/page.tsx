import { redirect } from "next/navigation";

// A tela de economia virou o dashboard; o endereço antigo continua valendo.
export default function Economia() {
  redirect("/dashboard");
}
