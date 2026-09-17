// megaset-draft.ts — the MegaSet draft download (#209 split from
// MegasetPanel.tsx): pure payload→file logic, no component state. No API
// call and no library mutation: the browser downloads exactly the measured
// result on screen.
import type { MegasetPayload } from "../../../shared/types";
import { toast } from "../../ui/toast";

export function saveDraft(data: MegasetPayload): void {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          kind: "megadj-set-draft",
          savedAt: new Date().toISOString(),
          status: data.complete ? "complete" : "partial",
          ...data,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `set-${data.preset}-${data.actualMinutes}min-${data.complete ? "draft" : "partial"}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  toast(
    data.complete ? "MegaSet draft saved" : "Partial set draft saved",
    "ok",
  );
}
