# Cover-to-detail navigation

`MediaLink` preserves normal link behavior and uses a 360 ms circular reveal for
same-tab cover activations (pointer or keyboard). The origin is the cover center,
clamped to the viewport; the circle reaches its farthest corner. Request buttons
remain separate actions. For sibling cover markup, mark the image with
`data-media-cover` so the origin does not come from the whole request card.

The native View Transition starts without waiting for metadata or artwork.
`MediaLink` schedules navigation with `flushSync`; the snapshot waits for the route's
layout effect to acknowledge its commit, including when the router defers an update.
A local Suspense boundary and
`MediaDetailLoading` provide the same page shell during lazy-module and data loading.
The header and Back button stay available. Data replaces the shell without replaying
the circle. Navigating elsewhere cancels the pending reveal. A 250 ms watchdog skips
only a stalled browser snapshot (for example during a resize), never waits for data.
Reduced motion or unsupported browsers navigate immediately; reduced motion also
disables the route's existing entrance animation.

Detail routes never receive the generic page fade. Temporarily suppressing that
animation during the circle restarts it on cleanup, causing a flash after the reveal.

Reference: [MDN ViewTransition.ready](https://developer.mozilla.org/en-US/docs/Web/API/ViewTransition/ready).

Verification: the frontend suite covers a pending fetch, obsolete navigation,
stalled/failed native snapshots, geometry and motion fallback. Browser checks use the real App,
MediaCard and lazy detail route with fixture API responses: desktop/mobile click,
Enter, return to search, focus, request action and console errors.
The post-reveal regression check counts `fadeIn` starts on the detail route wrapper:
one with temporary CSS suppression, zero after the fix, including a second keyboard
navigation on mobile. The settled wrapper stays at opacity 1 with no animation.
With the API response held indefinitely, the circle starts before the response on
desktop and mobile. Releasing the response causes neither a second circle nor a fade;
Back during loading also survives the late API response.

Audio and subtitle scans load independently from the detail data. Both groups keep
their space while skeletons are replaced by language chips or an unknown-language
label. Long lists scroll horizontally instead of expanding the hero. On desktop,
the artwork height follows the viewport (46–60 rem), independent of text height,
so late metadata never changes its crop. Obsolete initial responses are ignored.
Browser regression checks hold the scan response and compare the artwork, hero
and season positions before and after populated, empty and failed responses.

The detail Back button closes the old page's circle towards the opening cover.
Its history entry remembers the origin and scroll position; a directly opened
detail falls back to the Back button's position. History traversal waits only for
the React route commit, with the same 250 ms snapshot deadline, never for a fetch.
The destination does not replay a page fade. Reduced motion and unsupported
browsers keep the same Back navigation and scroll restoration without animation.

For navigation from the homepage, `MediaLayers` retains exactly one home tree with
[React Activity](https://react.dev/reference/react/Activity). The hidden home keeps
its DOM, loaded images, component state and horizontal carousel positions. Its
effects disconnect, suspending the hero timer, status polling and subscriptions.
Completed homepage/layout fetches are reused on reconnection; interrupted requests
are aborted and restarted when visible. Status subscriptions reconnect with fresh
cache data. Hero transition timeouts are also cleared while hidden.

The detail replaces only the visible layer. Back reveals the original home, restores
its document scroll and focuses the opening link before the reverse snapshot. A
chain of recommended titles keeps the same home and replaces the current detail;
it does not stack detail trees. History stores only a home key plus the existing
cover/scroll origin, never React trees or fetched lists. Leaving the flow releases
the home. Direct URLs, reloads and history entries whose home has been released
render an ordinary detail. The shared layout and navigation remain mounted once.

For other source pages, return scroll restoration reserves enough page height before
asynchronous rows exist, then reapplies the position as their natural height changes. It releases the
reservation once the content can accommodate the viewport. Wheel, touch, pointer
or scroll-key input immediately cancels automatic repositioning, as does a ten-second
deadline. Reserved height remains until the content can support the current position;
leaving the route cleans everything up. Source scroll positions are also kept
for the last 30 history entries so browser Back uses the same restoration. Native
automatic scroll restoration is disabled while this route wrapper is mounted.
The home hero initializes its scroll shade at mount, including a late mount after Back.

Retention validation (Chromium, Vite development mode, 2026-10-28): real App and
homepage with a hero plus five rows of 16 fixture cards, repeated 20 times. The same
home DOM node survives every cycle. Detail state stays at one home, one detail,
2,491 DOM elements and 83 images; returning removes the detail. Home list/layout
fetch counts stay at one per hook (two hooks share the trending endpoint). Six
home intervals fall to zero while hidden and return to six when shown. Vertical
scroll remains 1,153 px on desktop and 998 px on mobile; a row at scrollLeft 1,016 px
also survives browser Back/Forward. Navigating to search removes the retained home;
opening a detail directly performs no home fetch. A blocked detail fetch still
reveals the loading shell, and Back remains safe before the response arrives.

The approximate `performance.memory.usedJSHeapSize` sample range was 77–119 MiB
over those 20 cycles, returning to approximately 77 MiB at cycles 9 and 17 after
automatic garbage collection. The five-cycle pre-change reference was 73–93 MiB.
These development-mode samples show bounded retention without accumulating pages;
they are not an exact incremental-memory benchmark, a heap leak proof, or total
browser RAM (decoded artwork, GPU surfaces and browser caches are not included).
No production analytics, new dependency or unbounded route cache is added.

The hero action uses the shared availability state even when the season explorer
is enabled. Complete series show Available, missing seasons remain requestable,
and pending library checks show a disabled loading action. Static rendering tests
cover the 200709 regression and the downloading/requested/blocked states.

Season posters now use a compact wrapping grid inside the same content container
as the cast and synopsis. Status pills live inside each cover and are linked to
the opening button's accessible description; the quick-request button remains a
separate action. Opening a season mounts `SeasonDialog`, using the already installed
[Headless UI Dialog](https://headlessui.com/react/dialog) for focus containment,
background inertness, scroll locking, Escape/outside dismissal and focus return.
Episode filters, ten-episode page navigation and the scoped request form remain
inside the dialog. Closing unmounts episode fetching and its polling timer.

Media, genre, cast and episode rows also accept mouse dragging. After a six-pixel
horizontal threshold, the row captures the pointer and scrolls without smooth
animation or snapping; release restores those styles and consumes the synthetic
click so no cover opens accidentally. Normal clicks, keyboard activation, modified
clicks, quick-request buttons and native touch/trackpad scrolling remain available.
Window listeners exist only for the active gesture and are removed on release,
cancellation, window blur or Activity cleanup. No timers or render-per-move state
are added by this gesture.

Browser validation covers a 28-season grid at desktop and mobile widths (no
horizontal overflow, aligned content edges), dialog pagination and filtering,
request form open/cancel, Tab containment, Escape/outside dismissal and focus return.
Real pointer drags move cover and genre rows in both directions without navigation;
a subsequent normal click still starts the media reveal. Gesture regression tests
also cover jitter, buttons, native input, keyboard clicks and cleanup during a drag.
