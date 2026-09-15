# Nawame Relais Souverain / Sovereign Relay

Relais de déchiffrement souverain Nawame — mode « souveraineté client »
(zero-knowledge, ADR 0024). **Ce dépôt ne nous appartient pas** : il est fait
pour être déployé par **le client** sur **son propre compte Vercel**, afin que la
clé de déchiffrement ne quitte jamais un endroit qu'il contrôle.

---

Sovereign decryption relay for Nawame — « client sovereignty » mode
(zero-knowledge, ADR 0024). **This repo is not ours**: it is meant to be
deployed by **the client** on **their own Vercel account**, so the decryption
key never leaves a place they control.

---

## FR — Guide de déploiement pour les nuls

Vous n'avez besoin d'aucune compétence technique. Suivez chaque étape une à une.
Comptez environ 30 minutes. Tout est gratuit.

### Ce que vous allez obtenir

Une adresse internet à vous (ex. `https://mon-nawame.vercel.app`) qui joue le
rôle de relais entre votre IA et Nawame. Votre IA envoie ses requêtes à ce relais
au lieu de Nawame directement. Le relais détient votre passphrase (en secret,
dans Vercel). Il **chiffre** le contenu de vos mémoires avant de l'envoyer à
Nawame, et le **déchiffre** au retour avant de le rendre à l'IA. Nawame ne voit
donc jamais que du contenu chiffré : elle ne peut rien lire. Les **titres, tags,
noms de dossiers et dates** restent en clair côté Nawame (pour la navigation).

### Prérequis (tout gratuit)

- Un compte **GitHub** gratuit (si vous n'en avez pas : https://github.com/signup).
- Un compte **Vercel** gratuit (https://vercel.com/signup — vous pouvez vous
  inscrire directement avec votre compte GitHub, c'est le plus simple).
- Votre **clé d'API Nawame** (la même que celle que vous mettez dans votre IA).
  Vous la trouvez dans Nawame : Console › Mon compte › Accès MCP.
- Une **passphrase** longue et unique de VOTRE choix (≥ 12 caractères) : c'est
  elle qui chiffre vos mémoires. Notez-la dans un coffre (Bitwarden…). Avec le
  relais, vous n'avez **pas besoin** d'activer le mode souverain dans la console
  Nawame : le relais fait tout le chiffrement.
- Un **sel** : un second texte long et aléatoire (≥ 16 caractères), non secret
  mais à garder stable (tapez au hasard, gardez-le). Il aide à recalculer la clé.

### Étape 1 — Copier ce dépôt sur votre GitHub

1. Ouvrez cette page : https://github.com/http5000/nawame-relais-souverain
2. En haut à droite, cliquez sur **Use this template** › **Create a new repository**.
3. Donnez un nom, par exemple `mon-relais-nawame`.
4. Laissez **Public** (c'est un template, il n'y a aucun secret dedans).
5. Cliquez **Create repository**. Vous avez maintenant votre propre copie.

### Étape 2 — Connecter Vercel à votre GitHub

1. Allez sur https://vercel.com/signup.
2. Cliquez **Continue with GitHub** et autorisez Vercel à voir vos dépôts.
3. Une fois connecté, cliquez **Add New…** › **Project**.
4. Dans la liste, sélectionnez votre dépôt `mon-relais-nawame`.
5. Vercel détecte automatiquement Next.js. Ne changez rien, cliquez **Deploy**.
6. Vercel installe et démarre. En 1–2 minutes vous obtenez une URL verte.

> Le déploiement initial échoue tant que les secrets ne sont pas mis (c'est
> normal — voir l'étape 3). Ce n'est pas grave : on le relancera après.

### Étape 3 — Ajouter vos trois secrets dans Vercel

Ces valeurs sont stockées CHEZ VOUS, dans Vercel. Elles ne nous sont jamais
transmises. Vercel les injecte dans le relais au démarrage, sans les afficher.

1. Dans votre projet Vercel, allez dans **Settings** › **Environment Variables**.
2. Ajoutez la première variable :
   - **Name** : `NAWAME_API_KEY`
   - **Value** : collez votre clé d'API Nawame (de Console › Mon compte › Accès MCP).
   - **Environment** : cochez Production, Preview, Development (les trois).
3. Ajoutez la deuxième variable :
   - **Name** : `SOUVERAIN_PASSPHRASE`
   - **Value** : votre passphrase (la phrase longue et unique).
   - **Environment** : cochez les trois.
4. Ajoutez la troisième variable :
   - **Name** : `SOUVERAIN_SALT`
   - **Value** : votre sel (un second texte long et aléatoire, ≥ 16 caractères).
     Non secret, mais **ne le changez plus** ensuite (sinon vos mémoires déjà
     écrites deviennent illisibles).
   - **Environment** : cochez les trois.
5. Cliquez **Save**.
6. Retournez dans **Deployments**, ouvrez le dernier, cliquez **Redeploy**.
   Cette fois le démarrage réussit (les secrets sont présents).

### Étape 4 — Récupérer votre adresse de relais

1. En haut de votre projet Vercel, copiez l'URL affichée (ex.
   `https://mon-relais-nawame.vercel.app`).
2. Testez-la dans votre navigateur : elle doit afficher
   `{"relay":"nawame-relais-souverain","crypto":"active","configured":true,…}`.
   Si `crypto` n'est pas `"active"`, un secret manque (revoir l'étape 3).
   Cette page ne dit rien d'autre : ni votre clé, ni votre passphrase, ni quel
   secret manque. C'est voulu, elle est visible de tous.

### Étape 5 — Brancher votre IA sur le relais

Là où vous avez mis l'URL MCP de Nawame dans votre IA (ChatGPT, Claude, Cursor,
etc.), remplacez l'ancienne URL par votre nouvelle URL de relais, suivie de
`/api/mcp`. Exemple :

