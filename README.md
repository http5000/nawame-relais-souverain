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

### Étape 5 — Brancher votre IA sur le relais

Là où vous avez mis l'URL MCP de Nawame dans votre IA (ChatGPT, Claude, Cursor,
etc.), remplacez l'ancienne URL par votre nouvelle URL de relais, suivie de
`/api/mcp`. Exemple :

```
Avant :  https://hub.nawame.eu/api/mcp
Après :  https://mon-relais-nawame.vercel.app/api/mcp
```

Gardez la même clé d'API que vous aviez déjà. C'est tout.

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

### Step 5 — Point your AI at the relay

Wherever you put the Nawame MCP URL in your AI (ChatGPT, Claude, Cursor, etc.),
replace the old URL with your new relay URL, followed by `/api/mcp`. Example:

```
Before:  https://hub.nawame.eu/api/mcp
After:   https://my-nawame-relay.vercel.app/api/mcp
```

Keep the same API key you already had. That's it.

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

---

## Statut / Status

v2. Le relais chiffre RÉELLEMENT. Le socle crypto (`src/crypto-souverain.ts`)
est partagé avec Nawame (même code). La transformation MCP
(`src/souverain-transform.ts`) **scelle** le contenu des écritures avant de les
transmettre et **ouvre** le contenu chiffré des lectures au retour ; le proxy
(`app/api/mcp/route.ts`) reste une fine couche HTTP. Périmètre : contenu chiffré,
métadonnées (titres, tags, dossiers, dates) en clair. `replace_section` est
refusé (fail-closed) faute de pouvoir chercher dans du chiffré.

v2. The relay ACTUALLY encrypts. The crypto core (`src/crypto-souverain.ts`) is
shared with Nawame (same code). The MCP transform (`src/souverain-transform.ts`)
**seals** write content before forwarding and **opens** encrypted read content on
the way back; the proxy (`app/api/mcp/route.ts`) stays a thin HTTP layer. Scope:
content encrypted, metadata (titles, tags, folders, dates) in clear.
`replace_section` is refused (fail-closed) since encrypted content cannot be
searched.

## Licence / License

MIT.
