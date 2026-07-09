import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import RequestsList from "@/pages/requests-list";
import RequestNew from "@/pages/request-new";
import RequestDetail from "@/pages/request-detail";
import Suppliers from "@/pages/suppliers";
import Orders from "@/pages/orders";
import Invoices from "@/pages/invoices";
import CostCenters from "@/pages/cost-centers";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/requests" component={RequestsList} />
      <Route path="/requests/new" component={RequestNew} />
      <Route path="/requests/:id" component={RequestDetail} />
      <Route path="/suppliers" component={Suppliers} />
      <Route path="/orders" component={Orders} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/cost-centers" component={CostCenters} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedShell() {
  const style = {
    "--sidebar-width": "17rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-y-auto">
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function Gate() {
  const { user } = useAuth();
  if (!user) return <Login />;
  return <AuthenticatedShell />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Gate />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
