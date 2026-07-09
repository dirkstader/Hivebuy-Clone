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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency } from "@/lib/format";
import { insertSupplierSchema, type Supplier, type CatalogItem } from "@shared/schema";

export default function Suppliers() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: suppliers, isLoading } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: supplierDetail } = useQuery<Supplier & { catalogItems: CatalogItem[] }>({
    queryKey: ["/api/suppliers", selected?.id],
    enabled: !!selected,
  });

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
            (suppliers ?? []).map((s) => (
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
                  <div className="flex items-center gap-1 mt-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`h-3 w-3 ${i < s.rating ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
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
              <div>
                <p className="text-sm font-medium mb-2">Katalogartikel</p>
                <div className="rounded-md border border-card-border overflow-x-auto">
                  <table className="w-full text-sm min-w-[420px]">
                    <thead className="bg-muted/50">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Artikel</th>
                        <th className="px-3 py-2 font-medium text-right">Preis</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(supplierDetail?.catalogItems ?? []).length === 0 ? (
                        <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">Keine Katalogartikel hinterlegt.</td></tr>
                      ) : (
                        supplierDetail!.catalogItems.map((c) => (
                          <tr key={c.id} data-testid={`row-catalog-item-${c.id}`}>
                            <td className="px-3 py-2 font-mono text-xs">{c.sku}</td>
                            <td className="px-3 py-2">{c.name}</td>
                            <td className="px-3 py-2 text-right">{formatCurrency(c.unitPrice)} / {c.unit}</td>
                          </tr>
                        ))
                      )}
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
