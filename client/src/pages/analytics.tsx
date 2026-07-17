import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, Legend,
} from "recharts";
import { ChevronDown, ChevronUp, ChevronsUpDown, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, REQUEST_STATUS_LABELS } from "@/lib/format";

interface BudgetVarianceRow {
  id: number; name: string; code: string; annualBudget: number;
  actual: number; variance: number; variancePct: number; elapsedPct: number;
}

interface Analytics {
  spendByCostCenter: { name: string; code: string; spent: number; committed: number }[];
  spendBySupplier: { name: string; amount: number }[];
  spendByMonth: { month: string; amount: number }[];
  requestsByStatus: Record<string, number>;
  budgetVariance: BudgetVarianceRow[];
  budgetSummary: { totalBudget: number; totalActual: number; variance: number; variancePct: number; overBudgetCount: number };
}

type SortKey = "name" | "annualBudget" | "actual" | "variance";

// Theme-aware chart palette from the app's design tokens (client/src/index.css).
const CHART = (n: number) => `hsl(var(--chart-${n}))`;

const eur = (v: number) => formatCurrency(v);
const eurShort = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(0)} T€` : `${v.toFixed(0)} €`;

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-card-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label, currency = true }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      {label != null && <p className="font-medium mb-1">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full mr-1.5 align-middle" style={{ background: p.color }} />
          {p.name}: <span className="text-foreground font-medium">{currency ? eur(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function Analytics() {
  const { data, isLoading } = useQuery<Analytics>({ queryKey: ["/api/analytics"] });
  const [search, setSearch] = useState("");
  // Over-budget-first by default — the whole point of this table is surfacing cost centers
  // that need attention without the user having to sort manually.
  const [sortKey, setSortKey] = useState<SortKey>("variance");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const monthLabel = (m: string) => {
    const [y, mo] = m.split("-");
    return `${mo}/${y.slice(2)}`;
  };
  const statusData = Object.entries(data?.requestsByStatus ?? {}).map(([status, count]) => ({
    status: REQUEST_STATUS_LABELS[status] ?? status,
    count,
  }));

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const budgetRows = useMemo(() => {
    const rows = (data?.budgetVariance ?? []).filter(
      (c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase())
    );
    const sorted = [...rows].sort((a, b) => {
      const av = sortKey === "name" ? a.name.toLowerCase() : a[sortKey];
      const bv = sortKey === "name" ? b.name.toLowerCase() : b[sortKey];
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [data?.budgetVariance, search, sortKey, sortDir]);

  const sortIcon = (key: SortKey) => {
    if (key !== sortKey) return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  const axisTick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
  const grid = "hsl(var(--border))";

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Auswertungen</h1>
        <p className="text-sm text-muted-foreground mt-1">Ausgaben nach Kostenstelle, Lieferant und Zeitverlauf.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Ausgaben nach Kostenstelle (Top 8)">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data?.spendByCostCenter ?? []} margin={{ left: 8, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="code" tick={axisTick} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis tickFormatter={eurShort} tick={axisTick} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="spent" name="Verbraucht" stackId="a" fill={CHART(1)} radius={[0, 0, 0, 0]} />
                <Bar dataKey="committed" name="Reserviert" stackId="a" fill={CHART(3)} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Ausgaben nach Lieferant (Top 8)">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data?.spendBySupplier ?? []} layout="vertical" margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
                <XAxis type="number" tickFormatter={eurShort} tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: grid }} width={130} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                <Bar dataKey="amount" name="Rechnungsvolumen" fill={CHART(2)} radius={[0, 3, 3, 0]}>
                  {(data?.spendBySupplier ?? []).map((_, i) => (
                    <Cell key={i} fill={CHART((i % 5) + 1)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Rechnungsvolumen im Zeitverlauf">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={(data?.spendByMonth ?? []).map((d) => ({ ...d, label: monthLabel(d.month) }))} margin={{ left: 8, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="spendArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART(1)} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CHART(1)} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis tickFormatter={eurShort} tick={axisTick} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: grid }} />
                <Area type="monotone" dataKey="amount" name="Rechnungen" stroke={CHART(1)} strokeWidth={2} fill="url(#spendArea)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Anforderungen nach Status">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={statusData} margin={{ left: 8, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="status" tick={axisTick} tickLine={false} axisLine={{ stroke: grid }} interval={0} angle={-20} textAnchor="end" height={56} />
                <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={32} />
                <Tooltip content={<ChartTooltip currency={false} />} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                <Bar dataKey="count" name="Anzahl" fill={CHART(4)} radius={[3, 3, 0, 0]}>
                  {statusData.map((_, i) => (
                    <Cell key={i} fill={CHART((i % 5) + 1)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      <Card className="border-card-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Budget vs. Ist je Kostenstelle</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Gesamtbudget</p>
                  <p className="text-base font-semibold">{eur(data?.budgetSummary.totalBudget ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Gesamt-Ist</p>
                  <p className="text-base font-semibold">{eur(data?.budgetSummary.totalActual ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Abweichung</p>
                  <p className={`text-base font-semibold ${(data?.budgetSummary.variance ?? 0) < 0 ? "text-destructive" : ""}`}>
                    {eur(data?.budgetSummary.variance ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Über Budget</p>
                  <p className="text-base font-semibold">{data?.budgetSummary.overBudgetCount ?? 0} Kostenstellen</p>
                </div>
              </div>

              <div className="relative max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Kostenstelle suchen…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                  data-testid="input-search-budget-variance"
                />
              </div>

              <div className="rounded-md border border-card-border overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">
                        <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("name")} data-testid="sort-name">
                          Kostenstelle {sortIcon("name")}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 font-medium text-right">
                        <button className="flex items-center gap-1 ml-auto hover:text-foreground" onClick={() => toggleSort("annualBudget")} data-testid="sort-budget">
                          Budget {sortIcon("annualBudget")}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 font-medium text-right">
                        <button className="flex items-center gap-1 ml-auto hover:text-foreground" onClick={() => toggleSort("actual")} data-testid="sort-actual">
                          Ist {sortIcon("actual")}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 font-medium text-right">
                        <button className="flex items-center gap-1 ml-auto hover:text-foreground" onClick={() => toggleSort("variance")} data-testid="sort-variance">
                          Abweichung {sortIcon("variance")}
                        </button>
                      </th>
                      <th className="px-4 py-2.5 font-medium">Tempo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {budgetRows.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Keine Kostenstellen gefunden.</td></tr>
                    ) : (
                      budgetRows.map((c) => {
                        const overBudget = c.variance < 0;
                        const aheadOfPace = !overBudget && c.variancePct - c.elapsedPct > 15;
                        return (
                          <tr key={c.id} className="hover-elevate" data-testid={`row-budget-variance-${c.id}`}>
                            <td className="px-4 py-3">
                              <p className="font-medium">{c.name}</p>
                              <p className="text-xs text-muted-foreground">{c.code}</p>
                            </td>
                            <td className="px-4 py-3 text-right">{eur(c.annualBudget)}</td>
                            <td className="px-4 py-3 text-right">{eur(c.actual)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${overBudget ? "text-destructive" : ""}`}>
                              {eur(c.variance)}
                              <span className="block text-xs font-normal text-muted-foreground">{c.variancePct.toFixed(0)}% genutzt</span>
                            </td>
                            <td className="px-4 py-3">
                              {overBudget ? (
                                <Badge variant="destructive">Über Budget</Badge>
                              ) : aheadOfPace ? (
                                <Badge variant="secondary">Über Plantempo</Badge>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
