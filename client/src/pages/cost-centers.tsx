import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency } from "@/lib/format";
import type { CostCenterWithPeriod } from "@shared/schema";

export default function CostCenters() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: costCenters, isLoading } = useQuery<CostCenterWithPeriod[]>({ queryKey: ["/api/cost-centers"] });
  const [rolloverTarget, setRolloverTarget] = useState<CostCenterWithPeriod | null>(null);
  const [nextBudget, setNextBudget] = useState("");

  const canManage = user?.role === "finance";

  const rollover = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/cost-centers/${rolloverTarget!.id}/periods`, { budget: Number(nextBudget) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cost-centers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
      toast({ title: "Neues Geschäftsjahr eröffnet" });
      setRolloverTarget(null);
      setNextBudget("");
    },
    onError: () => toast({ title: "Jahreswechsel fehlgeschlagen", variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Kostenstellen</h1>
        <p className="text-sm text-muted-foreground mt-1">Budgetverbrauch je Kostenstelle im laufenden Geschäftsjahr.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(costCenters ?? []).map((c) => {
            const used = c.spent + c.committed;
            const pct = c.annualBudget > 0 ? Math.min(100, (used / c.annualBudget) * 100) : 0;
            const over = used > c.annualBudget;
            return (
              <Card key={c.id} data-testid={`card-cost-center-${c.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.code}{c.city ? ` · ${c.city}` : ""}{c.owner ? ` · ${c.owner}` : ""} · Geschäftsjahr {c.fiscalYear}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className={`text-sm font-semibold ${over ? "text-destructive" : ""}`}>{pct.toFixed(0)}%</p>
                      {canManage && (
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          title="Neues Geschäftsjahr anlegen"
                          data-testid={`button-rollover-${c.id}`}
                          onClick={() => { setRolloverTarget(c); setNextBudget(String(c.annualBudget)); }}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <Progress value={pct} className={over ? "[&>div]:bg-destructive" : ""} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span data-testid={`text-cc-usage-${c.id}`}>
                      {formatCurrency(c.spent)} verbraucht · {formatCurrency(c.committed)} reserviert
                    </span>
                    <span>Budget {formatCurrency(c.annualBudget)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!rolloverTarget} onOpenChange={(open) => !open && setRolloverTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neues Geschäftsjahr anlegen</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Schließt das Geschäftsjahr {rolloverTarget?.fiscalYear} für "{rolloverTarget?.name}" ab und eröffnet Geschäftsjahr {(rolloverTarget?.fiscalYear ?? 0) + 1}.
            Noch offene (reservierte) Budgetbindungen werden automatisch übernommen.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="next-budget">Budget für das neue Geschäftsjahr (€)</Label>
            <Input
              id="next-budget" type="number" step="0.01" value={nextBudget}
              onChange={(e) => setNextBudget(e.target.value)}
              data-testid="input-next-budget"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => rollover.mutate()}
              disabled={rollover.isPending || !nextBudget}
              data-testid="button-confirm-rollover"
            >
              Geschäftsjahr eröffnen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
