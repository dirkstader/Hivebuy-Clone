import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageSearch, Plus, Minus } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import type { CatalogItem, Supplier } from "@shared/schema";

interface CartLine extends CatalogItem {
  quantity: number;
}

export function SupplierCatalogDialog({
  open,
  onOpenChange,
  supplierId,
  supplierName,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: number | null;
  supplierName?: string;
  onImport: (lines: { description: string; quantity: number; unitPrice: number }[]) => void;
}) {
  const [cart, setCart] = useState<Record<number, CartLine>>({});
  const [search, setSearch] = useState("");

  const { data: supplier, isLoading } = useQuery<Supplier & { catalogItems: CatalogItem[] }>({
    queryKey: ["/api/suppliers", supplierId],
    enabled: open && supplierId !== null,
  });

  const catalog = supplier?.catalogItems ?? [];
  const filtered = catalog.filter((item) => {
    const q = search.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      item.sku.toLowerCase().includes(q) ||
      item.brand.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  });

  const addToCart = (item: CatalogItem) => {
    setCart((prev) => ({
      ...prev,
      [item.id]: { ...item, quantity: (prev[item.id]?.quantity ?? 0) + 1 },
    }));
  };

  const changeQty = (id: number, delta: number) => {
    setCart((prev) => {
      const current = prev[id];
      if (!current) return prev;
      const nextQty = current.quantity + delta;
      if (nextQty <= 0) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: { ...current, quantity: nextQty } };
    });
  };

  const cartLines = Object.values(cart);
  const cartTotal = cartLines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  const handleSubmitCart = () => {
    onImport(
      cartLines.map((l) => ({
        description: `${l.name}${l.brand ? ` (${l.brand})` : ""} — SKU ${l.sku}`,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      }))
    );
    setCart({});
    setSearch("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageSearch className="h-4 w-4" /> Artikel aus Katalog wählen{supplierName ? ` — ${supplierName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Artikel aus dem Katalog des ausgewählten Lieferanten auswählen — sie werden als Positionen in die Bestellanforderung übernommen.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Artikel, Marke, SKU/EAN oder Kategorie suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-catalog-dialog-search"
        />

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
          {!supplierId ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Bitte zuerst einen Lieferanten auswählen.
            </p>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {catalog.length === 0 ? "Dieser Lieferant hat keine Katalogartikel." : `Keine Treffer für „${search}".`}
            </p>
          ) : (
            filtered.slice(0, 100).map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-md border border-border p-3"
                data-testid={`card-catalog-item-${item.id}`}
              >
                <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <PackageSearch className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground truncate">SKU/EAN {item.sku}</p>
                  <div className="flex gap-1 mt-1">
                    {item.brand && <Badge variant="outline" className="text-[10px]">{item.brand}</Badge>}
                    {item.category && <Badge variant="secondary" className="text-[10px]">{item.category}</Badge>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium">{formatCurrency(item.unitPrice)}</p>
                  <p className="text-xs text-muted-foreground">pro {item.unit}</p>
                </div>
                {cart[item.id] ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQty(item.id, -1)} data-testid={`button-decrease-${item.id}`}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="text-sm w-5 text-center" data-testid={`text-qty-${item.id}`}>{cart[item.id].quantity}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQty(item.id, 1)} data-testid={`button-increase-${item.id}`}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => addToCart(item)} data-testid={`button-add-${item.id}`}>
                    Hinzufügen
                  </Button>
                )}
              </div>
            ))
          )}
          {filtered.length > 100 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              {filtered.length - 100} weitere Artikel — bitte Suche verfeinern.
            </p>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between border-t border-border pt-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Warenkorb: </span>
            <span className="font-medium" data-testid="text-catalog-cart-total">{formatCurrency(cartTotal)}</span>
            <span className="text-muted-foreground"> ({cartLines.length} Position{cartLines.length !== 1 ? "en" : ""})</span>
          </div>
          <Button onClick={handleSubmitCart} disabled={cartLines.length === 0} data-testid="button-import-catalog-cart">
            In Anforderung übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
