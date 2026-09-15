// Relais souverain Nawame — transformation MCP (le cœur qui manquait).
//
// Le relais est un COFFRE À CHIFFRÉ autonome : il scelle le contenu des mémoires
// AVANT de l'envoyer à Nawame, et l'ouvre APRÈS l'avoir reçu. Nawame ne voit donc
// jamais que du chiffré : ni la passphrase, ni la clé, ni le texte en clair, même
// en RAM. C'est la vraie garantie zero-knowledge de l'Offre B (ADR 0024).
//
// Isolé ici (hors route.ts) pour être testable et auditable ligne à ligne.
//
// PÉRIMÈTRE (décision produit, ADR 0024) : on chiffre le CONTENU des mémoires.
// Restent EN CLAIR côté Nawame, par nécessité de service : titres, tags, noms de
// dossiers, dates, journal des lectures. La recherche plein-texte du contenu n'est
// donc plus possible côté serveur en mode souverain (titre/tags seulement).
//
// Marqueur : un champ scellé devient `NAWSOUV1:<base64url(iv||ciphertext)>`. Le
// préfixe permet de reconnaître, à la lecture, ce qui est à ouvrir — y compris
// plusieurs blocs concaténés (append_to_conversation ajoute un bloc scellé à la
// suite ; on ouvre chaque marqueur d'une même chaîne).

import { deriveKey, seal, open, DEFAULT_KDF_PARAMS } from './crypto-souverain';

export const MARKER = 'NAWSOUV1:';
// base64url sans padding : alphabet A-Z a-z 0-9 - _ . Le marqueur est délimité par
// tout caractère hors alphabet (espace, saut de ligne, guillemet…), ce qui permet
// de retrouver plusieurs marqueurs dans une chaîne concaténée.
const TOKEN_RE = /NAWSOUV1:[A-Za-z0-9_-]+/g;

// --- Clé dérivée une seule fois (PBKDF2 est coûteux) --------------------------
// La passphrase et le sel viennent de l'environnement Vercel du client. Jamais
// logués, jamais transmis à Nawame. La CryptoKey n'est pas extractible.
let keyPromise: Promise<CryptoKey> | null = null;

/** Réinitialise le cache de clé (tests). */
export function resetKeyCache(): void {
  keyPromise = null;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`variable d'environnement manquante : ${name}`);
  return v;
}

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const passphrase = requireEnv('SOUVERAIN_PASSPHRASE');
    // Le sel est un texte quelconque, non secret mais STABLE (il sert à recalculer
    // la même clé). On le prend en UTF-8 brut : n'importe quelle chaîne longue et
    // aléatoire convient (plus simple qu'un base64 à générer pour un non-technicien).
    const salt = new Uint8Array(new TextEncoder().encode(requireEnv('SOUVERAIN_SALT')));
    if (salt.length < 16) throw new Error('SOUVERAIN_SALT trop court (au moins 16 caractères)');
    keyPromise = deriveKey(passphrase, salt, DEFAULT_KDF_PARAMS);
  }
  return keyPromise;
}

// --- Sceller / ouvrir une chaîne ---------------------------------------------

async function sealString(plain: string): Promise<string> {
  const blob = await seal(plain, await getKey());
  return MARKER + Buffer.from(blob).toString('base64url');
}

async function openToken(token: string): Promise<string> {
  const b64 = token.slice(MARKER.length);
  const blob = new Uint8Array(Buffer.from(b64, 'base64url'));
  return open(blob, await getKey());
}

/**
 * Ouvre CHAQUE marqueur présent dans une chaîne (gère la concaténation type
 * append : "NAWSOUV1:a\n\nNAWSOUV1:b"). Un marqueur qu'on ne sait pas ouvrir
 * (corrompu, étranger) est laissé tel quel : on n'affiche jamais du chiffré
 * comme s'il était en clair, et on ne casse pas toute la réponse pour autant.
 */
async function openMarkersInString(s: string): Promise<string> {
  const tokens = s.match(TOKEN_RE);
  if (!tokens) return s;
  let out = s;
  for (const tok of tokens) {
    try {
      const clear = await openToken(tok);
      out = out.replace(tok, () => clear); // 1re occurrence ; les tokens sont uniques (IV aléatoire)
    } catch {
      // laissé tel quel
    }
  }
  return out;
}

// --- Ouverture en profondeur d'une réponse -----------------------------------

async function decodeDeep(value: unknown): Promise<unknown> {
  if (typeof value === 'string') {
    return value.includes(MARKER) ? openMarkersInString(value) : value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => decodeDeep(v)));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await decodeDeep(v);
    return out;
  }
  return value;
}

