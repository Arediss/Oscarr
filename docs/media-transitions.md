# Cover-to-detail navigation

`MediaLink` preserves normal link behavior and uses a 360 ms circular reveal for
same-tab cover activations (pointer or keyboard). The origin is the cover center,
clamped to the viewport; the circle reaches its farthest corner. Request buttons
remain separate actions. For sibling cover markup, mark the image with
`data-media-cover` so the origin does not come from the whole request card.

The native View Transition holds the old snapshot until `MediaDetailPage` commits
its metadata and decodes its backdrop. A 1.2-second deadline skips the effect if
loading is slow, leaving the ordinary loading/error UI usable. Navigating elsewhere
cancels the pending reveal. Reduced motion or unsupported browsers navigate
immediately; reduced motion also disables the route's existing entrance animation.

Detail routes never receive the generic page fade. Temporarily suppressing that
animation during the circle restarts it on cleanup, causing a flash after the reveal.

Reference: [MDN ViewTransition.ready](https://developer.mozilla.org/en-US/docs/Web/API/ViewTransition/ready).

Verification: the frontend suite covers readiness, deadline, cancellation, native
snapshot failure, geometry and motion fallback. Browser checks use the real App,
MediaCard and lazy detail route with fixture API responses: desktop/mobile click,
Enter, return to search, focus, request action and console errors.
The post-reveal regression check counts `fadeIn` starts on the detail route wrapper:
one with temporary CSS suppression, zero after the fix, including a second keyboard
navigation on mobile. The settled wrapper stays at opacity 1 with no animation.
