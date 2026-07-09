import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, Plus, Minus, Info } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import type { AmazonCatalogItem } from "@shared/amazon-types";

interface CartLine extends AmazonCatalogItem {
  quantity: number;
}

export function AmazonPunchoutDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (lines: { description: string; quantity: number; unitPrice: number }[]) => void;
}) {
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [search, setSearch] = useState("");

  const { data: catalog, isLoading } = useQuery<AmazonCatalogItem[]>({
    queryKey: ["/api/punchout/catalog"],
    enabled: open,
  });

  const filtered = (catalog ?? []).filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()) ||
    item.category.toLowerCase().includes(search.toLowerCase())
  );

  const addToCart = (item: AmazonCatalogItem) => {
    setCart((prev) => ({
      ...prev,
      [item.asin]: { ...item, quantity: (prev[item.asin]?.quantity ?? 0) + 1 },
    }));
  };

  const changeQty = (asin: string, delta: number) => {
    setCart((prev) => {
      const current = prev[asin];
      if (!current) return prev;
      const nextQty = current.quantity + delta;
      if (nextQty <= 0) {
        const { [asin]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [asin]: { ...current, quantity: nextQty } };
    });
  };

  const cartLines = Object.values(cart);
  const cartTotal = cartLines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  const handleSubmitCart = () => {
    onImport(
      cartLines.map((l) => ({
        description: `${l.name} (Amazon ASIN ${l.asin})`,
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
            <ShoppingCart className="h-4 w-4" /> Amazon Business Punch-Out
          </DialogTitle>
          <DialogDescription>
            Artikel im Amazon Business Katalog auswählen — sie werden als Positionen in die Bestellanforderung übernommen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>
            Demo-Modus: Dieser Katalog simuliert die echte Amazon Business Punch-Out-Sitzung (cXML/OCI).
            Für den produktiven Einsatz wird hier auf den echten amazon.de/business Katalog eures Unternehmenskontos verlinkt.
          </p>
        </div>

        <Input
          placeholder="Artikel oder Kategorie suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-amazon-search"
        />

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Keine Artikel gefunden.</p>
          ) : (
            filtered.map((item) => (
              <div
                key={item.asin}
                className="flex items-center gap-3 rounded-md border border-border p-3"
                data-testid={`card-amazon-item-${item.asin}`}
              >
                <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                  <Badge variant="outline" className="mt-1 text-[10px]">{item.category}</Badge>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium">{formatCurrency(item.unitPrice)}</p>
                  <p className="text-xs text-muted-foreground">pro {item.unit}</p>
                </div>
                {cart[item.asin] ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQty(item.asin, -1)} data-testid={`button-decrease-${item.asin}`}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="text-sm w-5 text-center" data-testid={`text-qty-${item.asin}`}>{cart[item.asin].quantity}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQty(item.asin, 1)} data-testid={`button-increase-${item.asin}`}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => addToCart(item)} data-testid={`button-add-${item.asin}`}>
                    Hinzufügen
                  </Button>
                )}
              </div>
            ))
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between border-t border-border pt-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Warenkorb: </span>
            <span className="font-medium" data-testid="text-amazon-cart-total">{formatCurrency(cartTotal)}</span>
            <span className="text-muted-foreground"> ({cartLines.length} Position{cartLines.length !== 1 ? "en" : ""})</span>
          </div>
          <Button onClick={handleSubmitCart} disabled={cartLines.length === 0} data-testid="button-import-amazon-cart">
            In Anforderung übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
