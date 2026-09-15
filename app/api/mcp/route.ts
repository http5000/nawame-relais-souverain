// Relais souverain Nawame (Offre B, ADR 0024).
//
// Proxy MCP qui CHIFFRE réellement : reçoit les requêtes de l'IA, SCELLE le contenu
// des mémoires avant de le transmettre à Nawame, puis OUVRE le contenu chiffré des
// réponses avant de le rendre à l'IA. La passphrase vit dans SOUVERAIN_PASSPHRASE
// (secret Vercel) et le sel dans SOUVERAIN_SALT ; ni l'un ni l'autre, ni la clé, ni
// le texte en clair ne sont jamais transmis à Nawame. Toute la crypto est dans
// src/crypto-souverain.ts + src/souverain-transform.ts (auditables séparément).
//
// Auth : la même clé MCP Nawame (NAWAME_API_KEY) sert pour l'IA (qui l'envoie au
// relais) et pour Nawame (le relais la transmet). Le « qui » est géré par Nawame.
//
// Contenu chiffré, métadonnées en clair : voir l'en-tête de souverain-transform.ts.

import { NextRequest, NextResponse } from 'next/server';
import { sealRequestRpc, openResponseRpc, SouverainRejected } from '../../../src/souverain-transform';

const NAWAME_MCP_URL = process.env.NAWAME_MCP_URL ?? 'https://hub.nawame.eu/api/mcp';
const RELAY_API_KEY = process.env.NAWAME_API_KEY;
const PASSPHRASE = process.env.SOUVERAIN_PASSPHRASE;
const SALT = process.env.SOUVERAIN_SALT;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Réponse JSON-RPC de refus (outil incompatible avec le chiffré) — rien n'est transmis. */
function rejected(id: unknown, tool: string) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result: {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Mode souverain (relais) : l'outil « ${tool} » est indisponible ici. Le serveur ne peut pas retrouver un passage dans du contenu chiffré. Réécris la mémoire entière avec update_entry.`,
        },
      ],
    },
  };
}

export async function POST(req: NextRequest) {
  if (!RELAY_API_KEY || !PASSPHRASE || !SALT) {
    return NextResponse.json(
      { error: 'relais non configuré (NAWAME_API_KEY, SOUVERAIN_PASSPHRASE ou SOUVERAIN_SALT manquant)' },
      { status: 500 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: 'corps JSON-RPC invalide' }, { status: 400 });
  }

  const batch = Array.isArray(payload);
  const items = (batch ? payload : [payload]) as Array<{ id?: unknown; method?: string; params?: { name?: string } }>;

  // 1) Sceller les écritures AVANT toute transmission. Si un outil est incompatible
  //    avec le chiffré (fail-closed), on refuse SANS jamais transmettre de clair :
  //    en unitaire on répond le refus ; en lot on refuse tout le lot (rare).
  try {
    for (let i = 0; i < items.length; i++) {
      items[i] = await sealRequestRpc(items[i]);
    }
  } catch (e) {
    if (e instanceof SouverainRejected) {
      const tool = e.message;
      if (!batch) return NextResponse.json(rejected(items[0]?.id, tool));
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message: `outil « ${tool} » indisponible en mode souverain (lot refusé)` } },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: 'échec du scellement souverain' }, { status: 500 });
  }

  // 2) Transmettre à Nawame. On force Accept: application/json (réponse JSON, pas de
  //    flux SSE à réassembler) : suffisant pour les outils mémoire.
  const upstream = await fetch(NAWAME_MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${RELAY_API_KEY}`,
    },
    body: JSON.stringify(batch ? items : items[0]),
  });

  const raw = await upstream.text();
  let response: unknown;
  try {
    response = JSON.parse(raw);
  } catch {
    // Réponse non-JSON (erreur amont, flux SSE…) : on relaie telle quelle, sans
    // rien prétendre déchiffrer.
    return new NextResponse(raw, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }

  // 3) Ouvrir le contenu chiffré des réponses avant de le rendre à l'IA.
  try {
    if (Array.isArray(response)) {
      response = await Promise.all(response.map((r) => openResponseRpc(r)));
    } else {
      response = await openResponseRpc(response);
    }
  } catch {
    return NextResponse.json({ error: "échec de l'ouverture souveraine" }, { status: 500 });
  }

  return NextResponse.json(response, { status: upstream.status });
}

export async function GET() {
  const ready = Boolean(RELAY_API_KEY && PASSPHRASE && SALT);
  return NextResponse.json({
    relay: 'nawame-relais-souverain',
    // « crypto:active » = le relais scelle/ouvre réellement (pas un simple proxy).
    crypto: ready ? 'active' : 'inactive',
    configured: ready,
    nawame: NAWAME_MCP_URL,
    note: ready
      ? 'Le contenu des mémoires est chiffré avant Nawame et déchiffré au retour. Titres, tags, dossiers et dates restent en clair côté Nawame.'
      : 'Manque NAWAME_API_KEY, SOUVERAIN_PASSPHRASE ou SOUVERAIN_SALT.',
  });
}
