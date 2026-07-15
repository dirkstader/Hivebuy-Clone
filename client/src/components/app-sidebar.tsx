import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, FileText, Truck, Package, Receipt, Building2, BarChart3, LogOut, UserCog,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, SidebarHeader,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/logo";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const NAV_ITEMS = [
  { title: "Übersicht", url: "/", icon: LayoutDashboard, roles: ["requester", "approver", "purchasing", "finance"] },
  { title: "Bestellanforderungen", url: "/requests", icon: FileText, roles: ["requester", "approver", "purchasing", "finance"] },
  { title: "Bestellungen", url: "/orders", icon: Package, roles: ["purchasing", "finance"] },
  { title: "Lieferanten & Katalog", url: "/suppliers", icon: Truck, roles: ["requester", "approver", "purchasing", "finance"] },
  { title: "Rechnungsabgleich", url: "/invoices", icon: Receipt, roles: ["purchasing", "finance"] },
  { title: "Kostenstellen", url: "/cost-centers", icon: Building2, roles: ["approver", "finance"] },
  { title: "Auswertungen", url: "/analytics", icon: BarChart3, roles: ["approver", "purchasing", "finance"] },
  { title: "Vertretung", url: "/vertretung", icon: UserCog, roles: ["approver", "purchasing", "finance"] },
];

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  if (!user) return null;

  const items = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-3">
        <div className="flex items-center gap-2.5">
          <Logo size={30} />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">OUNDA Procure</p>
            <p className="text-xs text-muted-foreground leading-tight">Beschaffungsmanagement</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url} data-testid={`link-nav-${item.url.replace("/", "") || "home"}`}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="flex items-center gap-2.5 px-1 py-1.5">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs bg-sidebar-accent text-sidebar-accent-foreground">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate" data-testid="text-current-user-name">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{ROLE_LABELS[user.role]}</p>
          </div>
          <button
            onClick={logout}
            data-testid="button-logout"
            aria-label="Abmelden"
            className="p-1.5 rounded-md hover-elevate active-elevate-2 text-sidebar-foreground shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
