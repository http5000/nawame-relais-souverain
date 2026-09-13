# Nawame Relais Souverain

Relais de déchiffrement souverain Nawame — mode « souveraineté client »
(zero-knowledge, ADR 0024). **Ce dépôt ne nous appartient pas** : il est fait
pour être déployé par **le client** sur **son propre compte Vercel**, afin que
la clé de déchiffrement ne quitte jamais un endroit qu'il contrôle.

## Guide de déploiement complet

Déploiement en 6 étapes (copier-coller, ~30 min) :

1. **Use this template** sur ce dépôt GitHub → votre fork.
2. Importer dans Vercel.
3. Deux variables d'env : `NAWAME_API_KEY` (votre clé MCP) +
   `SOUVERAIN_PASSPHRASE` (votre passphrase).
4. Déployer → récupérer l'URL `https://mon-relais.vercel.app`.
5. Dans votre IA, remplacer l'URL MCP Nawame par l'URL de votre relais.
6. Tester.

## Statut

Template v1. Le socle crypto (`src/crypto-souverain.ts`) est partagé avec
Nawame (même code). Le proxy MCP (`app/api/mcp/route.ts`) transmet les requêtes
à Nawame avec la clé API du compte ; le déchiffrement du contenu chiffré se
branche ici selon le format de réponse MCP stabilisé côté Nawame (point
d'intégration documenté dans le code).

## Licence

MIT.
