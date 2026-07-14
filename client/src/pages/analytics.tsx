import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, REQUEST_STATUS_LABELS } from "@/lib/format";

interface Analytics {
  spendByCostCenter: { name: string; code: string; spent: number; committed: number }[];
  spendBySupplier: { name: string; amount: number }[];
  spendByMonth: { month: string; amount: number }[];
  requestsByStatus: Record<string, number>;
}

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

  const monthLabel = (m: string) => {
    const [y, mo] = m.split("-");
    return `${mo}/${y.slice(2)}`;
  };
  const statusData = Object.entries(data?.requestsByStatus ?? {}).map(([status, count]) => ({
    status: REQUEST_STATUS_LABELS[status] ?? status,
    count,
  }));

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
    </div>
  );
}
