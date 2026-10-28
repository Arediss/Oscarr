# Cover-to-detail navigation

`MediaLink` preserves normal link behavior and uses a 360 ms circular reveal for
same-tab cover activations (pointer or keyboard). The origin is the cover center,
clamped to the viewport; the circle reaches its farthest corner. Request buttons
remain separate actions. For sibling cover markup, mark the image with
`data-media-cover` so the origin does not come from the whole request card.

The native View Transition starts without waiting for metadata or artwork.
`MediaLink` commits navigation with `flushSync`; a local Suspense boundary and
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

The hero action uses the shared availability state even when the season explorer
is enabled. Complete series show Available, missing seasons remain requestable,
and pending library checks show a disabled loading action. Static rendering tests
cover the 200709 regression and the downloading/requested/blocked states.