/**
 * Un bloc « text » de résultat MCP est le plus souvent du JSON sérialisé. On le
 * parse, on ouvre en profondeur, on re-sérialise : les valeurs en clair sont ainsi
 * ré-échappées correctement (pas de JSON corrompu par un guillemet ou un saut de
 * ligne dans le texte déchiffré). Si ce n'est pas du JSON, on ouvre la chaîne brute.
 */
async function decodeTextPayload(text: string): Promise<string> {
  if (!text.includes(MARKER)) return text;
  try {
    const parsed: unknown = JSON.parse(text);
    return JSON.stringify(await decodeDeep(parsed));
  } catch {
    return openMarkersInString(text);
  }
}

interface RpcResponse {
  result?: {
    content?: Array<{ type?: string; text?: string } & Record<string, unknown>>;
    structuredContent?: unknown;
  } & Record<string, unknown>;
}

/** Ouvre le contenu chiffré d'une réponse JSON-RPC MCP (lecture). Muté en place. */
export async function openResponseRpc<T>(rpc: T): Promise<T> {
  const r = rpc as RpcResponse;
  const result = r?.result;
  if (!result) return rpc;
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item && item.type === 'text' && typeof item.text === 'string') {
        item.text = await decodeTextPayload(item.text);
      }
    }
  }
  if (result.structuredContent !== undefined) {
    result.structuredContent = await decodeDeep(result.structuredContent);
  }
  return rpc;
}

// --- Scellement d'une requête (écriture) -------------------------------------

/** Levée quand un outil est incompatible avec le chiffré : on NE transmet rien. */
export class SouverainRejected extends Error {}

// Champs texte à sceller, par outil d'écriture Nawame. À GARDER SYNCHRONISÉ avec
// les outils MCP de Nawame : un nouvel outil qui porte du contenu doit être ajouté
// ici, sinon son contenu partirait en clair.
const SEAL_TEXT_FIELDS: Record<string, string[]> = {
  write_note: ['text'],
  update_entry: ['text'],
  append_to_conversation: ['text'],
  open_or_create_working_memory: ['text'],
};

// update_entry peut porter un objet `content` (note ou décision) : on scelle ses
// champs texte connus + le tableau alternatives_considered.
const CONTENT_STRING_KEYS = ['text', 'statement', 'rationale'];

// Outils dont la sémantique exige que le SERVEUR lise le contenu (match de passage) :
// impossible sur du chiffré. On ferme la porte plutôt que de transmettre du clair.
const FAIL_CLOSED = new Set(['replace_section']);

// Outils de DIVULGATION VOLONTAIRE (partage/gravé) : le contenu est destiné à
// d'AUTRES personnes, qui n'ont pas la passphrase. Le sceller le rendrait illisible
// pour eux. On le laisse donc en clair — c'est un choix explicite de la personne.
// (Listés pour mémoire ; ils ne sont simplement pas dans SEAL_TEXT_FIELDS.)

async function sealIfPlain(obj: Record<string, unknown>, field: string): Promise<void> {
  const v = obj[field];
  if (typeof v === 'string' && v.length > 0 && !v.startsWith(MARKER)) {
    obj[field] = await sealString(v);
  }
}

interface RpcRequest {
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

/**
 * Scelle le contenu d'une requête JSON-RPC MCP (écriture) avant transmission.
 * Muté en place. Lève SouverainRejected pour un outil incompatible avec le chiffré.
 */
export async function sealRequestRpc<T>(rpc: T): Promise<T> {
  const r = rpc as RpcRequest;
  if (!r || r.method !== 'tools/call') return rpc;
  const name = r.params?.name;
  const args = r.params?.arguments;
  if (!name || !args || typeof args !== 'object') return rpc;

  if (FAIL_CLOSED.has(name)) throw new SouverainRejected(name);

  const fields = SEAL_TEXT_FIELDS[name];
  if (fields) {
    for (const f of fields) await sealIfPlain(args, f);
  }

  if (name === 'update_entry' && args.content && typeof args.content === 'object') {
    const c = args.content as Record<string, unknown>;
    for (const k of CONTENT_STRING_KEYS) await sealIfPlain(c, k);
    if (Array.isArray(c.alternatives_considered)) {
      c.alternatives_considered = await Promise.all(
        (c.alternatives_considered as unknown[]).map((a) =>
          typeof a === 'string' && a.length > 0 && !a.startsWith(MARKER) ? sealString(a) : Promise.resolve(a),
        ),
      );
    }
  }
  return rpc;
}
