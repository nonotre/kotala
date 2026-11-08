import { PainelDashboard } from "@/components/dashboard/PainelDashboard";
import { dashboard } from "@/lib/dados-dashboard";

export const dynamic = "force-dynamic";

/** X4: dashboard de economia, no desenho da Ester (docs/workspaces/ester-workspace/interface-dashboard.md). */
export default async function Dashboard() {
  return <PainelDashboard dados={await dashboard()} />;
}
