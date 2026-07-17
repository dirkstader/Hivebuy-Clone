import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatDate } from "@/lib/format";
import { insertContractSchema, type Supplier, type CostCenter } from "@shared/schema";

type ContractLifecycleStatus = "active" | "notice_due_soon" | "expiring" | "expired" | "cancelled";

interface ContractRow {
  id: number; contractNumber: string; title: string;
  supplierId: number; supplierName: string;
  costCenterId: number | null; costCenterName: string | null;
  value: number; startDate: string; endDate: string | null;
  noticePeriodDays: number; autoRenew: boolean;
  status: "active" | "cancelled"; note: string;
  noticeDeadline: string | null; daysUntilNoticeDeadline: number | null; effectiveStatus: ContractLifecycleStatus;
}

const STATUS_LABELS: Record<ContractLifecycleStatus, string> = {
  active: "Aktiv",
  notice_due_soon: "Kündigungsfrist bald fällig",
  expiring: "Läuft aus",
  expired: "Abgelaufen",
  cancelled: "Gekündigt",
};

function statusBadgeVariant(status: ContractLifecycleStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "notice_due_soon") return "secondary";
  if (status === "expiring" || status === "expired") return "destructive";
  return "outline"; // cancelled
}

const contractFormSchema = insertContractSchema
  .pick({ title: true, supplierId: true, costCenterId: true, value: true, startDate: true, endDate: true, noticePeriodDays: true, autoRenew: true, note: true })
  .extend({
    supplierId: z.coerce.number({ invalid_type_error: "Bitte einen Lieferanten wählen." }).int().positive(),
    costCenterId: z.coerce.number().int().positive().nullable().optional(),
    value: z.coerce.number().nonnegative(),
    noticePeriodDays: z.coerce.number().int().nonnegative(),
  });

