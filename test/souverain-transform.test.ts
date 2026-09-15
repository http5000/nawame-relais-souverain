// Tests du relais souverain Nawame.
//
// Exécutables SANS aucune dépendance (Node 22) :
//   npm test
//   node --experimental-strip-types --test test/souverain-transform.test.ts
//
// Chaque test porte le nom de la faille d'audit qu'il ferme. Le principe : si un
// jour un de ces tests repasse au rouge, la promesse commerciale (« aucun humain
// ni admin Nawame ne peut lire les mémoires en clair ») n'est plus tenue.
//
// Note de résolution : le code source importe « ./crypto-souverain » SANS extension,
// parce que c'est ce que Next.js et tsc attendent (une extension .ts dans un import
// fait échouer `next build`, donc le déploiement Vercel du client). Node, lui, exige
// l'extension : on la lui fournit ici par un crochet de résolution, sans dépendance
// et sans toucher au code de production.

import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
// Imports de TYPE seulement (effacés à l'exécution) : ils donnent les types des
// modules chargés plus bas par import dynamique.
import type * as TransformModule from '../src/souverain-transform';
import type * as RouteModule from '../app/api/mcp/route';

registerHooks({
  resolve(specifier, context, nextResolve) {
    // « ./crypto-souverain » -> « ./crypto-souverain.ts »
    if (specifier.startsWith('.') && !/\.[mc]?[jt]s$/.test(specifier)) {
      try {
        return nextResolve(specifier + '.ts', context);
      } catch {
        // pas de .ts : on laisse la résolution normale répondre
      }
    }
    // « next/server » -> « next/server.js » (hors runtime Next)
    if (specifier === 'next/server') {
      try {
        return nextResolve('next/server.js', context);
      } catch {
        // idem
      }
    }
    return nextResolve(specifier, context);
  },
});

// La configuration doit exister AVANT le chargement des modules (ils lisent l'env).
process.env.SOUVERAIN_PASSPHRASE = 'passphrase-de-test-tres-longue-et-unique';
process.env.SOUVERAIN_SALT = 'sel-de-test-stable-et-assez-long-0123456789';
process.env.NAWAME_API_KEY = 'cle-mcp-de-test-0123456789';
process.env.NAWAME_MCP_URL = 'https://hub.nawame.eu/api/mcp';

// Les chemins sont construits à l'exécution : Node veut l'extension .ts, tsc ne
// l'accepte pas dans un import statique. Les types viennent des imports de type.
const { MARKER, HIDDEN_TOOLS, SouverainRejected, sealRequestRpc, openResponseRpc } = (await import(
  new URL('../src/souverain-transform.ts', import.meta.url).href
)) as typeof TransformModule;

// --- Petits utilitaires -------------------------------------------------------

type Args = Record<string, unknown>;

function call(name: string, args: Args): { jsonrpc: string; id: number; method: string; params: { name: string; arguments: Args } } {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
}

/** Réponse MCP telle que Nawame la rend : un bloc texte porteur de JSON sérialisé. */
function textResponse(payload: unknown) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
  };
}

function isToken(v: unknown): boolean {
  return typeof v === 'string' && /^NAWSOUV1:[A-Za-z0-9_-]+$/.test(v);
}

/** Scelle une chaîne isolée en passant par le chemin de production (write_note). */
async function sealOne(plain: string): Promise<string> {
  const rpc = await sealRequestRpc(call('write_note', { text: plain }));
  return rpc.params.arguments.text as string;
}

/** Ouvre une chaîne isolée en passant par le chemin de production (réponse MCP). */
async function openOne(raw: string): Promise<string> {
  const opened = await openResponseRpc(textResponse({ v: raw }));
  return (JSON.parse(opened.result.content[0].text) as { v: string }).v;
}

async function rejection(name: string, args: Args = {}): Promise<Error> {
  const before = JSON.stringify(args);
  try {
    await sealRequestRpc(call(name, args));
  } catch (e) {
    // fail-closed : la requête ne doit pas avoir été modifiée non plus
    assert.equal(JSON.stringify(args), before, 'les arguments ne doivent pas être touchés');
    return e as Error;
  }
  throw new Error(`l'outil « ${name} » aurait dû être refusé`);
}

// --- 1. Round-trip : le clair revient intact, le JSON reste valide -------------

