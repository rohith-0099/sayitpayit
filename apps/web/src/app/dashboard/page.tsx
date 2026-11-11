import { connection } from "next/server";
import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { loadDashboardData } from "@/lib/dashboard-data";
import { getCurrentUser } from "@/lib/users";

export const metadata = { title: "Dashboard · SayItPayIt" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="p-10 text-mist">Loading your dashboard…</p>}>
      <Data />
    </Suspense>
  );
}

async function Data() {
  await connection();
  const user = await getCurrentUser();
  const data = await loadDashboardData(user.id, user.country);
  // AG_STUDIO is optional (AG Studio license key); without it Studio runs in evaluation mode.
  return <Dashboard data={data} licenseKey={process.env.AG_STUDIO} />;
}
