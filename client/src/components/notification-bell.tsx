import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Bell, Check, X, ShoppingCart, AlertTriangle, FileClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime } from "@/lib/format";

interface Notification {
  id: string;
  type: string;
  title: string;
  description: string;
  href: string;
  createdAt: string;
}

const ICONS: Record<string, any> = {
  approval: FileClock,
  approved: Check,
  rejected: X,
  order: ShoppingCart,
  discrepancy: AlertTriangle,
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    // Header is always mounted — poll so the badge stays roughly live.
    refetchInterval: 20000,
  });

  const items = data ?? [];
  const count = items.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Benachrichtigungen" data-testid="button-notifications">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium flex items-center justify-center"
              data-testid="badge-notification-count"
            >
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-3 py-2.5 border-b border-border">
          <p className="text-sm font-medium">Benachrichtigungen</p>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-notifications">
            Nichts zu erledigen.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {items.map((n) => {
              const Icon = ICONS[n.type] ?? Bell;
              return (
                <Link
                  key={n.id}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 px-3 py-2.5 hover-elevate active-elevate-2"
                  data-testid={`notification-${n.id}`}
                >
                  <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{n.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{n.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(n.createdAt)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
