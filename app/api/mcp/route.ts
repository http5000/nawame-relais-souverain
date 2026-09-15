// Relais souverain Nawame (Offre B, ADR 0024).
//
// Proxy MCP qui CHIFFRE réellement : reçoit les requêtes de l'IA, SCELLE le contenu
// des mémoires avant de le transmettre à Nawame, puis OUVRE le contenu chiffré des
// réponses avant de le rendre à l'IA. La passphrase vit dans SOUVERAIN_PASSPHRASE
// (secret Vercel) et le sel dans SOUVERAIN_SALT ; ni l'un ni l'autre, ni la clé, ni
// le texte en clair ne sont jamais transmis à Nawame. Toute la crypto est dans
// src/crypto-souverain.ts + src/souverain-transform.ts (auditables séparément).
//
// PORTE D'ENTRÉE : l'URL du relais est publique (Vercel). Le relais EXIGE donc un
// jeton d'accès entrant (Authorization: Bearer …), comparé en temps constant à
// NAWAME_API_KEY. Sans ce contrôle, quiconque connaît l'URL obtiendrait la lecture
// en clair de toute la mémoire : le relais déchiffrerait pour lui. Le corps de la
// requête n'est même pas lu tant que le jeton n'est pas validé.
//
// Auth vers Nawame : la même clé MCP Nawame (NAWAME_API_KEY) est retransmise à
// Nawame. Le « qui » est géré par Nawame.
//
// Contenu chiffré, métadonnées en clair : voir l'en-tête de souverain-transform.ts.

import { NextRequest, NextResponse } from 'next/server';
import { sealRequestRpc, openResponseRpc, SouverainRejected } from '../../../src/souverain-transform';

const NAWAME_MCP_URL = process.env.NAWAME_MCP_URL ?? 'https://hub.nawame.eu/api/mcp';
const RELAY_API_KEY = process.env.NAWAME_API_KEY;
const PASSPHRASE = process.env.SOUVERAIN_PASSPHRASE;
const SALT = process.env.SOUVERAIN_SALT;

// Le serveur MCP de Nawame exige que le client accepte LES DEUX formes de réponse.
// Avec un seul type, il répond 406 et le relais est inutilisable.
const UPSTREAM_ACCEPT = 'application/json, text/event-stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Jeton d'accès entrant ----------------------------------------------------

/**
 * Comparaison à TEMPS CONSTANT de deux chaînes (sans dépendance). Une comparaison
 * ordinaire (===) s'arrête au premier octet différent : le temps de réponse
 * trahirait le préfixe correct, et le jeton se devinerait octet par octet.
 * Ici on parcourt TOUJOURS toute la longueur et on accumule les différences.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // La différence de longueur est accumulée, pas court-circuitée.
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    const x = i < ab.length ? ab[i] : 0;
    const y = i < bb.length ? bb[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

/** Extrait le jeton d'un en-tête « Authorization: Bearer … » (null si absent). */
function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const m = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/** 401 sobre : ni indice sur le jeton attendu, ni détail de configuration. */
function unauthorized() {
  return NextResponse.json(
    { error: "accès refusé : jeton manquant ou invalide (en-tête Authorization: Bearer …)" },
    { status: 401, headers: { 'www-authenticate': 'Bearer' } },
  );
}

// --- Réponses de refus --------------------------------------------------------

/** Réponse JSON-RPC de refus (outil refusé par le relais) : rien n'a été transmis. */
function rejected(id: unknown, message: string) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result: {
      isError: true,
      content: [{ type: 'text', text: `Mode souverain (relais) : ${message}` }],
    },
  };
}

// --- Flux SSE -----------------------------------------------------------------

/**
 * Le serveur MCP peut répondre en text/event-stream. On parse alors chaque trame
 * `data:`, on ouvre le JSON-RPC qu'elle contient, et on ré-émet un flux SSE
 * équivalent (mêmes en-têtes de trame, même content-type). Une trame qu'on n'a pas
 * su parser est relayée TELLE QUELLE : on ne prétend jamais avoir déchiffré ce
 * qu'on n'a pas compris.
 */
async function transformSseBody(raw: string): Promise<string> {
  const blocks = raw.split(/\r?\n\r?\n/);
  const rebuilt: string[] = [];
  for (const block of blocks) {
    if (block.trim() === '') continue;
    const lines = block.split(/\r?\n/);
    const otherLines: string[] = []; // event:, id:, retry:, commentaires…
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      else otherLines.push(line);
    }
    if (dataLines.length === 0) {
      rebuilt.push(lines.join('\n'));
      continue;
    }
    const payload = dataLines.join('\n');
    let out = payload;
    try {
      const parsed: unknown = JSON.parse(payload);
      const opened = Array.isArray(parsed)
        ? await Promise.all(parsed.map((item) => openResponseRpc(item)))
        : await openResponseRpc(parsed);
      out = JSON.stringify(opened);
    } catch {
      // trame non JSON (ou ouverture impossible) : relayée telle quelle
      out = payload;
    }
    rebuilt.push([...otherLines, ...out.split('\n').map((l) => `data: ${l}`)].join('\n'));
  }
  return rebuilt.join('\n\n') + '\n\n';
}