```
Avant :  https://hub.nawame.eu/api/mcp
Après :  https://mon-relais-nawame.vercel.app/api/mcp
```

Gardez la même clé d'API que vous aviez déjà. C'est tout.

**Important : cette clé est aussi le mot de passe de votre relais.** L'adresse de
votre relais est publique (n'importe qui peut la deviner), donc le relais REFUSE
toute requête qui n'apporte pas votre clé d'API Nawame (réponse « 401 »). Sans ce
verrou, une personne qui connaîtrait l'adresse ferait déchiffrer vos mémoires par
votre propre relais. Votre IA envoie déjà cette clé automatiquement : vous n'avez
rien de plus à faire, mais ne publiez jamais votre clé, et ne la mettez pas dans
une IA à laquelle vous ne voulez pas donner accès à vos mémoires.

### Étape 6 — Vérifier que ça marche

1. Dans votre IA, demandez : « quelle est ma dernière mémoire ? »
2. L'IA interroge votre relais → le relais interroge Nawame avec votre clé →
   Nawame renvoie le contenu chiffré → le relais le déchiffre avec votre
   passphrase → l'IA vous répond en clair.
3. Nawame n'a vu que du chiffré. La passphrase n'a jamais quitté Vercel.

### Sécurité — lire avant de déployer

- Votre passphrase est stockée uniquement dans Vercel (variable d'env, chiffrée
  par Vercel). Elle ne nous est jamais envoyée.
- Vercel est américain, mais ne détient QUE la clé de déchiffrement, jamais le
  contenu (le contenu chiffré reste chez Nawame). Sans le contenu, la clé seule
  ne sert à rien.
- Si vous perdez votre passphrase, vos mémoires chiffrées deviennent
  DÉFINITIVEMENT illisibles. Sauvegardez-la dans un coffre (Bitwarden, 1Password…).
- Vous pouvez déployer le relais où vous voulez (Vercel, Railway, un VPS). Vercel
  est le plus simple pour démarrer gratuitement.

**Ce qui est protégé, et ce qui reste en clair.** Le relais chiffre le **contenu**
de vos mémoires. Restent en clair côté Nawame, par nécessité de navigation :
**titres, tags, noms de dossiers, dates, journal des lectures**. Ne mettez donc
pas de secret dans un titre ou un tag.

**Une limite à connaître.** L'outil de remplacement d'un passage précis
(`replace_section`) est **désactivé** via le relais : le serveur ne peut pas
retrouver un morceau de texte dans du contenu chiffré. Pour modifier une mémoire,
faites réécrire l'ensemble (l'IA utilise alors `update_entry`). L'ajout en fin de
mémoire, lui, fonctionne normalement.

