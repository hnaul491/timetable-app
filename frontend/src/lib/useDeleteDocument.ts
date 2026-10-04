import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useT } from "../i18n";
import { useConfirm } from "../components/ui/Confirm";
import { useToast } from "../components/ui/Toast";
import { apiFetch } from "./api";

/** Confirm, then delete a document (its Drive copy goes to the bin) and refresh every document list. */
export function useDeleteDocument() {
  const t = useT();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (doc: { id: number; name: string }) => apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success(t("documents.deleted"));
    },
    onError: (error, doc) => toast.error(t("documents.deleteFailed", { message: error.message }), { retry: () => remove.mutate(doc) }),
  });
  const askDelete = async (doc: { id: number; name: string }) => {
    const ok = await confirm({ title: t("documents.deleteTitle"), body: t("documents.deleteBody", { name: doc.name }), confirmLabel: t("documents.delete"), tone: "danger" });
    if (ok) remove.mutate(doc);
  };
  return { askDelete, pending: remove.isPending };
}