// --- Relais -------------------------------------------------------------------

/** En-têtes MCP à retransmettre vers Nawame (session, protocole, reprise de flux). */
const FORWARDED_REQUEST_HEADERS = ['mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
/** En-têtes MCP à rendre au client dans la réponse. */
const FORWARDED_RESPONSE_HEADERS = ['mcp-session-id', 'mcp-protocol-version'];

export async function POST(req: NextRequest) {
  if (!RELAY_API_KEY || !PASSPHRASE || !SALT) {
    return NextResponse.json(
      { error: 'relais non configuré (NAWAME_API_KEY, SOUVERAIN_PASSPHRASE ou SOUVERAIN_SALT manquant)' },
      { status: 500 },
    );
  }

  // 0) Jeton d'accès entrant, AVANT de lire le corps. Le relais est un oracle de
  //    déchiffrement : sans cette barrière, l'URL publique suffirait à tout lire.
  const token = bearerToken(req);
  if (!token || !timingSafeEqual(token, RELAY_API_KEY)) return unauthorized();

  let payload: unknown;
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: 'corps JSON-RPC invalide' }, { status: 400 });
  }

  const batch = Array.isArray(payload);
  const items = (batch ? payload : [payload]) as Array<{ id?: unknown; method?: string; params?: { name?: string } }>;

  // 1) Sceller les écritures AVANT toute transmission. Si un outil est refusé
  //    (fail-closed, y compris un outil inconnu du relais), on refuse SANS jamais
  //    transmettre de clair : en unitaire on répond le refus ; en lot on refuse
  //    tout le lot (rare).
  try {
    for (let i = 0; i < items.length; i++) {
      items[i] = await sealRequestRpc(items[i]);
    }
  } catch (e) {
    if (e instanceof SouverainRejected) {
      if (!batch) return NextResponse.json(rejected(items[0]?.id, e.message));
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: `Mode souverain (relais) : ${e.message} (lot entier refusé)` },
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: 'échec du scellement souverain' }, { status: 500 });
  }

  // 2) Transmettre à Nawame. On annonce accepter LES DEUX formes de réponse
  //    (JSON et flux SSE) : le serveur MCP l'exige, sans quoi il répond 406.
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: UPSTREAM_ACCEPT,
    authorization: `Bearer ${RELAY_API_KEY}`,
  };
  for (const h of FORWARDED_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }

  const upstream = await fetch(NAWAME_MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(batch ? items : items[0]),
  });

  const contentType = upstream.headers.get('content-type') ?? '';
  const outHeaders: Record<string, string> = {};
  for (const h of FORWARDED_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) outHeaders[h] = v;
  }

  const raw = await upstream.text();

  // 3a) Réponse en flux SSE : ouvrir chaque trame et ré-émettre un flux équivalent.
  if (contentType.includes('text/event-stream')) {
    let body: string;
    try {
      body = await transformSseBody(raw);
    } catch {
      return NextResponse.json({ error: "échec de l'ouverture souveraine" }, { status: 500 });
    }
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        ...outHeaders,
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  }

  // 3b) Réponse JSON.
  let response: unknown;
  try {
    response = JSON.parse(raw);
  } catch {
    // Réponse ni JSON ni SSE (erreur amont, page HTML…) : on relaie telle quelle,
    // sans rien prétendre déchiffrer.
    return new NextResponse(raw, {
      status: upstream.status,
      headers: { ...outHeaders, 'content-type': contentType || 'application/json' },
    });
  }

  try {
    if (Array.isArray(response)) {
      response = await Promise.all(response.map((r) => openResponseRpc(r)));
    } else {
      response = await openResponseRpc(response);
    }
  } catch {
    return NextResponse.json({ error: "échec de l'ouverture souveraine" }, { status: 500 });
  }

  return NextResponse.json(response, { status: upstream.status, headers: outHeaders });
}

export async function GET() {
  const ready = Boolean(RELAY_API_KEY && PASSPHRASE && SALT);
  // Page de statut publique : elle dit si le relais est prêt, RIEN d'autre. Ni
  // l'adresse amont, ni quel secret manque, ni quoi que ce soit d'exploitable.
  return NextResponse.json({
    relay: 'nawame-relais-souverain',
    // « crypto:active » = le relais scelle/ouvre réellement (pas un simple proxy).
    crypto: ready ? 'active' : 'inactive',
    configured: ready,
    note: ready
      ? "Relais prêt. Le contenu des mémoires est chiffré avant Nawame et déchiffré au retour. Les appels exigent un jeton d'accès."
      : 'Relais incomplet : configuration manquante (voir le README).',
  });
}
