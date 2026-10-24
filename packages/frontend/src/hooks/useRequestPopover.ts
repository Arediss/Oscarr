import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';
import { positionRequestPopover } from '@/utils/requestPopover';

/** Keeps the card/panel hover bridge open; nested request settings retain their own lifetime. */
export function useRequestPopover() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const keyboard = useRef(false);
  const modalOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const cancelClose = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback((restoreFocus = false) => {
    cancelClose();
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, [cancelClose]);
  const show = (fromKeyboard = false) => {
    if (!anchorRef.current) return;
    cancelClose();
    keyboard.current = fromKeyboard;
    setPosition(positionRequestPopover(anchorRef.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
    setOpen(true);
  };
  const enter = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    hovered.current = true;
    show();
  };
  const leave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    hovered.current = false;
    cancelClose();
    timer.current = setTimeout(() => {
      if (!modalOpen.current && !(keyboard.current && panelRef.current?.contains(document.activeElement))) close();
    }, 150);
  };
  const blur = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && (anchorRef.current?.contains(next) || panelRef.current?.contains(next))) return;
    if (!hovered.current && !modalOpen.current) close();
  };
  const setModalOpen = useCallback((value: boolean) => {
    modalOpen.current = value;
    if (value) cancelClose();
    else if (!hovered.current && !keyboard.current) close();
  }, [cancelClose, close]);

  useLayoutEffect(() => {
    if (open && keyboard.current) panelRef.current?.focus();
  }, [open]);
  useEffect(() => cancelClose, [cancelClose]);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !modalOpen.current) {
        event.preventDefault();
        close(panelRef.current?.contains(document.activeElement));
      }
    };
    const outside = (event: globalThis.PointerEvent) => {
      if (modalOpen.current || !(event.target instanceof Node)) return;
      if (!anchorRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) close();
    };
    const scroll = (event: Event) => {
      if (modalOpen.current || (event.target instanceof Node && panelRef.current?.contains(event.target))) return;
      close();
    };
    const resize = () => { if (!modalOpen.current) close(); };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open, close]);
  return { anchorRef, panelRef, triggerRef, open, position, show, close, enter, leave, blur, setModalOpen };
}
