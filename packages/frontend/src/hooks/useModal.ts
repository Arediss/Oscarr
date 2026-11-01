import { useEffect, useRef } from 'react';

/** A11y modal hook: Escape-to-close, focus trap, focus return, auto-focus first element.
 *  Caller wires the ARIA markup (role=dialog, aria-modal, aria-labelledby={titleId}). */
export interface UseModalOptions {
  open: boolean;
  onClose: () => void;
  disableFocusTrap?: boolean;
}

export interface UseModalResult {
  dialogRef: React.RefObject<HTMLDivElement | null>;
  titleId: string;
}

let modalIdSeq = 0;

function getFocusable(container: HTMLElement): HTMLElement[] {
  const selectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ];
  return Array.from(container.querySelectorAll<HTMLElement>(selectors.join(',')))
    // :disabled also covers controls disabled by a parent fieldset while a form is saving.
    .filter((el) => !el.matches(':disabled') && el.offsetParent !== null);
}

export function useModal({ open, onClose, disableFocusTrap = false }: UseModalOptions): UseModalResult {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleIdRef = useRef<string>(`modal-title-${++modalIdSeq}`);

  // Refs so the effect is keyed on `open` only — inline arrows from parents would otherwise
  // re-trigger the effect on every render and break focus-return.
  const onCloseRef = useRef(onClose);
  const disableFocusTrapRef = useRef(disableFocusTrap);
  onCloseRef.current = onClose;
  disableFocusTrapRef.current = disableFocusTrap;

  useEffect(() => {
    if (!open) return;

    triggerRef.current = (document.activeElement as HTMLElement) || null;

    // One-tick delay so portals/animations mount before we query focusables.
    const focusTimer = globalThis.setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const [first] = getFocusable(root);
      first?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (disableFocusTrapRef.current || e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = getFocusable(root);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      globalThis.clearTimeout(focusTimer);
      const trigger = triggerRef.current;
      if (trigger && document.body.contains(trigger)) {
        trigger.focus();
      }
    };
  }, [open]);

  return { dialogRef, titleId: titleIdRef.current };
}
