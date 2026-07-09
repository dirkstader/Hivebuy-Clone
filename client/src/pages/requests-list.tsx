import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate, REQUEST_STATUS_LABELS, statusBadgeVariant } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import type { PurchaseRequest } from "@shared/schema";

export default function RequestsList() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: requests, isLoading } = useQuery<PurchaseRequest[]>({ queryKey: ["/api/purchase-requests"] });

  const filtered = (requests ?? []).filter((r) => {
    const matchesSearch = r.title.toLowerCase().includes(search.toLowerCase()) || r.requestNumber.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const canCreate = user && ["requester", "purchasing", "finance"].includes(user.role);

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Bestellanforderungen</h1>
          <p className="text-sm text-muted-foreground mt-1">Alle Anforderungen der Gruppe im Überblick.</p>
        </div>
        {canCreate && (
          <Link href="/requests/new">
            <Button data-testid="button-new-request">
              <Plus className="h-4 w-4" /> Neue Anforderung
            </Button>
          </Link>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Titel oder Nummer suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-search-requests"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            {Object.entries(REQUEST_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-card-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Nummer</th>
              <th className="px-4 py-2.5 font-medium">Titel</th>
              <th className="px-4 py-2.5 font-medium">Erstellt</th>
              <th className="px-4 py-2.5 font-medium text-right">Betrag</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={5} className="px-4 py-3"><Skeleton className="h-6 w-full" /></td></tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Keine Anforderungen gefunden.</td></tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="hover-elevate" data-testid={`row-request-${r.id}`}>
                  <td className="px-4 py-3">
                    <Link href={`/requests/${r.id}`} className="text-primary hover:underline font-medium" data-testid={`link-request-${r.id}`}>
                      {r.requestNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate">{r.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(r.totalAmount)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusBadgeVariant(r.status)}>{REQUEST_STATUS_LABELS[r.status]}</Badge>
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