test('round-trip : guillemets, sauts de ligne et accents traversent sans casser le JSON', async () => {
  const plain = 'Il a dit : "on garde le cap".\nLigne 2 avec accents éàü et un antislash \\ et une accolade }';
  const sealed = await sealOne(plain);

  assert.ok(sealed.startsWith(MARKER), 'le champ doit être scellé');
  assert.ok(isToken(sealed), 'le champ scellé doit être un jeton bien formé');
  assert.ok(!sealed.includes('cap'), 'aucun morceau de clair ne doit rester');

  // Le bloc texte de la réponse est du JSON sérialisé : il doit rester parsable.
  const opened = await openResponseRpc(textResponse({ text: sealed, title: 'Cap produit' }));
  const parsed = JSON.parse(opened.result.content[0].text) as { text: string; title: string };
  assert.equal(parsed.text, plain);
  assert.equal(parsed.title, 'Cap produit');
});

test('round-trip : structuredContent est ouvert lui aussi', async () => {
  const sealed = await sealOne('contenu structuré');
  const rpc = { jsonrpc: '2.0', id: 1, result: { structuredContent: { entry: { text: sealed } } } };
  const opened = await openResponseRpc(rpc);
  assert.deepEqual(opened.result.structuredContent, { entry: { text: 'contenu structuré' } });
});

// --- 2. Faille 3 : un texte qui COMMENCE par le marqueur doit être scellé ------

test('faille 3 : un texte commençant par « NAWSOUV1: » est scellé, pas laissé en clair', async () => {
  const piege = 'NAWSOUV1: mon code de coffre est 4829, ne le dis à personne';
  const sealed = await sealOne(piege);

  assert.ok(isToken(sealed), 'le texte piégé doit ressortir scellé');
  assert.ok(!sealed.includes('4829'), 'le secret ne doit pas partir en clair');
  assert.equal(await openOne(sealed), piege, 'et il doit se rouvrir à l’identique');
});

test('faille 3 : un contenu déjà scellé n’est pas scellé une deuxième fois', async () => {
  const sealed = await sealOne('texte déjà scellé');
  const rpc = await sealRequestRpc(call('write_note', { text: sealed }));
  assert.equal(rpc.params.arguments.text, sealed, 'pas de double scellement');
});

// --- 3. Faille 4 : refus par défaut de tout outil non classé ------------------

test('faille 4 : un outil inconnu du relais est REFUSÉ, rien n’est transmis', async () => {
  const e = await rejection('outil_invente_par_nawame_demain', { text: 'contenu très privé' });
  assert.ok(e instanceof SouverainRejected);
  assert.match(e.message, /n’est pas reconnu|n'est pas reconnu/);
  assert.match(e.message, /Rien n’a été transmis|Rien n'a été transmis/);
});

test('faille 4 : add_tool scelle son corps (il écrit une mémoire entière)', async () => {
  const rpc = await sealRequestRpc(call('add_tool', { title: 'Ma directive', body: 'Toujours répondre en français.' }));
  const args = rpc.params.arguments as { title: string; body: string };
  assert.ok(isToken(args.body), 'le corps de la directive doit être scellé');
  assert.equal(args.title, 'Ma directive', 'le titre reste en clair (navigation)');
});

test('faille 4 : report_bug et submit_feedback sont refusés (texte destiné à Nawame)', async () => {
  const bug = await rejection('report_bug', { body: 'extrait de ma mémoire confidentielle' });
  assert.match(bug.message, /report_bug/);
  const feedback = await rejection('submit_feedback', {
    time_saved: 'nettement',
    would_recommend: 'oui',
    comment: 'un commentaire qui cite ma mémoire',
  });
  assert.match(feedback.message, /submit_feedback/);
});

test('faille 4 : replace_section reste refusé (le serveur ne sait pas chercher dans du chiffré)', async () => {
  const e = await rejection('replace_section', { entry_id: 'x', old_text: 'a', new_text: 'b' });
  assert.match(e.message, /replace_section/);
  assert.match(e.message, /update_entry/);
});

test('faille 4 : les outils de lecture et de navigation passent tels quels', async () => {
  const lecture = await sealRequestRpc(call('search_memory', { query: 'tarifs 2026', limit: 5 }));
  assert.deepEqual(lecture.params.arguments, { query: 'tarifs 2026', limit: 5 });
  const nav = await sealRequestRpc(call('whoami', {}));
  assert.deepEqual(nav.params.arguments, {});
});

test('faille 4 : les méthodes de protocole (initialize, tools/list) passent', async () => {
  const init = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } };
  assert.deepEqual(await sealRequestRpc(init), init);
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  assert.deepEqual(await sealRequestRpc(list), list);
});

