import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";

/** what a keyboard can land on inside a dialog */
export const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The keyboard lifecycle every modal on this site shares: opening moves focus into the dialog,
 * Tab and Shift+Tab stay inside it, Escape closes it, and closing gives focus back to the control
 * that opened it. One implementation, so the evidence drawer on the desk and the one on the Market
 * Desk cannot drift apart.
 *
 * `openKey` identifies what is on show — an id, or null when the dialog is closed. Focus moves
 * only when it changes, so a poll that re-renders the page underneath does not steal the caret.
 */
export function useDialogFocus<C extends HTMLElement, T extends HTMLElement>(openKey: string | null, onClose: () => void) {
  const containerRef = useRef<C>(null);
  const titleRef = useRef<T>(null);
  // the handler is stable, so re-rendering with a fresh arrow function does not re-run the effect
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (openKey === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    // back to the exact control that opened it, if it is still on the page
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [openKey]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== "Tab" || !containerRef.current) return;
    const nodes = [...containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === titleRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return { containerRef, titleRef, onKeyDown };
}
