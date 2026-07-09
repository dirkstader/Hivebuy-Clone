import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate, ORDER_STATUS_LABELS, statusBadgeVariant } from "@/lib/format";
import type { PurchaseOrder, Supplier } from "@shared/schema";

export default function Orders() {
  const { data: orders, isLoading } = useQuery<PurchaseOrder[]>({ queryKey: ["/api/purchase-orders"] });
  const { data: suppliers } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const supplierName = (id: number) => suppliers?.find((s) => s.id === id)?.name ?? "–";

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Bestellungen</h1>
        <p className="text-sm text-muted-foreground mt-1">Automatisch erzeugt aus freigegebenen Anforderungen.</p>
      </div>

      <div className="rounded-md border border-card-border overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Bestellnr.</th>
              <th className="px-4 py-2.5 font-medium">Lieferant</th>
              <th className="px-4 py-2.5 font-medium">Bestelldatum</th>
              <th className="px-4 py-2.5 font-medium text-right">Betrag</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={5} className="px-4 py-3"><Skeleton className="h-6 w-full" /></td></tr>
              ))
            ) : (orders ?? []).length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Keine Bestellungen vorhanden.</td></tr>
            ) : (
              (orders ?? []).map((o) => (
                <tr key={o.id} data-testid={`row-order-${o.id}`}>
                  <td className="px-4 py-3 font-medium">{o.orderNumber}</td>
                  <td className="px-4 py-3">{supplierName(o.supplierId)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(o.orderedAt)}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(o.totalAmount)}</td>
                  <td className="px-4 py-3"><Badge variant={statusBadgeVariant(o.status)}>{ORDER_STATUS_LABELS[o.status]}</Badge></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