test('faille 4 : un tools/call sans nom d’outil est refusé', async () => {
  let levee: unknown = null;
  try {
    await sealRequestRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { arguments: { text: 'secret' } } });
  } catch (e) {
    levee = e;
  }
  assert.ok(levee instanceof SouverainRejected, 'un appel sans nom doit être refusé');
});

// --- 4. Faille 5 : la passphrase ne part jamais chez Nawame -------------------

test('faille 5 : unlock_souverain est refusé et sa passphrase n’est pas transmise', async () => {
  const e = await rejection('unlock_souverain', { passphrase: 'ma-vraie-passphrase' });
  assert.match(e.message, /unlock_souverain/);
  assert.match(e.message, /passphrase/);
  assert.ok(!e.message.includes('ma-vraie-passphrase'), 'le message ne doit pas répéter la passphrase');
});

test('faille 5 : lock_souverain et souverain_status sont refusés aussi', async () => {
  assert.ok((await rejection('lock_souverain', {})) instanceof SouverainRejected);
  assert.ok((await rejection('souverain_status', {})) instanceof SouverainRejected);
});

test('faille 5 : tools/list ne montre même plus les outils de session souveraine', async () => {
  const catalogue = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        { name: 'write_note' },
        { name: 'unlock_souverain' },
        { name: 'lock_souverain' },
        { name: 'souverain_status' },
        { name: 'read_memory' },
      ],
    },
  };
  const opened = await openResponseRpc(catalogue);
  const noms = opened.result.tools.map((t) => t.name);
  assert.deepEqual(noms, ['write_note', 'read_memory']);
  for (const cache of HIDDEN_TOOLS) assert.ok(!noms.includes(cache));
});

// --- 5. Faille 6 : le résumé de modification est du contenu ------------------

test('faille 6 : change_summary est scellé (update_entry et append_to_conversation)', async () => {
  const maj = await sealRequestRpc(
    call('update_entry', {
      entry_id: 'aaaa',
      text: 'nouveau contenu',
      change_summary: 'ajout du budget 2026 : 45 000 euros',
    }),
  );
  const a = maj.params.arguments as { text: string; change_summary: string; entry_id: string };
  assert.ok(isToken(a.text));
  assert.ok(isToken(a.change_summary), 'le résumé dit la substance : il doit être scellé');
  assert.ok(!a.change_summary.includes('45 000'));
  assert.equal(a.entry_id, 'aaaa', 'les identifiants restent en clair');

  const ajout = await sealRequestRpc(
    call('append_to_conversation', { entry_id: 'aaaa', text: 'bloc', change_summary: 'résumé du bloc' }),
  );
  const b = ajout.params.arguments as { change_summary: string };
  assert.ok(isToken(b.change_summary));
});

test('faille 6 : l’objet content d’update_entry est scellé champ par champ', async () => {
  const rpc = await sealRequestRpc(
    call('update_entry', {
      entry_id: 'bbbb',
      content: {
        statement: 'on part sur Vercel',
        rationale: 'moins cher et plus simple',
        alternatives_considered: ['un VPS dédié', 'Railway'],
      },
    }),
  );
  const c = (rpc.params.arguments as { content: Record<string, unknown> }).content;
  assert.ok(isToken(c.statement));
  assert.ok(isToken(c.rationale));
  const alts = c.alternatives_considered as string[];
  assert.ok(alts.every(isToken), 'chaque alternative doit être scellée');
});

// --- 6. Blocs concaténés (append) --------------------------------------------

test('append : plusieurs blocs scellés concaténés sont tous rouverts', async () => {
  const a = await sealOne('premier bloc');
  const b = await sealOne('deuxième bloc');
  const c = await sealOne('troisième bloc');
  const stocke = `${a}\n\n${b}\n\n${c}`;
  assert.equal(await openOne(stocke), 'premier bloc\n\ndeuxième bloc\n\ntroisième bloc');
});

test('append : un jeton illisible est réinséré tel quel, jamais présenté comme du clair', async () => {
  const a = await sealOne('bloc lisible');
  const faux = 'NAWSOUV1:AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ouvert = await openOne(`${a}\n\n${faux}`);
  assert.equal(ouvert, `bloc lisible\n\n${faux}`);
});

