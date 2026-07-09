import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, X, ShoppingCart, PackageCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import {
  formatCurrency, formatDate, formatDateTime, REQUEST_STATUS_LABELS, statusBadgeVariant,
} from "@/lib/format";
import type { PurchaseRequest, RequestLineItem, ActivityLog, Supplier, CostCenter } from "@shared/schema";

type RequestDetailResponse = PurchaseRequest & { lineItems: RequestLineItem[]; activity: ActivityLog[] };

const ACTION_LABELS: Record<string, string> = {
  created: "Anforderung erstellt",
  submitted: "Zur Freigabe eingereicht",
  pending_approval: "Zur Freigabe eingereicht",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  ordered: "Bestellung ausgelöst",
  received: "Wareneingang gebucht",
  closed: "Abgeschlossen",
};

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [comment, setComment] = useState("");

  const { data, isLoading } = useQuery<RequestDetailResponse>({
    queryKey: ["/api/purchase-requests", id],
  });
  const { data: suppliers } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: costCenters } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });

  const transition = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/purchase-requests/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requests", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cost-centers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "Status aktualisiert" });
    },
    onError: () => toast({ title: "Aktion fehlgeschlagen", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-6">Anforderung nicht gefunden.</div>;
  }

  const supplier = suppliers?.find((s) => s.id === data.supplierId);
  const costCenter = costCenters?.find((c) => c.id === data.costCenterId);
  const isApprover = user?.role === "approver" || user?.role === "finance";
  const isPurchasing = user?.role === "purchasing" || user?.role === "finance";
  const canApprove = isApprover && data.status === "pending_approval";
  const canOrder = isPurchasing && data.status === "approved";
  const canReceive = isPurchasing && data.status === "ordered";
  const canSubmit = data.status === "draft" && data.requesterId === user?.id;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <Link href="/requests" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-requests">
        <ArrowLeft className="h-3.5 w-3.5" /> Zurück zur Übersicht
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold" data-testid="text-request-number">{data.requestNumber}</h1>
            <Badge variant={statusBadgeVariant(data.status)} data-testid="badge-request-status">
              {REQUEST_STATUS_LABELS[data.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{data.title}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Gesamtbetrag</p>
          <p className="text-lg font-semibold" data-testid="text-total-amount">{formatCurrency(data.totalAmount)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Kostenstelle</p>
            <p className="text-sm font-medium" data-testid="text-cost-center">{costCenter ? `${costCenter.code} · ${costCenter.name}` : "–"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Lieferant</p>
            <p className="text-sm font-medium" data-testid="text-supplier">{supplier?.name ?? "Noch nicht festgelegt"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Erstellt am</p>
            <p className="text-sm font-medium">{formatDate(data.createdAt)}</p>
          </CardContent>
        </Card>
      </div>

      {data.justification && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Begründung</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground pt-0">{data.justification}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Positionen</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="rounded-md border border-card-border overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Beschreibung</th>
                  <th className="px-3 py-2 font-medium text-right">Menge</th>
                  <th className="px-3 py-2 font-medium text-right">Einzelpreis</th>
                  <th className="px-3 py-2 font-medium text-right">Summe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.lineItems.map((li) => (
                  <tr key={li.id} data-testid={`row-line-item-${li.id}`}>
                    <td className="px-3 py-2">{li.description}</td>
                    <td className="px-3 py-2 text-right">{li.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(li.unitPrice)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(li.quantity * li.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {data.approverComment && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Kommentar des Genehmigers</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground pt-0">{data.approverComment}</CardContent>
        </Card>
      )}

      {(canApprove || canOrder || canReceive || canSubmit) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Aktion</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {canSubmit && (
              <Button
                onClick={() => transition.mutate({ status: "pending_approval" })}
                disabled={transition.isPending}
                data-testid="button-submit-draft"
              >
                <Send className="h-4 w-4" /> Zur Freigabe einreichen
              </Button>
            )}
            {canApprove && (
              <>
                <Textarea
                  placeholder="Kommentar (optional)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  data-testid="input-approver-comment"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => transition.mutate({ status: "approved", approverId: user?.id, approverComment: comment })}
                    disabled={transition.isPending}
                    data-testid="button-approve"
                  >
                    <Check className="h-4 w-4" /> Freigeben
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => transition.mutate({ status: "rejected", approverId: user?.id, approverComment: comment })}
                    disabled={transition.isPending}
                    data-testid="button-reject"
                  >
                    <X className="h-4 w-4" /> Ablehnen
                  </Button>
                </div>
              </>
            )}
            {canOrder && (
              <Button
                onClick={() => transition.mutate({ status: "ordered" })}
                disabled={transition.isPending || !data.supplierId}
                data-testid="button-order"
              >
                <ShoppingCart className="h-4 w-4" /> Bestellung auslösen
              </Button>
            )}
            {!data.supplierId && canOrder && (
              <p className="text-xs text-destructive">Vor der Bestellung muss ein Lieferant zugeordnet werden.</p>
            )}
            {canReceive && (
              <Button
                onClick={() => transition.mutate({ status: "received" })}
                disabled={transition.isPending}
                data-testid="button-receive"
              >
                <PackageCheck className="h-4 w-4" /> Wareneingang bestätigen
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Verlauf</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ol className="space-y-3">
            {data.activity.map((a) => (
              <li key={a.id} className="flex items-start gap-3 text-sm" data-testid={`row-activity-${a.id}`}>
                <Send className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="font-medium">{ACTION_LABELS[a.action] ?? a.action}</p>
                  {a.note && <p className="text-muted-foreground text-xs mt-0.5">{a.note}</p>}
                  <p className="text-muted-foreground text-xs mt-0.5">{formatDateTime(a.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
