const EPISODES_PER_PAGE = 10;

export function episodePageRanges(count: number) {
  return Array.from({ length: Math.ceil(count / EPISODES_PER_PAGE) }, (_, index) => ({
    start: index * EPISODES_PER_PAGE,
    end: Math.min((index + 1) * EPISODES_PER_PAGE, count),
  }));
}

/** A group stays active until its successor reaches the start of the viewport. */
export function episodePageAtOffset(offsets: number[], scrollLeft: number): number {
  return Math.max(0, offsets.findLastIndex(offset => offset <= scrollLeft + 1));
}