// --- 7. Faille 7 : un marqueur DANS le clair ne corrompt rien -----------------

test('faille 7 : un marqueur présent dans le texte déchiffré ne corrompt pas la sortie', async () => {
  // On fabrique le cas exact qui cassait : le clair du premier bloc CITE le jeton
  // du second bloc. Un remplacement par motif aurait écrasé la citation.
  const jetonB = await sealOne('SECRET DU BLOC B');
  const clairA = `je cite ce jeton ${jetonB} au milieu de ma phrase`;
  const jetonA = await sealOne(clairA);

  const ouvert = await openOne(`${jetonA}\n\n${jetonB}`);
  assert.equal(ouvert, `${clairA}\n\nSECRET DU BLOC B`);
  // La citation reste intacte, et le vrai bloc B est bien ouvert une seule fois.
  assert.equal(ouvert.indexOf('SECRET DU BLOC B'), ouvert.lastIndexOf('SECRET DU BLOC B'));
});

test('faille 7 : un même jeton répété est ouvert à chacune de ses positions', async () => {
  const jeton = await sealOne('valeur répétée');
  assert.equal(await openOne(`${jeton} / ${jeton}`), 'valeur répétée / valeur répétée');
});

// --- 8. Périmètre : les métadonnées restent en clair --------------------------

test('périmètre : titre, dossier et tags ne sont PAS scellés', async () => {
  const rpc = await sealRequestRpc(
    call('write_note', {
      title: 'Budget 2026',
      text: 'le contenu confidentiel',
      folder: 'clients/acme',
      tags: ['budget', 'acme'],
      binding: 'info',
    }),
  );
  const a = rpc.params.arguments as Record<string, unknown>;
  assert.equal(a.title, 'Budget 2026');
  assert.equal(a.folder, 'clients/acme');
  assert.deepEqual(a.tags, ['budget', 'acme']);
  assert.equal(a.binding, 'info');
  assert.ok(isToken(a.text), 'seul le contenu est scellé');
});

test('périmètre : le pointeur de secret garde son nom en clair mais scelle le descriptif', async () => {
  const rpc = await sealRequestRpc(
    call('set_secret', { name: 'cle-stripe', location: 'coffre équipe, collection Paiements', usage: 'facturation' }),
  );
  const a = rpc.params.arguments as Record<string, unknown>;
  assert.equal(a.name, 'cle-stripe');
  assert.ok(isToken(a.location));
  assert.ok(isToken(a.usage));
});

// --- 9. La porte d'entrée du relais (faille 2) et le dialogue MCP (faille 1) ---

const route = (await import(new URL('../app/api/mcp/route.ts', import.meta.url).href)) as typeof RouteModule;

function relayRequest(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new Request('https://mon-relais.vercel.app/api/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Remplace fetch le temps d'un appel et retient ce qui est parti vers Nawame. */
async function withUpstream(
  reponse: Response,
  fn: () => Promise<Response>,
): Promise<{ res: Response; sent: { url: string; headers: Record<string, string>; body: string } | null }> {
  const vrai = globalThis.fetch;
  let sent: { url: string; headers: Record<string, string>; body: string } | null = null;
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const i = init as { headers: Record<string, string>; body: string };
    sent = { url: String(url), headers: i.headers, body: i.body };
    return reponse;
  }) as typeof globalThis.fetch;
  try {
    const res = await fn();
    return { res, sent };
  } finally {
    globalThis.fetch = vrai;
  }
}

test('faille 2 : sans jeton d’accès, le relais répond 401 et n’appelle pas Nawame', async () => {
  const vrai = globalThis.fetch;
  let appele = false;
  globalThis.fetch = (async () => {
    appele = true;
    return new Response('{}');
  }) as typeof globalThis.fetch;
  try {
    const res = await route.POST(relayRequest(call('read_memory', {})) as never);
    assert.equal(res.status, 401);
    assert.equal(appele, false, 'aucune requête ne doit partir vers Nawame');
  } finally {
    globalThis.fetch = vrai;
  }
});

