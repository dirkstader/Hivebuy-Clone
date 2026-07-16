import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, X, ShoppingCart, PackageCheck, Send, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import { AttachmentsPanel } from "@/components/attachments-panel";
import {
  formatCurrency, formatDate, formatDateTime, REQUEST_STATUS_LABELS, statusBadgeVariant,
} from "@/lib/format";
import type { PurchaseRequest, RequestLineItem, ActivityLog, ApprovalStep, Supplier, CostCenter, User, ApprovalDelegation } from "@shared/schema";

type LineItemWithReceived = RequestLineItem & { quantityReceived?: number };
type RequestDetailResponse = PurchaseRequest & {
  lineItems: LineItemWithReceived[];
  activity: ActivityLog[];
  approvalSteps: ApprovalStep[];
  orderId: number | null;
  orderStatus: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  created: "Anforderung erstellt",
  submitted: "Zur Freigabe eingereicht",
  pending_approval: "Zur Freigabe eingereicht",
  step_approved: "Freigabestufe genehmigt",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  ordered: "Bestellung ausgelöst",
  received: "Wareneingang gebucht",
  closed: "Abgeschlossen",
  attachment_added: "Anhang hochgeladen",
  attachment_removed: "Anhang gelöscht",
};

// Mirrors canActOnStep in server/routes.ts — finance covers every step, approver only
// covers approver steps. Authoritative check is server-side; this just gates the UI.
function canActOnStep(role: string | undefined, stepRole: string): boolean {
  if (role === "finance") return true;
  return role === "approver" && stepRole === "approver";
}

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [comment, setComment] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptQty, setReceiptQty] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery<RequestDetailResponse>({
    queryKey: ["/api/purchase-requests", id],
  });
  const { data: suppliers } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: costCenters } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: myDelegations } = useQuery<{ delegation: unknown; delegatingFor: User[] }>({
    queryKey: ["/api/delegations/me"],
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/purchase-requests", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/purchase-requests"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cost-centers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  };

  const transition = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/purchase-requests/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Status aktualisiert" });
    },
    onError: () => toast({ title: "Aktion fehlgeschlagen", variant: "destructive" }),
  });

  const decide = useMutation({
    mutationFn: async (payload: { decision: "approved" | "rejected"; comment: string }) => {
      const res = await apiRequest("POST", `/api/purchase-requests/${id}/decision`, payload);
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setComment("");
      toast({ title: "Freigabe-Entscheidung gespeichert" });
    },
    onError: () => toast({ title: "Aktion fehlgeschlagen", variant: "destructive" }),
  });

  const bookReceipt = useMutation({
    mutationFn: async (payload: { lines: { requestLineItemId: number; quantityReceived: number }[] }) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${data?.orderId}/receipts`, payload);
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setReceiptOpen(false);
      setReceiptQty({});
      toast({ title: "Wareneingang gebucht" });
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
  const isPurchasing = user?.role === "purchasing" || user?.role === "finance";
  const userName = (uid: number | null | undefined) => users?.find((u) => u.id === uid)?.name;

  const steps = data.approvalSteps ?? [];
  const currentStep = steps.find((s) => s.status === "pending");
  // A delegate may decide on the delegator's behalf if the delegator's role covers this step
  // — unless the delegator is themselves the requester (segregation of duties), except for a
  // purchasing/"Admin" delegate, who is trusted to self-approve on someone else's behalf too.
  const delegatorMatch = currentStep && myDelegations?.delegatingFor.find(
    (d) => canActOnStep(d.role, currentStep.approverRole) && (d.id !== data.requesterId || user?.role === "purchasing")
  );
  const decidingAsDelegate = !!currentStep && !canActOnStep(user?.role, currentStep.approverRole) && !!delegatorMatch;
  const canDecide =
    data.status === "pending_approval" &&
    !!currentStep &&
    data.requesterId !== user?.id &&
    (canActOnStep(user?.role, currentStep.approverRole) || !!delegatorMatch);
  const canOrder = isPurchasing && data.status === "approved";
  const canReceive = isPurchasing && data.status === "ordered";
  const canSubmit = data.status === "draft" && data.requesterId === user?.id;
  const showReceived = data.orderId != null;
  const outstanding = (li: LineItemWithReceived) => Math.max(0, li.quantity - (li.quantityReceived ?? 0));

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
                  {showReceived && <th className="px-3 py-2 font-medium text-right">Erhalten</th>}
                  <th className="px-3 py-2 font-medium text-right">Einzelpreis</th>
                  <th className="px-3 py-2 font-medium text-right">Summe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.lineItems.map((li) => {
                  const received = li.quantityReceived ?? 0;
                  return (
                    <tr key={li.id} data-testid={`row-line-item-${li.id}`}>
                      <td className="px-3 py-2">{li.description}</td>
                      <td className="px-3 py-2 text-right">{li.quantity}</td>
                      {showReceived && (
                        <td className={`px-3 py-2 text-right ${received >= li.quantity ? "text-primary" : "text-muted-foreground"}`} data-testid={`text-received-${li.id}`}>
                          {received}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right">{formatCurrency(li.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(li.quantity * li.unitPrice)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Anhänge</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <AttachmentsPanel entityType="request" entityId={data.id} />
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

      {(canDecide || canOrder || canReceive || canSubmit) && (
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
            {canDecide && currentStep && (
              <>
                <p className="text-xs text-muted-foreground">
                  Freigabestufe {currentStep.stepOrder} · {ROLE_LABELS[currentStep.approverRole] ?? currentStep.approverRole}
                </p>
                {decidingAsDelegate && delegatorMatch && (
                  <p className="text-xs text-primary" data-testid="text-deciding-as-delegate">
                    Du entscheidest hier als Vertretung für {delegatorMatch.name}.
                  </p>
                )}
                <Textarea
                  placeholder="Kommentar (optional)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  data-testid="input-approver-comment"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => decide.mutate({ decision: "approved", comment })}
                    disabled={decide.isPending}
                    data-testid="button-approve"
                  >
                    <Check className="h-4 w-4" /> Freigeben
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => decide.mutate({ decision: "rejected", comment })}
                    disabled={decide.isPending}
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
                onClick={() => {
                  setReceiptQty(Object.fromEntries(data.lineItems.map((li) => [li.id, String(outstanding(li))])));
                  setReceiptOpen(true);
                }}
                disabled={bookReceipt.isPending}
                data-testid="button-receive"
              >
                <PackageCheck className="h-4 w-4" /> Wareneingang erfassen
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wareneingang erfassen</DialogTitle>
            <DialogDescription>
              Erfasse die tatsächlich gelieferten Mengen. Teillieferungen sind möglich — die Bestellung
              wird erst als vollständig erhalten markiert, wenn alle Positionen geliefert sind.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {data.lineItems.map((li) => (
              <div key={li.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm truncate">{li.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Bestellt {li.quantity} · bereits erhalten {li.quantityReceived ?? 0}
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  className="w-24 shrink-0"
                  value={receiptQty[li.id] ?? ""}
                  onChange={(e) => setReceiptQty((prev) => ({ ...prev, [li.id]: e.target.value }))}
                  data-testid={`input-receipt-qty-${li.id}`}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                const lines = data.lineItems
                  .map((li) => ({ requestLineItemId: li.id, quantityReceived: Number(receiptQty[li.id] || 0) }))
                  .filter((l) => l.quantityReceived > 0);
                bookReceipt.mutate({ lines });
              }}
              disabled={bookReceipt.isPending || data.lineItems.every((li) => Number(receiptQty[li.id] || 0) <= 0)}
              data-testid="button-confirm-receipt"
            >
              <PackageCheck className="h-4 w-4" /> Wareneingang buchen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {steps.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Freigabe-Kette</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ol className="space-y-3">
              {steps.map((step) => {
                const isCurrent = currentStep?.id === step.id;
                const Icon = step.status === "approved" ? Check : step.status === "rejected" ? X : Clock;
                const iconClass =
                  step.status === "approved" ? "text-primary"
                  : step.status === "rejected" ? "text-destructive"
                  : "text-muted-foreground";
                const statusLabel =
                  step.status === "approved" ? "Freigegeben"
                  : step.status === "rejected" ? "Abgelehnt"
                  : isCurrent ? "Offen · aktuelle Stufe" : "Ausstehend";
                return (
                  <li key={step.id} className="flex items-start gap-3 text-sm" data-testid={`row-approval-step-${step.stepOrder}`}>
                    <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${iconClass}`} />
                    <div>
                      <p className="font-medium">
                        Stufe {step.stepOrder} · {ROLE_LABELS[step.approverRole] ?? step.approverRole}
                        <span className="text-muted-foreground font-normal"> — {statusLabel}</span>
                      </p>
                      {step.decidedById != null && (
                        <p className="text-muted-foreground text-xs mt-0.5">
                          {userName(step.decidedById) ?? "Unbekannt"} · {formatDateTime(step.decidedAt)}
                        </p>
                      )}
                      {step.decidedOnBehalfOfId != null && (
                        <p className="text-muted-foreground text-xs mt-0.5" data-testid={`text-on-behalf-of-${step.stepOrder}`}>
                          Vertretung für {userName(step.decidedOnBehalfOfId) ?? "Unbekannt"}
                        </p>
                      )}
                      {step.comment && <p className="text-muted-foreground text-xs mt-0.5">{step.comment}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
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
