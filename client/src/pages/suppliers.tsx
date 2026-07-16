import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Star, Building2, Mail, Phone } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency } from "@/lib/format";
import { insertSupplierSchema, type Supplier, type CatalogItem } from "@shared/schema";

// Response shape of GET /api/suppliers/scorecards — computed on demand server-side from
// goods-receipt/invoice history, never persisted (see server/routes.ts).
interface ScorecardEntry {
  supplierId: number;
  onTimeRate: number | null;
  completeRate: number | null;
  discrepancyRate: number | null;
  score: number | null;
  hasData: boolean;
  sampleOrders: number;
  sampleInvoices: number;
  fallbackRating: number;
}

// Composite-score coloring, mirroring how statusBadgeVariant (@/lib/format) encodes good/bad
// status: >=90 reads as strong (primary), 70-89 as middling (amber), below as weak (destructive).
function scoreColorClass(score: number) {
  if (score >= 90) return "text-primary";
  if (score >= 70) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

function ratePercent(rate: number | null) {
  return rate != null ? `${Math.round(rate * 100)}%` : "–";
}

export default function Suppliers() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");

  const { data: suppliers, isLoading } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: supplierDetail } = useQuery<Supplier & { catalogItems: CatalogItem[] }>({
    queryKey: ["/api/suppliers", selected?.id],
    enabled: !!selected,
  });
  const { data: scorecards } = useQuery<ScorecardEntry[]>({ queryKey: ["/api/suppliers/scorecards"] });
  const scorecardBySupplier = new Map((scorecards ?? []).map((sc) => [sc.supplierId, sc]));
  const selectedScorecard = selected ? scorecardBySupplier.get(selected.id) : undefined;

  const canManage = user?.role === "purchasing" || user?.role === "finance";

  const form = useForm({
    resolver: zodResolver(insertSupplierSchema),
    defaultValues: {
      name: "", category: "", contactName: "", email: "", phone: "", address: "", rating: 4, status: "active",
    },
  });

  const createSupplier = useMutation({
    mutationFn: async (values: any) => {
      const res = await apiRequest("POST", "/api/suppliers", values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Lieferant angelegt" });
      setDialogOpen(false);
      form.reset();
    },
    onError: () => toast({ title: "Anlegen fehlgeschlagen", variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Lieferanten & Katalog</h1>
          <p className="text-sm text-muted-foreground mt-1">Lieferantenstamm und Artikelkataloge verwalten.</p>
        </div>
        {canManage && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-supplier"><Plus className="h-4 w-4" /> Neuer Lieferant</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Neuer Lieferant</DialogTitle></DialogHeader>
              <Form {...form}>
                <form
                  className="space-y-3"
                  onSubmit={form.handleSubmit((values) => createSupplier.mutate(values))}
                >
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl><Input {...field} data-testid="input-supplier-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="category" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kategorie</FormLabel>
                      <FormControl><Input {...field} placeholder="z.B. Gläser, Fassungen, IT" data-testid="input-supplier-category" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="contactName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ansprechpartner</FormLabel>
                        <FormControl><Input {...field} data-testid="input-supplier-contact" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>E-Mail</FormLabel>
                        <FormControl><Input {...field} data-testid="input-supplier-email" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="status" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-supplier-status"><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Aktiv</SelectItem>
                          <SelectItem value="inactive">Inaktiv</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <DialogFooter>
                    <Button type="submit" disabled={createSupplier.isPending} data-testid="button-save-supplier">Speichern</Button>
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
          ) : (
            (suppliers ?? []).map((s) => {
              const scorecard = scorecardBySupplier.get(s.id);
              return (
                <Card
                  key={s.id}
                  className={`cursor-pointer hover-elevate ${selected?.id === s.id ? "border-primary" : ""}`}
                  onClick={() => setSelected(s)}
                  data-testid={`card-supplier-${s.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <p className="text-sm font-medium truncate">{s.name}</p>
                      </div>
                      <Badge variant={s.status === "active" ? "default" : "outline"}>{s.status === "active" ? "Aktiv" : "Inaktiv"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{s.category}</p>
                    {scorecard?.hasData ? (
                      <div className="flex items-center gap-2 mt-2" data-testid={`score-supplier-${s.id}`}>
                        <span className={`text-sm font-semibold ${scoreColorClass(scorecard.score!)}`}>
                          {scorecard.score}%
                        </span>
                        <span className="text-xs text-muted-foreground">aus {scorecard.sampleOrders} Bestellungen</span>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <div className="flex items-center gap-1">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={`h-3 w-3 ${i < s.rating ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                          ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Manuelle Einschätzung · keine Bestellhistorie</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <div className="lg:col-span-3">
          {!selected ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed rounded-md">
              Lieferant auswählen, um Details und Katalog zu sehen.
            </div>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4 space-y-2">
                  <p className="text-sm font-semibold" data-testid="text-supplier-detail-name">{selected.name}</p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {selected.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {selected.email}</span>}
                    {selected.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {selected.phone}</span>}
                  </div>
                  {selected.address && <p className="text-xs text-muted-foreground">{selected.address}</p>}
                </CardContent>
              </Card>
              {selectedScorecard?.hasData && (
                <Card data-testid="card-supplier-scorecard">
                  <CardContent className="p-4 space-y-3">
                    <p className="text-sm font-medium">Lieferantenbewertung</p>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Liefertreue</span>
                        <span data-testid="text-score-on-time">{ratePercent(selectedScorecard.onTimeRate)}</span>
                      </div>
                      {/* Null (no data yet) must render visually distinct from a genuine 0% —
                          otherwise it reads as "every delivery was late" instead of "no history". */}
                      <Progress
                        value={(selectedScorecard.onTimeRate ?? 0) * 100}
                        className={selectedScorecard.onTimeRate == null ? "opacity-40" : ""}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Vollständigkeit</span>
                        <span data-testid="text-score-complete">{ratePercent(selectedScorecard.completeRate)}</span>
                      </div>
                      <Progress
                        value={(selectedScorecard.completeRate ?? 0) * 100}
                        className={selectedScorecard.completeRate == null ? "opacity-40" : ""}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Rechnungsabweichungen (niedriger ist besser)</span>
                        <span data-testid="text-score-discrepancy">{ratePercent(selectedScorecard.discrepancyRate)}</span>
                      </div>
                      <Progress
                        value={(selectedScorecard.discrepancyRate ?? 0) * 100}
                        className={
                          selectedScorecard.discrepancyRate == null
                            ? "opacity-40"
                            : selectedScorecard.discrepancyRate > 0
                              ? "[&>div]:bg-destructive"
                              : ""
                        }
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Basierend auf {selectedScorecard.sampleOrders} Bestellung{selectedScorecard.sampleOrders === 1 ? "" : "en"} und{" "}
                      {selectedScorecard.sampleInvoices} Rechnung{selectedScorecard.sampleInvoices === 1 ? "" : "en"}.
                    </p>
                  </CardContent>
                </Card>
              )}
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-sm font-medium">
                    Katalogartikel {supplierDetail ? `(${supplierDetail.catalogItems.length})` : ""}
                  </p>
                  {(supplierDetail?.catalogItems.length ?? 0) > 10 && (
                    <Input
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      placeholder="Artikel, Marke oder SKU/EAN suchen…"
                      className="h-8 max-w-xs"
                      data-testid="input-catalog-search"
                    />
                  )}
                </div>
                <div className="rounded-md border border-card-border overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead className="bg-muted/50">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">SKU / EAN</th>
                        <th className="px-3 py-2 font-medium">Artikel</th>
                        <th className="px-3 py-2 font-medium">Marke</th>
                        <th className="px-3 py-2 font-medium">Kategorie</th>
                        <th className="px-3 py-2 font-medium text-right">Preis</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(() => {
                        const items = supplierDetail?.catalogItems ?? [];
                        const q = catalogSearch.trim().toLowerCase();
                        const filtered = q
                          ? items.filter((c) =>
                              c.name.toLowerCase().includes(q) ||
                              c.sku.toLowerCase().includes(q) ||
                              (c.brand ?? "").toLowerCase().includes(q) ||
                              (c.category ?? "").toLowerCase().includes(q)
                            )
                          : items;
                        const visible = filtered.slice(0, 100);
                        if (items.length === 0) {
                          return <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Keine Katalogartikel hinterlegt.</td></tr>;
                        }
                        if (filtered.length === 0) {
                          return <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Keine Treffer für „{catalogSearch}“.</td></tr>;
                        }
                        return (
                          <>
                            {visible.map((c) => (
                              <tr key={c.id} data-testid={`row-catalog-item-${c.id}`}>
                                <td className="px-3 py-2 font-mono text-xs">{c.sku}</td>
                                <td className="px-3 py-2">{c.name}</td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">{c.brand}</td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">{c.category}</td>
                                <td className="px-3 py-2 text-right">{formatCurrency(c.unitPrice)} / {c.unit}</td>
                              </tr>
                            ))}
                            {filtered.length > visible.length && (
                              <tr>
                                <td colSpan={5} className="px-3 py-2 text-center text-xs text-muted-foreground">
                                  {filtered.length - visible.length} weitere Artikel — bitte Suche verfeinern.
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
