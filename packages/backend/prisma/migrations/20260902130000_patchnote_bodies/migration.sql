-- Long-form release bodies, rendered as a document instead of the entry list.
--
-- Nullable columns: every release seeded before this keeps its `entries` list, and the client
-- falls back to it whenever `body` is null. Only 0.9.0 gets a body for now.
ALTER TABLE "Patchnote" ADD COLUMN "bodyEn" TEXT;
ALTER TABLE "Patchnote" ADD COLUMN "bodyFr" TEXT;

UPDATE "Patchnote"
SET "bodyEn" = '## No credentials left in the clear

Your service credentials have been encrypted since 0.8.1, but three were still readable: the Discord webhook and Telegram token used for notifications, the Discord client secret, and your instance API key. They sat in the clear in the database, and in every backup you have ever taken.

That is fixed, and your existing data is brought over on start. There is nothing for you to do.

## Knowing whether a title is really watchable

Until now a film went to "Available" as soon as Radarr or Sonarr had the file. But your media server may not have scanned it yet: the user clicks, and there is nothing there. On a library of 3,626 titles, that affected 76 films and series.

You can now have Oscarr wait for your media server to confirm before it calls a title available, separately for films and for series. A new **Imported** state marks what is downloaded but not yet visible.

And a series with only season 1 is no longer treated as complete: your users can ask for the seasons that are missing.

## Setting up goes better

Several problems reported during real installs:

- Refreshing the page during the wizard created your Radarr and Sonarr services twice.
- Reaching the end of the wizard left you stuck between two pages until you reloaded by hand.
- Pasting a Radarr URL into the Sonarr field said "connection successful", then sent your media to the wrong application.

If you run behind a reverse proxy, the compose file now documents `TRUST_PROXY`, `FORCE_HTTPS` and `COOKIE_SECURE`.

> Do set `TRUST_PROXY`. Without it Oscarr sees all your users as one person, so a handful of wrong passwords is enough to lock everyone out.

## Backups that actually restore

Restoring an old backup left your database in a state the installed version no longer understood. Oscarr now brings it up to date on its own, and if that fails it puts your previous database back rather than leaving you with something broken.

Two restores started at the same time can no longer overwrite each other.

Tested on a copy of a real 4,862-title database: 0.4 seconds, nothing lost.

## Plugins

Before installing a plugin, Oscarr checks that the archive it downloaded is the one that was published. If it does not match, the install stops.

> This is an integrity check, not a signature: it catches an archive swapped along the way, not a plugin whose release was compromised at the source.

A freshly installed plugin stays disabled while you look at its permissions. Oscarr now says so clearly, with a button to review them and switch it on straight away. And from a film or series page you can jump right to it in Radarr or Sonarr Manager.

## The rest

- Two admins approving the same request at the same moment no longer send it to Radarr or Sonarr twice.
- "It is available" notifications no longer go missing.
- Large imports from Seerr run to the end: the five-minute limit is gone.
- Pages load as you move around, which lightens the first screen.
- The update banner no longer offers to move you to a version older than the one you run.

## Thanks

Several fixes in this release came from **stefixstefi** on Discord, who ran Oscarr on his own server and reported everything that got in the way.',
    "bodyFr" = '## Plus aucun identifiant en clair dans la base

Les identifiants de vos services sont chiffrés depuis la 0.8.1, mais trois oublis restaient lisibles : le webhook Discord et le jeton Telegram des notifications, le client secret Discord, et la clé d''API de votre instance. Ils traînaient donc en clair dans la base, et dans toutes vos sauvegardes.

C''est corrigé, et vos données existantes sont reprises au démarrage. Vous n''avez rien à faire.

## Savoir si un titre est vraiment regardable

Jusqu''ici, un film passait en « Disponible » dès que Radarr ou Sonarr avait récupéré le fichier. Sauf que votre serveur multimédia ne l''a peut-être pas encore scanné : l''utilisateur clique, et il n''y a rien. Sur une bibliothèque de 3 626 titres, ça concernait 76 films et séries.

Vous pouvez maintenant demander à Oscarr d''attendre la confirmation de votre serveur multimédia avant d''annoncer un titre disponible, séparément pour les films et pour les séries. Un nouvel état **Importé** signale ce qui est téléchargé mais pas encore visible.

Et une série dont seule la saison 1 est là n''est plus considérée comme complète : vos utilisateurs peuvent demander les saisons qui manquent.

## L''installation se passe mieux

Plusieurs problèmes remontés pendant de vraies installations :

- Rafraîchir la page pendant l''assistant créait vos services Radarr et Sonarr en double.
- Arriver au bout de l''assistant vous coinçait entre deux pages jusqu''à un rechargement à la main.
- Coller une URL Radarr dans le champ Sonarr affichait « connexion réussie », puis envoyait vos médias à la mauvaise application.

Si vous êtes derrière un reverse proxy, le fichier compose documente maintenant `TRUST_PROXY`, `FORCE_HTTPS` et `COOKIE_SECURE`.

> Pensez à renseigner `TRUST_PROXY`. Sans elle, Oscarr voit tous vos utilisateurs comme une seule personne : quelques erreurs de mot de passe suffisent à bloquer les connexions de tout le monde.

## Des sauvegardes qui se restaurent vraiment

Restaurer une vieille sauvegarde laissait votre base dans un état que la version installée ne comprenait plus. Oscarr la met maintenant à jour tout seul, et si ça échoue, il remet votre base d''avant plutôt que de vous laisser avec quelque chose de cassé.

Deux restaurations lancées en même temps ne peuvent plus s''écraser l''une l''autre.

Testé sur une copie d''une vraie base de 4 862 titres : 0,4 seconde, rien de perdu.

## Plugins

Avant d''installer un plugin, Oscarr vérifie que l''archive téléchargée est bien celle qui a été publiée. Si elle ne correspond pas, l''installation s''arrête.

> C''est un contrôle d''intégrité, pas une signature : il repère une archive remplacée en cours de route, pas un plugin dont la publication elle-même serait compromise.

Un plugin fraîchement installé reste désactivé le temps que vous regardiez ses permissions. Oscarr vous le dit maintenant clairement, avec un bouton pour les vérifier et l''activer dans la foulée. Et depuis la fiche d''un film ou d''une série, vous pouvez sauter directement dessus dans Radarr ou Sonarr Manager.

## Le reste

- Deux administrateurs qui valident la même demande au même moment ne l''envoient plus deux fois à Radarr ou Sonarr.
- Les notifications « c''est disponible » ne se perdent plus en route.
- Les gros imports depuis Seerr vont jusqu''au bout : la limite de cinq minutes a sauté.
- Les pages se chargent au fur et à mesure de votre navigation, ce qui allège le premier affichage.
- La bannière de mise à jour ne vous propose plus de passer à une version plus ancienne que la vôtre.

## Merci

Plusieurs correctifs de cette version viennent de **stefixstefi**, sur Discord, qui a monté Oscarr sur son propre serveur et remonté tout ce qui coinçait.'
WHERE "version" = '0.9.0';
