import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import type { CostCenter } from "@shared/schema";

export default function CostCenters() {
  const { data: costCenters, isLoading } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Kostenstellen</h1>
        <p className="text-sm text-muted-foreground mt-1">Budgetverbrauch je Kostenstelle im laufenden Jahr.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(costCenters ?? []).map((c) => {
            const pct = c.annualBudget > 0 ? Math.min(100, (c.spent / c.annualBudget) * 100) : 0;
            const over = c.spent > c.annualBudget;
            return (
              <Card key={c.id} data-testid={`card-cost-center-${c.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.code} · {c.owner}</p>
                    </div>
                    <p className={`text-sm font-semibold ${over ? "text-destructive" : ""}`}>{pct.toFixed(0)}%</p>
                  </div>
                  <Progress value={pct} className={over ? "[&>div]:bg-destructive" : ""} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatCurrency(c.spent)} verbraucht</span>
                    <span>Budget {formatCurrency(c.annualBudget)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
