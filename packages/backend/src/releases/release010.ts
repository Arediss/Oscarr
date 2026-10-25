export const release010 = {
  version: '0.10.0',
  type: 'minor',
  date: new Date('2026-10-25T00:00:00.000Z'),
  titleEn: 'Season covers and clearer requests',
  titleFr: 'Des saisons illustrées et des demandes plus claires',
  entries: '[]',
  bodyFr: `## Les saisons ont leur affiche

Les fiches films et séries adoptent un fond panoramique plus lisible, des portraits de casting arrondis et une présentation harmonisée des collections. Chaque saison possède désormais sa propre affiche, avec celle de la série en secours. Les informations sous les covers sont hiérarchisées : année et nombre d’épisodes, badge d’état avec icône, compteur et jauge des épisodes disponibles. Une disponibilité inconnue est signalée sans afficher de faux zéro.

Le bouton **Demander la série** mène aux saisons. Leur disponibilité et leurs demandes en cours sont visibles sur les covers. Le **+**, identique à celui du portail, demande directement la saison complète. Un clic sur l’affiche ouvre les épisodes dans la page.

## Les épisodes, même avant une demande

Les titres, résumés et dates des épisodes viennent de TMDB. Ils restent consultables lorsque la série n’est pas encore suivie dans Sonarr. La disponibilité est ajoutée quand Sonarr peut la fournir ; une information inconnue n’est plus présentée comme un épisode manquant.

Une demande de saison sur une série déjà présente dans Sonarr ne recherche que les saisons sélectionnées. Les demandes équivalentes vers la même qualité et le même service sont reconnues pour éviter les doublons.

## Une carte par média et par demandeur

Les demandes de plusieurs saisons sont regroupées sur une carte compacte de taille habituelle. Au survol, le cadre de la carte s’étend pour afficher les saisons et leurs états dans des labels côte à côte, triés de la saison 1 à la dernière. Il se replie quand la souris en sort, sans déplacer la grille. Une seule carte est étendue à la fois. La flèche fonctionne aussi au clic et au clavier. Le regroupement est conservé lors du chargement des pages suivantes. Les actions restent propres à chaque demande.

Les titres restent visibles pendant les téléchargements et permettent d’ouvrir la fiche du média. Les demandes de collections respectent maintenant le réglage global d’auto-approbation, comme les demandes individuelles. Ce correctif ne valide pas rétroactivement les demandes déjà en attente.

## Fiabilité et mises à jour

Les liens de lecture et la navigation des plugins cinéma sont conservés. Les tâches planifiées respectent le service propriétaire du média. Les scripts Docker conservent leurs fins de ligne Unix, et le serveur peut écouter sur une adresse définie avec HOST.

Les dépendances de l’application et les actions GitHub de construction, de signature et d’archivage sont mises à jour. Les correctifs de sécurité parus depuis les propositions Dependabot de septembre sont inclus.

Cette version ne modifie pas le schéma de la base. Ces notes sont enregistrées au démarrage de façon idempotente.`,
  bodyEn: `## Season covers

Movie and series pages have a more readable panoramic backdrop, round cast portraits and a consistent collection layout. Each season now has its own poster, falling back to the series poster when needed. Information below each cover has a clearer hierarchy: year and episode count, an icon status badge, and a count and meter for available episodes. Unknown availability is shown explicitly without a misleading zero.

**Request series** leads to the seasons. Covers show availability and existing requests. The **+**, shared with the portal, requests the entire season directly. Clicking the poster opens its episodes within the page.

## Episodes before a request

Episode titles, summaries and air dates come from TMDB. They remain available even when Sonarr does not track the series yet. Library availability is added when Sonarr can provide it; an unknown state is no longer shown as a missing episode.

Requesting a season for a series already in Sonarr searches only the selected seasons. Equivalent requests targeting the same quality and service are detected to prevent duplicates.

## One card per title and requester

Multiple season requests share a compact card at the usual size. Hovering extends the card frame to show seasons and their states as labels side by side, sorted from season 1 to the last. It collapses when the pointer leaves without moving the grid. Only one card expands at a time. The arrow also supports click and keyboard interaction. Groups stay together when loading more pages. Actions still apply to individual requests.

Titles remain visible during downloads and link to the media page. Collection requests now follow the global automatic approval setting, just like individual requests. This fix does not retroactively approve existing pending requests.

## Reliability and updates

Cinema plugin playback links and navigation are preserved. Scheduled jobs respect the service that owns each title. Docker scripts keep Unix line endings, and HOST can bind the server to a specific address.

Application dependencies and the GitHub actions for building, signing and archiving have been updated, including security fixes published after the September Dependabot proposals.

This release does not change the database schema. These notes are registered idempotently at startup.`,
};
