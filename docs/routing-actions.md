# Routing actions

Rules still use the first matching enabled rule. Its actions can combine a root folder,
a Sonarr series type, and one or more existing Sonarr/Radarr tags. The editor offers
« Ajouter une action » and removable action rows, using the existing admin styling.

Creation and editing open in a modal above the rules list. The content scrolls while the
title and save/cancel controls stay visible. Escape, the close button and the backdrop close
it; focus is trapped and returned to the trigger. Closing and form inputs are disabled during
saving, and a failed save keeps the form and its error visible.

Tags belong to an explicit service instance, even when no folder override is selected.
Each displayed tag is paired with the instance's icon, configured name and unique service ID,
both in the rule summary and editor. The tooltip includes the provider and instance URL.
Tag catalogs are fetched once per referenced instance and shared by the list and editor;
missing, disabled or unreachable instances never fall back to another instance's tag labels.
The editor discovers routing/media/tag capabilities through `/admin/service-schemas`, not
Sonarr/Radarr name checks. See [the service tag contract](./providers.md#service-tag-capability).
Changing the instance clears selected tag IDs. Tags are fetched through the authenticated
admin API; loading, empty, unavailable and deleted-tag states are visible. French and
English labels are required. Existing rules start with no tag actions.

The API accepts `tagIds: number[]`; SQLite stores the array as JSON alongside the existing
folder/type fields. Writes validate the tags against the selected instance. Partial edits
retain omitted tags; duplication copies them. A deleted service must never redirect its
tag IDs to another instance. Dispatch combines rule tags with optional requester tagging,
deduplicates them and adds them to existing media without removing its tags.

Implementation order: persistence/API and tests, dispatch and tests, then editor/runtime
verification. Source stays in the existing backend services/providers and frontend admin
components. No new dependencies, publishing or changes to unrelated rules are needed.

Validation: `npm run test --workspace=packages/backend -- test/routingTags.test.ts`,
`npm test`, `npm run build`, and a browser exercise of create/edit, multiple actions,
instance changes, and failed tag loading. Tests use temporary databases and fake services.

API references: [Sonarr](https://github.com/Sonarr/Sonarr/blob/develop/src/Sonarr.Api.V3/openapi.json)
and [Radarr](https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/openapi.json).

Apply the additive database migration with `npm run db:migrate` before starting the updated
backend. Existing rows receive an empty tag list; folder and series-type actions are preserved.

Verified locally: 244 backend tests, 112 frontend tests, production build, and browser
exercises using simulated Sonarr/Radarr responses. The editor was checked at desktop and
390px widths, including saved tags, multiple tags, removal, a tag-only Radarr rule,
identical folder paths on different instances and an unreachable instance. No live media
was added to a real Sonarr/Radarr library during verification. Multi-instance badges were also
checked at 320px, including two instances with tag ID 7 but different labels (VOSTFR/VF),
selection resets, offline tags and saving. Contract tests register a fake Readarr tag adapter
without an ArrClient to verify provider-independent discovery, fetching and additive updates.
