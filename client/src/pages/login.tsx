import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "@/components/logo";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { User } from "@shared/schema";

export default function Login() {
  const { login, isLoading, error, switchUser } = useAuth();
  const [email, setEmail] = useState("dirk@stader.de");
  const [password, setPassword] = useState("demo1234");

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(email, password);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3 justify-center">
          <Logo size={36} />
          <div>
            <p className="text-xl font-semibold leading-tight" data-testid="text-app-title">OUNDA Procure</p>
            <p className="text-xs text-muted-foreground">Beschaffungsmanagement</p>
          </div>
        </div>

        <Card className="border-card-border">
          <CardHeader>
            <CardTitle className="text-lg">Anmelden</CardTitle>
            <CardDescription>Melde dich mit deiner OUNDA E-Mail-Adresse an.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  data-testid="input-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@ounda.de"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Passwort</Label>
                <Input
                  id="password"
                  data-testid="input-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-login">
                {isLoading ? "Anmelden…" : "Anmelden"}
              </Button>
            </form>

            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2 mt-4">Demo-Zugänge (Passwort: demo1234)</p>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {usersLoading && (
                  <>
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                  </>
                )}
                {users?.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    data-testid={`button-demo-user-${u.id}`}
                    onClick={() => switchUser(u)}
                    className="w-full text-left px-3 py-2 rounded-md border border-border hover-elevate active-elevate-2 flex items-center justify-between gap-2"
                  >
                    <span className="text-sm">
                      <span className="font-medium">{u.name}</span>
                      <span className="text-muted-foreground"> · {u.department}</span>
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">{ROLE_LABELS[u.role] ?? u.role}</span>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
