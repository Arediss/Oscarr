import { useEffect, type RefObject } from 'react';
import { enableDragScroll } from '@/utils/dragScroll';

export function useDragScroll(ref: RefObject<HTMLElement | null>, itemCount: number) {
  useEffect(() => {
    if (ref.current) return enableDragScroll(ref.current);
  }, [ref, itemCount]);
}