test('faille 2 : avec un mauvais jeton, le relais répond 401 (même longueur ou non)', async () => {
  for (const faux of ['', 'mauvais', 'cle-mcp-de-test-0123456788', 'cle-mcp-de-test-0123456789-en-plus']) {
    const res = await route.POST(relayRequest(call('read_memory', {}), faux) as never);
    assert.equal(res.status, 401, `jeton « ${faux} » : doit être refusé`);
  }
});

test('faille 2 : le GET de statut ne divulgue rien de sensible', async () => {
  const res = await route.GET();
  const body = (await res.json()) as Record<string, unknown>;
  const texte = JSON.stringify(body);
  assert.equal(body.relay, 'nawame-relais-souverain');
  assert.equal(body.crypto, 'active');
  assert.ok(!texte.includes(process.env.NAWAME_API_KEY as string));
  assert.ok(!texte.includes(process.env.SOUVERAIN_PASSPHRASE as string));
  assert.ok(!texte.includes(process.env.SOUVERAIN_SALT as string));
  assert.ok(!texte.includes('hub.nawame.eu'), "l'adresse amont n'a pas à être publiée");
});

test('faille 1 : le relais annonce accepter JSON ET text/event-stream', async () => {
  const amont = new Response(JSON.stringify(textResponse({ ok: true })), {
    headers: { 'content-type': 'application/json' },
  });
  const { res, sent } = await withUpstream(amont, () =>
    route.POST(relayRequest(call('read_memory', {}), process.env.NAWAME_API_KEY as string) as never),
  );
  assert.equal(res.status, 200);
  assert.ok(sent, 'la requête doit partir vers Nawame');
  assert.equal(sent.headers.accept, 'application/json, text/event-stream');
  assert.equal(sent.headers.authorization, `Bearer ${process.env.NAWAME_API_KEY}`);
});

test('faille 1 : une réponse en flux SSE est ouverte et ré-émise en flux SSE', async () => {
  const sealed = await sealOne('contenu de ma mémoire');
  const trame = `event: message\ndata: ${JSON.stringify(textResponse({ text: sealed }))}\n\n`;
  const amont = new Response(trame, { headers: { 'content-type': 'text/event-stream' } });
  const { res } = await withUpstream(amont, () =>
    route.POST(relayRequest(call('read_memory', {}), process.env.NAWAME_API_KEY as string) as never),
  );
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const body = await res.text();
  assert.match(body, /^event: message$/m);
  const ligne = body.split('\n').find((l) => l.startsWith('data: ')) as string;
  const rpc = JSON.parse(ligne.slice(6)) as { result: { content: Array<{ text: string }> } };
  assert.deepEqual(JSON.parse(rpc.result.content[0].text), { text: 'contenu de ma mémoire' });
});

test('faille 1 : une trame SSE non JSON est relayée telle quelle, sans prétendre l’ouvrir', async () => {
  const amont = new Response(': ping\n\ndata: pas du json\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });
  const { res } = await withUpstream(amont, () =>
    route.POST(relayRequest(call('read_memory', {}), process.env.NAWAME_API_KEY as string) as never),
  );
  const body = await res.text();
  assert.match(body, /: ping/);
  assert.match(body, /data: pas du json/);
});

test('fail-closed : un outil refusé n’atteint jamais Nawame', async () => {
  const vrai = globalThis.fetch;
  let appele = false;
  globalThis.fetch = (async () => {
    appele = true;
    return new Response('{}');
  }) as typeof globalThis.fetch;
  try {
    const res = await route.POST(
      relayRequest(
        call('unlock_souverain', { passphrase: 'ma-vraie-passphrase' }),
        process.env.NAWAME_API_KEY as string,
      ) as never,
    );
    assert.equal(appele, false, 'rien ne doit partir vers Nawame');
    const rpc = (await res.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    assert.equal(rpc.result.isError, true);
    assert.match(rpc.result.content[0].text, /unlock_souverain/);
    assert.ok(!rpc.result.content[0].text.includes('ma-vraie-passphrase'));
  } finally {
    globalThis.fetch = vrai;
  }
});

// --- 10. Round 2 : le fail-open déplacé (contenu libre, types, faux jetons) ----
//
// Ces quatre cas viennent d'un sondage adversarial de la route complète : le
// scellement ne doit dépendre NI d'une liste de clés connues, NI du type reçu,
// NI de l'APPARENCE d'une valeur, et le refus par défaut ne doit pas pouvoir être
// contourné par un nom d'outil hérité d'Object.prototype.

const SECRET = 'MONTANT-SECRET-45000-EUROS';

/** Envoie un tools/call par la route COMPLÈTE et rend le corps parti vers Nawame. */
async function bodySentToNawame(name: string, args: Args): Promise<string> {
  const amont = new Response(JSON.stringify(textResponse({ ok: true })), {
    headers: { 'content-type': 'application/json' },
  });
  const { sent } = await withUpstream(amont, () =>
    route.POST(relayRequest(call(name, args), process.env.NAWAME_API_KEY as string) as never),
  );
  assert.ok(sent, 'la requête devait partir vers Nawame');
  return sent.body;
}

/** Joue un appel par la route en interdisant toute sortie : rend la réponse rendue. */
async function relayWithoutUpstream(body: unknown): Promise<Response> {
  const vrai = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('aucune requête ne devait partir vers Nawame');
  }) as typeof globalThis.fetch;
  try {
    return await route.POST(relayRequest(body, process.env.NAWAME_API_KEY as string) as never);
  } finally {
    globalThis.fetch = vrai;
  }
}

