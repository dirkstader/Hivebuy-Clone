import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import type { ApprovalDelegation, User } from "@shared/schema";

const DELEGATE_ELIGIBLE_ROLES = ["approver", "finance", "purchasing"];

interface DelegationResponse {
  delegation: (ApprovalDelegation & { delegateName: string | null }) | null;
  delegatingFor: User[];
}

export default function Delegation() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [delegateId, setDelegateId] = useState<string>("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery<DelegationResponse>({ queryKey: ["/api/delegations/me"] });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });

  const eligibleDelegates = (users ?? []).filter(
    (u) => u.id !== user?.id && DELEGATE_ELIGIBLE_ROLES.includes(u.role)
  );

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/delegations/me", {
        delegateId: Number(delegateId), endsAt: endsAt || null, note,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/delegations/me"] });
      toast({ title: "Vertretung gespeichert" });
      setDelegateId(""); setEndsAt(""); setNote("");
    },
    onError: (e: any) => toast({ title: e?.message ?? "Speichern fehlgeschlagen", variant: "destructive" }),
  });

  const clear = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/delegations/me", { delegateId: null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/delegations/me"] });
      toast({ title: "Vertretung aufgehoben" });
    },
    onError: () => toast({ title: "Aktion fehlgeschlagen", variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Vertretung</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lege fest, wer während deiner Abwesenheit deine Freigaben übernehmen darf.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Meine Vertretung</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              {data?.delegation ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-card-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium" data-testid="text-current-delegate">
                      {data.delegation.delegateName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {data.delegation.endsAt ? `Befristet bis ${new Date(data.delegation.endsAt).toLocaleDateString("de-DE")}` : "Unbefristet"}
                      {data.delegation.note ? ` · ${data.delegation.note}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline" size="sm" onClick={() => clear.mutate()} disabled={clear.isPending}
                    data-testid="button-clear-delegation"
                  >
                    Aufheben
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-no-delegation">
                  Aktuell keine Vertretung eingetragen.
                </p>
              )}

              <div className="space-y-3 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <Label>Vertretung durch</Label>
                  <Select value={delegateId} onValueChange={setDelegateId}>
                    <SelectTrigger data-testid="select-delegate">
                      <SelectValue placeholder="Person wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleDelegates.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name} · {ROLE_LABELS[u.role] ?? u.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="delegation-ends-at">Befristet bis (optional)</Label>
                  <Input
                    id="delegation-ends-at" type="date" value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    data-testid="input-delegation-ends-at"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="delegation-note">Notiz (optional)</Label>
                  <Input
                    id="delegation-note" value={note} placeholder="z.B. Urlaubsvertretung"
                    onChange={(e) => setNote(e.target.value)}
                    data-testid="input-delegation-note"
                  />
                </div>
                <Button
                  onClick={() => save.mutate()} disabled={save.isPending || !delegateId}
                  data-testid="button-save-delegation"
                >
                  <UserCog className="h-4 w-4" /> Vertretung eintragen
                </Button>
              </div>
            </CardContent>
          </Card>

          {(data?.delegatingFor.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Du vertrittst aktuell</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1.5">
                  {data!.delegatingFor.map((u) => (
                    <li key={u.id} className="text-sm" data-testid={`row-delegating-for-${u.id}`}>
                      {u.name} <span className="text-muted-foreground">· {ROLE_LABELS[u.role] ?? u.role}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