**Le relais refuse ce qu'il ne connaît pas.** Le relais ne laisse passer que les
outils qu'il a appris à traiter. Tout outil nouveau ou inconnu est **refusé**, et
rien n'est envoyé à Nawame : mieux vaut un refus qu'un texte qui part en clair par
surprise. Concrètement, votre IA vous dira « cet outil est indisponible via le
relais ». Sont refusés aujourd'hui :

- `replace_section` (le serveur devrait lire votre texte pour retrouver le passage) ;
- `share_conversation` et `engrave_conversation` (partager ou graver s'adresse à
  d'autres personnes, qui n'ont pas votre passphrase : le texte serait soit
  illisible pour elles, soit lisible par Nawame) ;
- `report_bug` et `submit_feedback` (ces textes sont destinés à l'équipe Nawame,
  ils partiraient donc en clair ; passez par la console Nawame) ;
- `unlock_souverain`, `lock_souverain`, `souverain_status` (ils appartiennent à
  l'autre formule, celle où c'est le serveur qui chiffre : ils transporteraient
  votre passphrase jusqu'à Nawame). Ces trois-là sont même retirés de la liste
  des outils : votre IA ne les voit plus du tout.

**Ce que le relais chiffre exactement.** Le texte de vos mémoires, le résumé des
modifications, le corps de vos outils personnels, la description de vos dossiers
racines, les motifs et notes que vous écrivez, et le descriptif de vos pointeurs
de secrets. Restent en clair : titres, tags, noms de dossiers, dates, adresses
e-mail, identifiants, et les mots-clés que vous tapez dans une recherche (le
serveur ne peut de toute façon plus chercher dans le contenu chiffré : il ne
retrouve que les titres et les tags).

**Un contenu structuré est chiffré rubrique par rubrique.** Quand votre IA range
une mémoire en rubriques (une décision avec son énoncé, ses motifs, les pistes
écartées, une suite à donner…), le relais chiffre le **texte** de toutes les
rubriques, y compris celles qu'il ne connaît pas et celles imbriquées les unes
dans les autres. Il n'y a pas de liste de rubriques « à chiffrer » : le TEXTE de
chaque rubrique est chiffré, à toute profondeur ; en revanche le NOM des
rubriques, comme les titres et les tags, reste en clair : n'y mettez pas de
secret. Et si votre IA envoie un champ sous une forme que le relais ne sait pas
chiffrer, l'appel est **refusé** plutôt que transmis : elle vous dira que ce champ
doit être du texte, et rien ne sera parti chez Nawame.

---

## EN — Step-by-step deployment guide for absolute beginners

You need zero technical skills. Follow each step one at a time. Allow about
30 minutes. Everything is free.

### What you will get

Your own internet address (e.g. `https://my-nawame.vercel.app`) that acts as a
relay between your AI and Nawame. Your AI sends its requests to this relay
instead of Nawame directly. The relay holds your passphrase (as a secret, in
Vercel). It **encrypts** your memory content before sending it to Nawame, and
**decrypts** it on the way back before handing it to the AI. Nawame therefore
only ever sees encrypted content: it cannot read anything. **Titles, tags, folder
names and dates** stay in clear on Nawame's side (for navigation).

### Prerequisites (all free)

- A free **GitHub** account (if you don't have one: https://github.com/signup).
- A free **Vercel** account (https://vercel.com/signup — you can sign up
directly with your GitHub account, which is simplest).
- Your **Nawame API key** (the same one you put in your AI). Find it in Nawame:
  Console › My account › MCP access.
- A long, unique **passphrase** of YOUR choice (≥ 12 chars): this is what
  encrypts your memories. Write it down in a vault (Bitwarden…). With the relay
  you do **not** need to activate sovereign mode in the Nawame console: the relay
  does all the encryption.
- A **salt**: a second long, random text (≥ 16 chars), not secret but keep it
  stable (mash the keyboard, keep it). It helps recompute the key.

### Step 1 — Copy this repo to your GitHub

1. Open this page: https://github.com/http5000/nawame-relais-souverain
2. Top right, click **Use this template** › **Create a new repository**.
3. Give it a name, e.g. `my-nawame-relay`.
4. Leave it **Public** (this is a template, no secret lives inside it).
5. Click **Create repository**. You now have your own copy.

### Step 2 — Connect Vercel to your GitHub

1. Go to https://vercel.com/signup.
2. Click **Continue with GitHub** and authorize Vercel to see your repos.
3. Once connected, click **Add New…** › **Project**.
4. In the list, select your `my-nawame-relay` repo.
5. Vercel auto-detects Next.js. Change nothing, click **Deploy**.
6. Vercel installs and starts. In 1–2 minutes you get a green URL.

> The initial deploy will fail until the secrets are added (that's normal —
> see Step 3). Don't worry: we'll redeploy after.

### Step 3 — Add your three secrets in Vercel

These values are stored WITH YOU, in Vercel. They are never sent to us.
Vercel injects them into the relay at startup, without displaying them.

1. In your Vercel project, go to **Settings** › **Environment Variables**.
2. Add the first variable:
   - **Name**: `NAWAME_API_KEY`
   - **Value**: paste your Nawame API key (from Console › My account › MCP access).
   - **Environment**: check Production, Preview, Development (all three).
3. Add the second variable:
   - **Name**: `SOUVERAIN_PASSPHRASE`
   - **Value**: your passphrase (the long, unique phrase).
   - **Environment**: check all three.
4. Add the third variable:
   - **Name**: `SOUVERAIN_SALT`
   - **Value**: your salt (a second long, random text, ≥ 16 chars). Not secret,
     but **do not change it** afterwards (or memories already written become
     unreadable).
   - **Environment**: check all three.
5. Click **Save**.
6. Go back to **Deployments**, open the latest, click **Redeploy**.
   This time startup succeeds (the secrets are present).

### Step 4 — Get your relay address

1. At the top of your Vercel project, copy the displayed URL (e.g.
   `https://my-nawame-relay.vercel.app`).
2. Test it in your browser: it should show
   `{"relay":"nawame-relais-souverain","crypto":"active","configured":true,…}`.
   If `crypto` is not `"active"`, a secret is missing (redo Step 3).
   That page says nothing else: not your key, not your passphrase, not which
   secret is missing. That is on purpose, since anyone can open it.

### Step 5 — Point your AI at the relay

Wherever you put the Nawame MCP URL in your AI (ChatGPT, Claude, Cursor, etc.),
replace the old URL with your new relay URL, followed by `/api/mcp`. Example:

```
Before:  https://hub.nawame.eu/api/mcp
After:   https://my-nawame-relay.vercel.app/api/mcp
```

Keep the same API key you already had. That's it.

**Important: that key is also your relay's password.** Your relay address is
public (anyone could guess it), so the relay REFUSES any request that does not
carry your Nawame API key (it answers « 401 »). Without that lock, anyone knowing
the address would have your own relay decrypt your memories for them. Your AI
already sends the key automatically, so there is nothing more to do, but never
publish your key, and do not put it in an AI you do not want to give access to
your memories.

### Step 6 — Verify it works

1. In your AI, ask: “what is my latest memory?”
2. The AI queries your relay → the relay queries Nawame with your key →
   Nawame returns encrypted content → the relay decrypts it with your
   passphrase → the AI answers you in clear.
3. Nawame only saw encrypted data. The passphrase never left Vercel.

### Security — read before deploying

- Your passphrase is stored only in Vercel (env variable, encrypted by Vercel).
  It is never sent to us.
- Vercel is US-based, but it only holds the decryption key, never the content
  (encrypted content stays at Nawame). Without the content, the key alone is
  useless.
- If you lose your passphrase, your encrypted memories become PERMANENTLY
  unreadable. Back it up in a vault (Bitwarden, 1Password…).
- You can deploy the relay anywhere you want (Vercel, Railway, a VPS). Vercel
  is the simplest way to start for free.

**What is protected, and what stays in clear.** The relay encrypts your memory
**content**. What stays in clear on Nawame's side, for navigation: **titles, tags,
folder names, dates, read journal**. So never put a secret in a title or a tag.

**One limitation to know.** The "replace an exact passage" tool (`replace_section`)
is **disabled** through the relay: the server cannot find a piece of text inside
encrypted content. To edit a memory, have the AI rewrite the whole thing (it then
uses `update_entry`). Appending to the end of a memory works normally.

**The relay refuses what it does not know.** The relay only lets through the tools
it was taught to handle. Any new or unknown tool is **refused**, and nothing is
sent to Nawame: better a refusal than text leaving in clear by surprise. Your AI
will simply say "this tool is unavailable through the relay". Refused today:

- `replace_section` (the server would have to read your text to find the passage);
- `share_conversation` and `engrave_conversation` (sharing or engraving targets
  other people, who do not have your passphrase: the text would be either
  unreadable for them, or readable by Nawame);
- `report_bug` and `submit_feedback` (these texts are meant for the Nawame team,
  so they would leave in clear; use the Nawame console instead);
- `unlock_souverain`, `lock_souverain`, `souverain_status` (they belong to the
  other offer, the one where the server encrypts: they would carry your
  passphrase all the way to Nawame). Those three are even removed from the tool
  list: your AI does not see them at all.

**What the relay encrypts, exactly.** The text of your memories, the change
summaries, the body of your personal tools, the description of your root folders,
the reasons and notes you write, and the description of your secret pointers.
Left in clear: titles, tags, folder names, dates, e-mail addresses, identifiers,
and the keywords you type in a search (the server cannot search encrypted content
anyway: it only matches titles and tags).

**Structured content is encrypted section by section.** When your AI files a
memory into sections (a decision with its statement, its reasons, the options set
aside, a next step…), the relay encrypts the **text** of every section, including
the ones it does not know about and the ones nested inside others. There is no
list of sections "to be encrypted": the TEXT of each section is encrypted, at any
depth; the section NAMES, however, like titles and tags, stay in clear: do not put
a secret in them. And if your AI sends a field in a shape the relay cannot
encrypt, the call is **refused** rather than forwarded: it will tell you that
field must be text, and nothing will have left for Nawame.

---

## Statut / Status

v3. Le relais chiffre RÉELLEMENT. Le socle crypto (`src/crypto-souverain.ts`)
est partagé avec Nawame (même code). La transformation MCP
(`src/souverain-transform.ts`) **scelle** le contenu des écritures avant de les
transmettre et **ouvre** le contenu chiffré des lectures au retour ; le proxy
(`app/api/mcp/route.ts`) reste une fine couche HTTP. Périmètre : contenu chiffré,
métadonnées (titres, tags, dossiers, dates) en clair.

Nouveautés v3 : jeton d'accès entrant obligatoire (comparaison à temps constant),
dialogue MCP complet (JSON et flux SSE), **refus par défaut** de tout outil non
reconnu, outils de session souveraine refusés ET retirés du catalogue, résumés de
modification scellés comme le contenu, **scellement en profondeur** de tout objet
de contenu (toute clé, toute imbrication, tableaux compris), refus d'un champ à
sceller qui n'est pas du texte, et jeton déjà scellé reconnu par **ouverture
effective** (jamais sur sa seule apparence). Tests : `npm test` (sans dépendance,
Node 22).

v3. The relay ACTUALLY encrypts. The crypto core (`src/crypto-souverain.ts`) is
shared with Nawame (same code). The MCP transform (`src/souverain-transform.ts`)
**seals** write content before forwarding and **opens** encrypted read content on
the way back; the proxy (`app/api/mcp/route.ts`) stays a thin HTTP layer. Scope:
content encrypted, metadata (titles, tags, folders, dates) in clear.

New in v3: mandatory incoming access token (constant-time comparison), full MCP
dialogue (JSON and SSE stream), **deny by default** for any unrecognized tool,
sovereign-session tools refused AND removed from the catalog, change summaries
sealed like content, **deep sealing** of any content object (every key, every
nesting level, arrays included), refusal of a to-be-sealed field that is not text,
and already-sealed tokens recognized by **actually opening them** (never by their
shape alone). Tests: `npm test` (no dependency, Node 22).

## Licence / License

MIT.