test('round 2 : une clé de contenu INCONNUE est scellée (rien ne dépend d’une liste de clés)', async () => {
  const rpc = await sealRequestRpc(
    call('update_entry', { entry_id: 'cccc', content: { statement: 'decision', next_steps: SECRET } }),
  );
  const c = (rpc.params.arguments as { content: Record<string, unknown> }).content;
  assert.ok(isToken(c.statement), 'une clé connue reste scellée');
  assert.ok(isToken(c.next_steps), 'une clé INCONNUE doit être scellée elle aussi');
});

test('round 2 : contenu imbriqué et tableaux : aucun clair n’atteint Nawame', async () => {
  const body = await bodySentToNawame('update_entry', {
    entry_id: 'cccc',
    content: { statement: 'ok', nested: { a: SECRET }, notes: [SECRET, { b: { c: SECRET } }] },
  });
  assert.ok(!body.includes(SECRET), 'aucun morceau de clair ne doit partir, à aucune profondeur');
  assert.ok(body.includes('"entry_id":"cccc"'), 'les identifiants restent en clair (navigation)');
});

test('round 2 : le contenu scellé en profondeur se rouvre à l’identique', async () => {
  const contenu = { statement: 'ok', nested: { a: SECRET }, notes: [SECRET, { b: 'suite' }], n: 3 };
  const rpc = await sealRequestRpc(call('update_entry', { entry_id: 'cccc', content: structuredClone(contenu) }));
  const scelle = (rpc.params.arguments as { content: unknown }).content;
  const opened = await openResponseRpc(textResponse(scelle));
  assert.deepEqual(JSON.parse(opened.result.content[0].text), contenu);
});

