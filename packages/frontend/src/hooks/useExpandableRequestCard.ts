import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction, type FocusEvent, type PointerEvent } from 'react';
import { positionRequestExpansion } from '@/utils/requestExpansion';

/** Expands a card over the grid while keeping nested request settings usable. */
export function useExpandableRequestCard(groupId: string, activeGroupId: string | null, setActiveGroupId: Dispatch<SetStateAction<string | null>>) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const keyboard = useRef(false);
  const modalOpen = useRef(false);
  const open = activeGroupId === groupId;
  const [position, setPosition] = useState<CSSProperties>({});
  const cancelClose = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback((restoreFocus = false) => {
    cancelClose();
    setActiveGroupId(current => current === groupId ? null : current);
    if (restoreFocus) triggerRef.current?.focus();
  }, [cancelClose, groupId, setActiveGroupId]);
  const show = (fromKeyboard = false) => {
    if (!anchorRef.current) return;
    cancelClose();
    keyboard.current = fromKeyboard;
    setPosition(positionRequestExpansion(anchorRef.current.getBoundingClientRect().top, window.innerHeight));
    setActiveGroupId(groupId);
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
    if (open && keyboard.current) panelRef.current?.focus({ preventScroll: true });
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
    const resize = () => { if (!modalOpen.current) close(); };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', resize);
    };
  }, [open, close]);
  return { anchorRef, panelRef, triggerRef, open, position, show, close, enter, leave, blur, setModalOpen };
}