export default function Contracts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selected, setSelected] = useState<ContractRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: contracts, isLoading } = useQuery<ContractRow[]>({ queryKey: ["/api/contracts"] });
  const { data: suppliers } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: costCenters } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });

  const canManage = user?.role === "purchasing" || user?.role === "finance";

  const form = useForm({
    resolver: zodResolver(contractFormSchema),
    defaultValues: {
      title: "", supplierId: undefined, costCenterId: null, value: 0,
      startDate: new Date().toISOString().slice(0, 10), endDate: "",
      noticePeriodDays: 90, autoRenew: false, note: "",
    },
  });

  const createContract = useMutation({
    mutationFn: async (values: any) => {
      const res = await apiRequest("POST", "/api/contracts", {
        ...values,
        supplierId: Number(values.supplierId),
        costCenterId: values.costCenterId ? Number(values.costCenterId) : null,
        value: Number(values.value),
        noticePeriodDays: Number(values.noticePeriodDays),
        endDate: values.endDate || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Vertrag angelegt" });
      setDialogOpen(false);
      form.reset();
    },
    onError: () => toast({ title: "Anlegen fehlgeschlagen", variant: "destructive" }),
  });

  const cancelContract = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/contracts/${id}`, { status: "cancelled" });
      return res.json();
    },
    onSuccess: (updated: ContractRow) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      setSelected(updated);
      toast({ title: "Vertrag gekündigt" });
    },
    onError: () => toast({ title: "Kündigen fehlgeschlagen", variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Verträge</h1>
          <p className="text-sm text-muted-foreground mt-1">Lieferantenverträge, Laufzeiten und Kündigungsfristen.</p>
        </div>
        {canManage && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-contract"><Plus className="h-4 w-4" /> Neuer Vertrag</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Neuer Vertrag</DialogTitle></DialogHeader>
              <Form {...form}>
                <form
                  className="space-y-3"
                  onSubmit={form.handleSubmit((v) => createContract.mutate({
                    ...v, supplierId: Number(v.supplierId), value: Number(v.value), noticePeriodDays: Number(v.noticePeriodDays),
                  }))}
                >
                  <FormField control={form.control} name="title" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Titel</FormLabel>
                      <FormControl><Input {...field} data-testid="input-contract-title" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="supplierId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lieferant</FormLabel>
                      <Select onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-contract-supplier"><SelectValue placeholder="Lieferant wählen" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(suppliers ?? []).map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="costCenterId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kostenstelle (optional)</FormLabel>
                      <Select onValueChange={(v) => field.onChange(v === "none" ? null : v)}>
                        <FormControl>
                          <SelectTrigger data-testid="select-contract-cost-center"><SelectValue placeholder="Keine" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Keine</SelectItem>
                          {(costCenters ?? []).map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.code} · {c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="startDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Beginn</FormLabel>
                        <FormControl><Input {...field} type="date" data-testid="input-contract-start" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="endDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ende (optional)</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} type="date" data-testid="input-contract-end" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="value" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vertragswert (€)</FormLabel>
                        <FormControl><Input {...field} type="number" step="0.01" data-testid="input-contract-value" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="noticePeriodDays" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Kündigungsfrist (Tage)</FormLabel>
                        <FormControl><Input {...field} type="number" data-testid="input-contract-notice-period" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="autoRenew" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-md border border-card-border p-3">
                      <FormLabel className="!mt-0">Automatische Verlängerung</FormLabel>
                      <FormControl>
                        <Switch checked={!!field.value} onCheckedChange={field.onChange} data-testid="switch-contract-auto-renew" />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="note" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notiz (optional)</FormLabel>
                      <FormControl><Input {...field} data-testid="input-contract-note" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <DialogFooter>
                    <Button type="submit" disabled={createContract.isPending} data-testid="button-save-contract">Speichern</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-2 space-y-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : (contracts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Verträge vorhanden.</p>
          ) : (
            (contracts ?? []).map((c) => (
              <Card
                key={c.id}
                className={`cursor-pointer hover-elevate ${selected?.id === c.id ? "border-primary" : ""}`}
                onClick={() => setSelected(c)}
                data-testid={`card-contract-${c.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileSignature className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="text-sm font-medium truncate">{c.title}</p>
                    </div>
                    <Badge variant={statusBadgeVariant(c.effectiveStatus)}>{STATUS_LABELS[c.effectiveStatus]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{c.supplierName} · {c.contractNumber}</p>
                  {c.endDate && <p className="text-xs text-muted-foreground mt-1">Laufzeit bis {formatDate(c.endDate)}</p>}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="lg:col-span-3">
          {!selected ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed rounded-md">
              Vertrag auswählen, um Details zu sehen.
            </div>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold" data-testid="text-contract-detail-title">{selected.title}</p>
                      <p className="text-xs text-muted-foreground">{selected.contractNumber} · {selected.supplierName}</p>
                    </div>
                    <Badge variant={statusBadgeVariant(selected.effectiveStatus)}>{STATUS_LABELS[selected.effectiveStatus]}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Vertragswert</p>
                      <p className="font-medium">{formatCurrency(selected.value)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Kostenstelle</p>
                      <p className="font-medium">{selected.costCenterName ?? "–"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Laufzeit</p>
                      <p className="font-medium">
                        {formatDate(selected.startDate)} – {selected.endDate ? formatDate(selected.endDate) : "unbefristet"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Kündigungsfrist</p>
                      <p className="font-medium">
                        {selected.noticePeriodDays} Tage{selected.noticeDeadline ? ` · bis ${formatDate(selected.noticeDeadline)}` : ""}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selected.autoRenew
                      ? "Verlängert sich automatisch, wenn nicht fristgerecht gekündigt."
                      : "Endet ohne automatische Verlängerung."}
                  </p>
                  {selected.note && <p className="text-sm" data-testid="text-contract-note">{selected.note}</p>}
                  {canManage && selected.status === "active" && (
                    <Button
                      variant="outline" size="sm" className="text-destructive"
                      disabled={cancelContract.isPending}
                      onClick={() => cancelContract.mutate(selected.id)}
                      data-testid="button-cancel-contract"
                    >
                      Vertrag kündigen
                    </Button>
                  )}
                </CardContent>
              </Card>
              <div>
                <p className="text-sm font-medium mb-2">Anhänge</p>
                <AttachmentsPanel entityType="contract" entityId={selected.id} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
