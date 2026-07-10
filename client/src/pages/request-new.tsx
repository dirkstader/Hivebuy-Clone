import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Trash2, ShoppingCart, PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { AmazonPunchoutDialog } from "@/components/amazon-punchout-dialog";
import { SupplierCatalogDialog } from "@/components/supplier-catalog-dialog";
import type { CostCenter, Supplier } from "@shared/schema";

interface DraftLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

export default function RequestNew() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [title, setTitle] = useState("");
  const [justification, setJustification] = useState("");
  const [costCenterId, setCostCenterId] = useState<string>(user?.costCenterId ? String(user.costCenterId) : "");
  const [supplierId, setSupplierId] = useState<string>("");
  const [lines, setLines] = useState<DraftLine[]>([{ description: "", quantity: 1, unitPrice: 0 }]);
  const [amazonOpen, setAmazonOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const { data: costCenters } = useQuery<CostCenter[]>({ queryKey: ["/api/cost-centers"] });
  const { data: suppliers } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const total = lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));
  const addLine = () => setLines((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0 }]);

  const importAmazonLines = (imported: DraftLine[]) => {
    setLines((prev) => {
      const withoutEmpty = prev.filter((l) => l.description.trim() !== "" || l.unitPrice > 0);
      return [...withoutEmpty, ...imported];
    });
    toast({ title: "Amazon-Warenkorb übernommen", description: `${imported.length} Position(en) hinzugefügt.` });
  };

  const importCatalogLines = (imported: DraftLine[]) => {
    setLines((prev) => {
      const withoutEmpty = prev.filter((l) => l.description.trim() !== "" || l.unitPrice > 0);
      return [...withoutEmpty, ...imported];
    });
    toast({ title: "Katalogartikel übernommen", description: `${imported.length} Position(en) hinzugefügt.` });
  };

  const selectedSupplier = suppliers?.find((s) => String(s.id) === supplierId);

  const createMutation = useMutation({
    mutationFn: async (status: "draft" | "pending_approval") => {
      const validLines = lines.filter((l) => l.description.trim() !== "");
      const res = await apiRequest("POST", "/api/purchase-requests", {
        requesterId: user!.id,
        costCenterId: Number(costCenterId),
        supplierId: supplierId ? Number(supplierId) : null,
        title,
        justification,
        status,
        lineItems: validLines,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
      toast({ title: "Bestellanforderung gespeichert", description: `${data.requestNumber} wurde erstellt.` });
      navigate(`/requests/${data.id}`);
    },
    onError: () => {
      toast({ title: "Fehler", description: "Anforderung konnte nicht gespeichert werden.", variant: "destructive" });
    },
  });

  const canSubmit = title.trim() !== "" && costCenterId !== "" && lines.some((l) => l.description.trim() !== "");

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Neue Bestellanforderung</h1>
        <p className="text-sm text-muted-foreground mt-1">Fülle die Details aus und reiche die Anforderung zur Freigabe ein.</p>
      </div>

      <Card className="border-card-border">
        <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Titel</Label>
            <Input id="title" data-testid="input-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Nachbestellung Hörgeräte" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kostenstelle</Label>
              <Select value={costCenterId} onValueChange={setCostCenterId}>
                <SelectTrigger data-testid="select-cost-center"><SelectValue placeholder="Kostenstelle wählen" /></SelectTrigger>
                <SelectContent>
                  {costCenters?.map((cc) => (
                    <SelectItem key={cc.id} value={String(cc.id)}>{cc.name} ({cc.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Lieferant (optional)</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger data-testid="select-supplier"><SelectValue placeholder="Lieferant wählen" /></SelectTrigger>
                <SelectContent>
                  {suppliers?.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="justification">Begründung</Label>
            <Textarea id="justification" data-testid="input-justification" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Warum wird diese Bestellung benötigt?" rows={3} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-card-border">
        <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">Positionen</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCatalogOpen(true)}
              disabled={!supplierId}
              title={!supplierId ? "Bitte zuerst einen Lieferanten auswählen" : undefined}
              data-testid="button-open-supplier-catalog"
            >
              <PackageSearch className="h-4 w-4" /> Aus Katalog wählen
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAmazonOpen(true)} data-testid="button-open-amazon-punchout">
              <ShoppingCart className="h-4 w-4" /> Bei Amazon Business einkaufen
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2" data-testid={`row-line-item-${i}`}>
              <Input
                placeholder="Beschreibung"
                value={line.description}
                onChange={(e) => updateLine(i, { description: e.target.value })}
                className="flex-1 min-w-[140px]"
                data-testid={`input-line-description-${i}`}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Menge"
                value={line.quantity}
                onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                className="w-20 sm:w-24"
                data-testid={`input-line-quantity-${i}`}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Preis €"
                value={line.unitPrice}
                onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
                className="w-24 sm:w-28"
                data-testid={`input-line-price-${i}`}
              />
              <Button variant="ghost" size="icon" onClick={() => removeLine(i)} disabled={lines.length === 1} data-testid={`button-remove-line-${i}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addLine} data-testid="button-add-line">
            <Plus className="h-4 w-4" /> Position hinzufügen
          </Button>

          <div className="flex justify-end pt-2 border-t border-border">
            <p className="text-sm">
              <span className="text-muted-foreground">Gesamtbetrag: </span>
              <span className="font-semibold text-lg" data-testid="text-total-amount">{formatCurrency(total)}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => createMutation.mutate("draft")}
          disabled={!canSubmit || createMutation.isPending}
          data-testid="button-save-draft"
        >
          Als Entwurf speichern
        </Button>
        <Button
          onClick={() => createMutation.mutate("pending_approval")}
          disabled={!canSubmit || createMutation.isPending}
          data-testid="button-submit-request"
        >
          Zur Freigabe einreichen
        </Button>
      </div>

      <AmazonPunchoutDialog open={amazonOpen} onOpenChange={setAmazonOpen} onImport={importAmazonLines} />
      <SupplierCatalogDialog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        supplierId={supplierId ? Number(supplierId) : null}
        supplierName={selectedSupplier?.name}
        onImport={importCatalogLines}
      />
    </div>
  );
}
