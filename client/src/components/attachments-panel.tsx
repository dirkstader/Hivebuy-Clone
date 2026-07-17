import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Paperclip, Upload, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import type { Attachment } from "@shared/schema";

const ROUTE_PREFIX: Record<string, string> = {
  request: "purchase-requests",
  order: "purchase-orders",
  invoice: "invoices",
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentsPanelProps {
  entityType: "request" | "order" | "invoice";
  entityId: number;
}

export function AttachmentsPanel({ entityType, entityId }: AttachmentsPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const routePrefix = ROUTE_PREFIX[entityType];
  const queryKey = [`/api/${routePrefix}`, entityId, "attachments"];

  const { data: attachments, isLoading, isError } = useQuery<Attachment[]>({ queryKey });
  const isPurchasing = user?.role === "purchasing" || user?.role === "finance";
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiRequest("POST", `/api/${routePrefix}/${entityId}/attachments`, formData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Datei hochgeladen" });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Hochladen fehlgeschlagen", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/attachments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Anhang gelöscht" });
    },
    onError: () => toast({ title: "Löschen fehlgeschlagen", variant: "destructive" }),
  });

  const download = async (attachment: Attachment) => {
    if (downloadingId !== null) return; // guard against double-click firing two save-file actions
    setDownloadingId(attachment.id);
    try {
      const res = await apiRequest("GET", `/api/attachments/${attachment.id}/download`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download fehlgeschlagen", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
        data-testid="input-attachment-file"
      />
      <Button
        variant="outline" size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={upload.isPending}
        data-testid="button-upload-attachment"
      >
        <Upload className="h-3.5 w-3.5" /> Datei hochladen
      </Button>

      {isLoading ? null : isError ? (
        <p className="text-sm text-destructive" data-testid="text-attachments-error">
          Anhänge konnten nicht geladen werden (fehlende Berechtigung?).
        </p>
      ) : (attachments ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-attachments">Keine Anhänge vorhanden.</p>
      ) : (
        <ul className="space-y-1.5">
          {(attachments ?? []).map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-card-border px-3 py-2 text-sm"
              data-testid={`row-attachment-${a.id}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate">{a.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(a.size)} · {formatDateTime(a.createdAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => download(a)}
                  disabled={downloadingId !== null}
                  data-testid={`button-download-attachment-${a.id}`}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                {(a.uploadedById === user?.id || isPurchasing) && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" data-testid={`button-delete-attachment-${a.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Anhang löschen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          "{a.filename}" wird unwiderruflich gelöscht.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction disabled={remove.isPending} onClick={() => remove.mutate(a.id)}>Löschen</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
