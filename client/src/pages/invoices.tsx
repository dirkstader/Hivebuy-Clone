import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatDate, INVOICE_STATUS_LABELS, statusBadgeVariant } from "@/lib/format";
import { z } from "zod";
import { insertInvoiceSchema, type Invoice, type PurchaseOrder, type Supplier } from "@shared/schema";

const invoiceFormSchema = insertInvoiceSchema
  .pick({ invoiceNumber: true, orderId: true, supplierId: true, amount: true, dueDate: true })
  .extend({
    orderId: z.coerce.number({ invalid_type_error: "Bitte eine Bestellung wählen." }).int().positive(),
    supplierId: z.coerce.number().int().positive().optional(),
    amount: z.coerce.number({ invalid_type_error: "Bitte einen gültigen Betrag eingeben." }).positive("Betrag muss größer als 0 sein."),
  });

export default function Invoices() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: invoices, isLoading } = useQuery<Invoice[]>({ queryKey: ["/api/invoices"] });
  const { data: orders } = useQuery<PurchaseOrder[]>({ queryKey: ["/api/purchase-orders"] });
  const { data: suppliers } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const canManage = user?.role === "purchasing" || user?.role === "finance";
  const supplierName = (id: number) => suppliers?.find((s) => s.id === id)?.name ?? "–";
  const orderNumber = (id: number) => orders?.find((o) => o.id === id)?.orderNumber ?? "–";

  const form = useForm({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: { invoiceNumber: "", orderId: undefined, supplierId: undefined, amount: 0, dueDate: "" },
  });

  const createInvoice = useMutation({
    mutationFn: async (values: any) => {
      const res = await apiRequest("POST", "/api/invoices", { ...values, status: "pending_review", matchNote: "" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cost-centers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Rechnung erfasst und abgeglichen" });
      setDialogOpen(false);
      form.reset();
    },
    onError: () => toast({ title: "Erfassung fehlgeschlagen", variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Rechnungsabgleich</h1>
          <p className="text-sm text-muted-foreground mt-1">3-Way-Match zwischen Bestellung und Rechnung.</p>
        </div>
        {canManage && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-invoice"><Plus className="h-4 w-4" /> Rechnung erfassen</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Rechnung erfassen</DialogTitle></DialogHeader>
              <Form {...form}>
                <form className="space-y-3" onSubmit={form.handleSubmit((v) => createInvoice.mutate({
                  ...v, orderId: Number(v.orderId), supplierId: Number(v.supplierId), amount: Number(v.amount),
                }))}>
                  <FormField control={form.control} name="invoiceNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rechnungsnummer</FormLabel>
                      <FormControl><Input {...field} data-testid="input-invoice-number" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="orderId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bestellung</FormLabel>
                      <Select onValueChange={(v) => {
                        field.onChange(v);
                        const order = orders?.find((o) => String(o.id) === v);
                        if (order) form.setValue("supplierId" as any, order.supplierId as any);
                      }}>
                        <FormControl><SelectTrigger data-testid="select-invoice-order"><SelectValue placeholder="Bestellung wählen" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {(orders ?? []).map((o) => (
                            <SelectItem key={o.id} value={String(o.id)}>{o.orderNumber} · {formatCurrency(o.totalAmount)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="amount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rechnungsbetrag (€)</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} data-testid="input-invoice-amount" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="dueDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fälligkeitsdatum</FormLabel>
                      <FormControl><Input type="date" {...field} value={field.value ?? ""} data-testid="input-invoice-due-date" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <DialogFooter>
                    <Button type="submit" disabled={createInvoice.isPending} data-testid="button-save-invoice">Abgleichen & speichern</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="rounded-md border border-card-border overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Rechnungsnr.</th>
              <th className="px-4 py-2.5 font-medium">Bestellung</th>
              <th className="px-4 py-2.5 font-medium">Lieferant</th>
              <th className="px-4 py-2.5 font-medium">Eingang</th>
              <th className="px-4 py-2.5 font-medium text-right">Betrag</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-4 py-3"><Skeleton className="h-6 w-full" /></td></tr>
              ))
            ) : (invoices ?? []).length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Keine Rechnungen vorhanden.</td></tr>
            ) : (
              (invoices ?? []).map((inv) => (
                <tr key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                  <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-muted-foreground">{orderNumber(inv.orderId)}</td>
                  <td className="px-4 py-3">{supplierName(inv.supplierId)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.receivedAt)}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(inv.amount)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={statusBadgeVariant(inv.status)}>{INVOICE_STATUS_LABELS[inv.status]}</Badge>
                      {inv.status === "discrepancy" && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                    </div>
                    {inv.matchNote && <p className="text-xs text-muted-foreground mt-1 max-w-xs">{inv.matchNote}</p>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
