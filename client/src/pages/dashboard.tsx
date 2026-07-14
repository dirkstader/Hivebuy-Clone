import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, Package, AlertTriangle, Wallet, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatDate, REQUEST_STATUS_LABELS, statusBadgeVariant } from "@/lib/format";
import type { PurchaseRequest } from "@shared/schema";

interface DashboardSummary {
  pendingApprovals: number;
  openOrders: number;
  discrepancyInvoices: number;
  totalSpent: number;
  totalCommitted: number;
  totalBudget: number;
  activeSuppliers: number;
  requestsByStatus: Record<string, number>;
  recentRequests: PurchaseRequest[];
}

function KpiCard({ icon: Icon, label, value, testId }: { icon: any; label: string; value: string | number; testId: string }) {
  return (
    <Card className="border-card-border">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-md bg-accent flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-accent-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-xl font-semibold leading-tight" data-testid={testId}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<DashboardSummary>({ queryKey: ["/api/dashboard/summary"] });

  const budgetPct = data && data.totalBudget > 0 ? Math.min(100, Math.round(((data.totalSpent + data.totalCommitted) / data.totalBudget) * 100)) : 0;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Übersicht</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Willkommen zurück, {user?.name.split(" ")[0]}. Hier ist der aktuelle Stand der Beschaffung.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={FileText} label="Zur Freigabe" value={data?.pendingApprovals ?? 0} testId="kpi-pending-approvals" />
          <KpiCard icon={Package} label="Offene Bestellungen" value={data?.openOrders ?? 0} testId="kpi-open-orders" />
          <KpiCard icon={AlertTriangle} label="Rechnungsabweichungen" value={data?.discrepancyInvoices ?? 0} testId="kpi-discrepancies" />
          <KpiCard icon={Truck} label="Aktive Lieferanten" value={data?.activeSuppliers ?? 0} testId="kpi-active-suppliers" />
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="border-card-border md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" /> Budgetauslastung Gruppe
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <p className="text-lg font-semibold" data-testid="text-budget-spent">
                  {formatCurrency(data?.totalSpent ?? 0)}
                  <span className="text-sm text-muted-foreground font-normal"> / {formatCurrency(data?.totalBudget ?? 0)}</span>
                </p>
                <Progress value={budgetPct} className="h-2" data-testid="progress-budget" />
                <p className="text-xs text-muted-foreground">
                  {budgetPct}% gebunden · {formatCurrency(data?.totalCommitted ?? 0)} reserviert
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border md:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Zuletzt eingereichte Anforderungen</CardTitle>
            <Link href="/requests" className="text-xs text-primary hover:underline" data-testid="link-view-all-requests">
              Alle anzeigen
            </Link>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : data?.recentRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Noch keine Anforderungen vorhanden.</p>
            ) : (
              <div className="divide-y divide-border">
                {data?.recentRequests.map((r) => (
                  <Link
                    key={r.id}
                    href={`/requests/${r.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover-elevate active-elevate-2 -mx-2 px-2 rounded-md"
                    data-testid={`link-recent-request-${r.id}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.title}</p>
                      <p className="text-xs text-muted-foreground">{r.requestNumber} · {formatDate(r.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-medium">{formatCurrency(r.totalAmount)}</span>
                      <Badge variant={statusBadgeVariant(r.status)}>{REQUEST_STATUS_LABELS[r.status]}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
