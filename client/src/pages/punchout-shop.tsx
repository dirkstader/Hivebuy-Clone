import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, Plus, Minus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { setPunchoutReturnedSessionId } from "@/lib/punchout-draft";
import type { AmazonCatalogItem } from "@shared/amazon-types";
import type { PunchoutCartLine } from "@shared/schema";

interface CartLine extends AmazonCatalogItem {
  quantity: number;
}

export default function PunchoutShop() {
  const { buyerCookie } = useParams<{ buyerCookie: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: catalog, isLoading } = useQuery<AmazonCatalogItem[]>({
    queryKey: ["/api/punchout/catalog"],
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

  const handleCancel = () => navigate("/requests/new");

  const handleSubmitCart = async () => {
    setSubmitting(true);
    try {
      const punchoutCart: PunchoutCartLine[] = cartLines.map((l) => ({
        sku: l.asin,
        name: l.name,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        imageUrl: l.imageUrl,
      }));
      const checkoutRes = await apiRequest("POST", "/api/punchout/mock-amazon/checkout", {
        buyerCookie,
        cart: punchoutCart,
      });
      const { cxml } = await checkoutRes.json();
      const callbackRes = await apiRequest("POST", "/api/punchout/callback", { cxml });
      const { sessionId } = await callbackRes.json();
      setPunchoutReturnedSessionId(buyerCookie, sessionId);
      navigate("/requests/new");
    } catch {
      toast({
        title: "Fehler",
        description: "Warenkorb konnte nicht an OUNDA Procure übergeben werden.",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  };

  return (
    <div className="h-screen w-full bg-background flex flex-col">
      <header className="border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Logo size={28} />
          <div>
            <p className="text-sm font-semibold leading-tight">Amazon Business</p>
            <p className="text-xs text-muted-foreground leading-tight">Punch-Out-Sitzung</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleCancel} data-testid="button-punchout-cancel">
          Abbrechen
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-start gap-2 rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>
              Simulation: Sie haben OUNDA Procure verlassen und befinden sich jetzt auf dem (simulierten)
              Amazon-Business-Einkaufskonto. Für den produktiven Einsatz verlinkt dies auf den echten
              amazon.de/business Katalog eures Unternehmenskontos.
            </p>
          </div>

          <Input
            placeholder="Artikel oder Kategorie suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-amazon-search"
          />

          <div className="space-y-2">
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
        </div>
      </div>

      <footer className="border-t border-border px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-muted-foreground">Warenkorb: </span>
          <span className="font-medium" data-testid="text-amazon-cart-total">{formatCurrency(cartTotal)}</span>
          <span className="text-muted-foreground"> ({cartLines.length} Position{cartLines.length !== 1 ? "en" : ""})</span>
        </div>
        <Button onClick={handleSubmitCart} disabled={cartLines.length === 0 || submitting} data-testid="button-punchout-submit">
          Warenkorb an OUNDA Procure übergeben
        </Button>
      </footer>
    </div>
  );
}
