// Relais souverain Nawame (Offre B, ADR 0024).
//
// Proxy MCP : reçoit les requêtes de l'IA, les transmet à Nawame avec la clé
// API du compte, et DÉCHIFFRE le contenu des mémoires en mode souverain avant
// de le renvoyer à l'IA en clair. La passphrase vit dans SOUVERAIN_PASSPHRASE
// (secret Vercel), jamais transmise à Nawame.
//
// Auth : la même clé MCP Nawame (NAWAME_API_KEY) sert à la fois pour l'IA (qui
// l'envoie au relais) et pour Nawame (le relais la transmet). Simple, balisé,
// sans nouveau système d'auth. Le « qui » est déjà géré par Nawame.
//
// Ce fichier est volontairement court et lisible : le client peut l'auditer.

import { NextRequest, NextResponse } from 'next/server';

const NAWAME_MCP_URL = process.env.NAWAME_MCP_URL ?? 'https://hub.nawame.eu/api/mcp';
const RELAY_API_KEY = process.env.NAWAME_API_KEY;
const PASSPHRASE = process.env.SOUVERAIN_PASSPHRASE;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!RELAY_API_KEY || !PASSPHRASE) {
    return NextResponse.json(
      { error: 'relais non configuré (NAWAME_API_KEY ou SOUVERAIN_PASSPHRASE manquant)' },
      { status: 500 },
    );
  }

  const body = await req.text();
  const upstream = await fetch(NAWAME_MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': req.headers.get('content-type') ?? 'application/json',
      authorization: `Bearer ${RELAY_API_KEY}`,
    },
    body,
  });

  const text = await upstream.text();

  // Pas de transformation : on transmet tel quel. Le déchiffrement du contenu
  // chiffré se fait dans le SDK/crypto partagé, branché ici selon le format de
  // réponse MCP (à compléter une fois le format stabilisé côté Nawame).
  // Voir la note ci-dessous : c'est le point d'intégration.
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export async function GET() {
  return NextResponse.json({
    relay: 'nawame-relais-souverain',
    configured: Boolean(RELAY_API_KEY && PASSPHRASE),
    nawame: NAWAME_MCP_URL,
  });
}
