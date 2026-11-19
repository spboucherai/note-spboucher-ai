"use client";
/**
 * file: src/components/shell/ShareCapture.tsx
 * description: client half of `/share` (Web Share Target): turns `?title=&text=&url=` into a capture prefill, opens the quick-capture
 *   sheet on it and replaces the address by `/inbox`, so a reload or "Back" does not offer the same share again. Nothing is saved
 *   until the user presses Capture.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useEffect, useRef } from "react";
import { openCapture } from "@/lib/client/capture";
import { prefillFromShare } from "@/lib/client/capture-logic";
import { toast } from "@/components/ui/toast";

export function ShareCapture({ title, text, url }: { title: string; text: string; url: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return; done.current = true;
    const prefill = prefillFromShare({ title, text, url });
    window.history.replaceState(window.history.state, "", "/inbox");
    if (prefill) openCapture(prefill); else toast("Nothing was shared", { description: "Open quick capture to write something." });
  }, [title, text, url]);
  return null;
}