test('round 2 : un champ à sceller qui n’est PAS du texte est refusé (fail-closed sur le type)', async () => {
  const e = await rejection('write_note', { title: 'Budget', text: [SECRET] });
  assert.ok(e instanceof SouverainRejected);
  assert.match(e.message, /write_note/);
  assert.match(e.message, /text/);
  assert.match(e.message, /Rien n’a été transmis|Rien n'a été transmis/);
  assert.ok(!e.message.includes(SECRET), 'le refus ne répète jamais le contenu');
});

test('round 2 : ce refus de type ne laisse RIEN partir vers Nawame', async () => {
  const res = await relayWithoutUpstream(call('write_note', { text: { valeur: SECRET } }));
  assert.equal(res.status, 200);
  const rpc = (await res.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
  assert.equal(rpc.result.isError, true);
  assert.match(rpc.result.content[0].text, /write_note/);
  assert.ok(!JSON.stringify(rpc).includes(SECRET), 'le secret ne revient pas dans le refus');
});

test('round 2 : une chaîne en FORME de jeton mais non ouvrable est scellée, pas laissée en clair', async () => {
  const faux = MARKER + Buffer.from(SECRET, 'utf8').toString('base64url');
  assert.ok(isToken(faux), 'le piège doit bien avoir la forme d’un jeton');

  const sealed = await sealOne(faux);
  assert.notEqual(sealed, faux, 'un jeton qui ne s’ouvre pas n’est pas des nôtres : il doit être scellé');
  assert.ok(!sealed.includes(faux.slice(MARKER.length)), 'le base64 lisible ne doit pas traverser');
  assert.equal(await openOne(sealed), faux, 'et il se rouvre à l’identique');

  const body = await bodySentToNawame('write_note', { text: faux });
  assert.ok(!body.includes(faux.slice(MARKER.length)), 'rien de lisible ne part vers Nawame');
});

test('round 2 : un outil au nom hérité d’Object.prototype est refusé proprement', async () => {
  for (const piege of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    const e = await rejection(piege, { text: 'contenu très privé' });
    assert.ok(e instanceof SouverainRejected, `« ${piege} » doit être refusé`);
    assert.match(e.message, /Rien n’a été transmis|Rien n'a été transmis/);
  }
});

test('round 2 : « constructor » via la route rend un refus lisible, pas une erreur 500', async () => {
  const res = await relayWithoutUpstream(call('constructor', { text: SECRET }));
  assert.equal(res.status, 200, 'un refus, pas une erreur opaque');
  const rpc = (await res.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
  assert.equal(rpc.result.isError, true);
  assert.match(rpc.result.content[0].text, /constructor/);
});

// --- 11. Round 3 : le fail-open sur les CONTENEURS (arguments, méthode) --------
//
// Deux résidus prouvés par sonde d'exécution sur la route complète : le relais
// contrôlait le CONTENU des champs, mais laissait passer tel quel un CONTENEUR
// d'une forme inattendue. Un tableau, une chaîne, ou une méthode autre que
// « tools/call » suffisaient à faire sortir du clair. Le principe est le même que
// partout ailleurs ici : une forme que le relais ne sait pas chiffrer est refusée,
// jamais transmise.

/** Joue un corps JSON-RPC brut par la route, fetch piégé : il LÈVE s'il est appelé. */
async function refusSansSortie(body: unknown): Promise<string> {
  const res = await relayWithoutUpstream(body);
  assert.equal(res.status, 200, 'un refus lisible, pas une erreur opaque');
  const rpc = (await res.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
  assert.equal(rpc.result.isError, true, 'la réponse doit être un refus');
  const texte = JSON.stringify(rpc);
  assert.ok(!texte.includes(SECRET), 'le refus ne répète jamais le contenu');
  return rpc.result.content[0].text;
}

test('round 3 : des arguments en TABLEAU sont refusés, rien ne part vers Nawame', async () => {
  const brut = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_note', arguments: [SECRET] } };
  // a) au niveau du transformateur
  let levee: unknown = null;
  try {
    await sealRequestRpc(structuredClone(brut));
  } catch (e) {
    levee = e;
  }
  assert.ok(levee instanceof SouverainRejected, 'un tableau d’arguments doit être refusé');
  assert.match((levee as Error).message, /Rien n’a été transmis|Rien n'a été transmis/);
  // b) sur la route complète, fetch piégé : aucune sortie possible
  const texte = await refusSansSortie(brut);
  assert.match(texte, /write_note/);
});

test('round 3 : des arguments en CHAÎNE sont refusés, rien ne part vers Nawame', async () => {
  const brut = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_note', arguments: SECRET } };
  let levee: unknown = null;
  try {
    await sealRequestRpc(structuredClone(brut));
  } catch (e) {
    levee = e;
  }
  assert.ok(levee instanceof SouverainRejected, 'une chaîne d’arguments doit être refusée');
  const texte = await refusSansSortie(brut);
  assert.match(texte, /write_note/);
});

test('round 3 : arguments absents ou null — le refus de l’OUTIL reste prioritaire', async () => {
  // Un outil refusé ou inconnu doit être refusé même sans conteneur d'arguments :
  // le retour anticipé sur « arguments absents » ne doit pas court-circuiter la porte.
  for (const piege of ['unlock_souverain', 'replace_section', 'outil_invente_demain', 'constructor']) {
    for (const args of [undefined, null]) {
      const params: Record<string, unknown> = { name: piege };
      if (args !== undefined) params.arguments = args;
      const texte = await refusSansSortie({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });
      assert.match(texte, new RegExp(piege), `« ${piege} » doit rester refusé`);
    }
  }
  // Et un outil SÛR sans arguments passe toujours (non-régression).
  const sansArgs = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami' } };
  assert.deepEqual(await sealRequestRpc(structuredClone(sansArgs)), sansArgs);
  const avecNull = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: null } };
  assert.deepEqual(await sealRequestRpc(structuredClone(avecNull)), avecNull);
});

test('round 3 : une méthode hors liste blanche portant du contenu est refusée', async () => {
  for (const methode of ['tools/write', 'tools/CALL', 'resources/read', '', 'notifications']) {
    const brut = {
      jsonrpc: '2.0',
      id: 1,
      method: methode,
      params: { name: 'write_note', arguments: { text: SECRET } },
    };
    let levee: unknown = null;
    try {
      await sealRequestRpc(structuredClone(brut));
    } catch (e) {
      levee = e;
    }
    assert.ok(levee instanceof SouverainRejected, `la méthode « ${methode} » doit être refusée`);
    assert.ok(!(levee as Error).message.includes(SECRET), 'le refus ne répète jamais le contenu');
    await refusSansSortie(brut); // fetch piégé : rien ne part
  }
});

test('round 3 : les méthodes de la liste blanche passent normalement', async () => {
  const passants: unknown[] = [
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
    { jsonrpc: '2.0', id: 3, method: 'prompts/list', params: {} },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  ];
  for (const p of passants) {
    assert.deepEqual(await sealRequestRpc(structuredClone(p)), p, 'doit traverser tel quel');
  }
  // Et par la route : tools/list part bien vers Nawame, inchangé.
  const amont = new Response(JSON.stringify(textResponse({ ok: true })), {
    headers: { 'content-type': 'application/json' },
  });
  const { res, sent } = await withUpstream(amont, () =>
    route.POST(
      relayRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, process.env.NAWAME_API_KEY as string) as never,
    ),
  );
  assert.equal(res.status, 200);
  assert.ok(sent, 'tools/list doit bien atteindre Nawame');
  assert.equal(sent.body, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
});

test('round 3 : non-régression — un appel légitime scelle toujours correctement', async () => {
  // write_note par la route complète
  const note = await bodySentToNawame('write_note', { title: 'Budget 2026', text: SECRET, tags: ['budget'] });
  assert.ok(!note.includes(SECRET), 'le texte ne part jamais en clair');
  assert.ok(note.includes('"title":"Budget 2026"'), 'le titre reste en clair (navigation)');
  assert.ok(note.includes(MARKER), 'le texte part bien scellé');

  // update_entry avec contenu structuré, par la route complète
  const maj = await bodySentToNawame('update_entry', {
    entry_id: 'dddd',
    text: SECRET,
    change_summary: SECRET,
    content: { statement: SECRET, nested: { a: [SECRET] } },
  });
  assert.ok(!maj.includes(SECRET), 'aucun clair, à aucune profondeur');
  assert.ok(maj.includes('"entry_id":"dddd"'));

  // et l'aller-retour reste exact
  const rpc = await sealRequestRpc(call('write_note', { text: SECRET }));
  const sealed = rpc.params.arguments.text as string;
  assert.ok(isToken(sealed));
  assert.equal(await openOne(sealed), SECRET);
});

test('round 3 : un champ FRÈRE hors des arguments est refusé, rien ne part vers Nawame', async () => {
  // Le relais ne scelle que `params.arguments`. Un champ de contenu posé À CÔTÉ
  // échapperait au scellement et sortirait en clair — que les arguments soient
  // nuls, valides, ou que le champ soit accroché à l'enveloppe JSON-RPC elle-même.
  const pieges: Array<[string, unknown]> = [
    [
      'params.text avec arguments null',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_note', arguments: null, text: SECRET } },
    ],
    [
      'params.text avec arguments valides',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'write_note', arguments: { text: 'anodin' }, text: SECRET },
      },
    ],
    [
      'champ frère sur l’enveloppe JSON-RPC',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_note', arguments: { text: 'anodin' } }, text: SECRET },
    ],
  ];
  for (const [libelle, brut] of pieges) {
    let levee: unknown = null;
    try {
      await sealRequestRpc(structuredClone(brut));
    } catch (e) {
      levee = e;
    }
    assert.ok(levee instanceof SouverainRejected, `${libelle} : doit être refusé`);
    assert.ok(!(levee as Error).message.includes(SECRET), 'le refus ne répète jamais le contenu');
    await refusSansSortie(brut); // fetch piégé : rien ne part
  }
});

test('round 3 : le champ de protocole _meta reste accepté (non-régression MCP)', async () => {
  const avecMeta = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'whoami', arguments: {}, _meta: { progressToken: 't1' } },
  };
  assert.deepEqual(await sealRequestRpc(structuredClone(avecMeta)), avecMeta);
});
