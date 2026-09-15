// Nawame : socle cryptographique du mode « souveraineté client » (ADR 0024).
// Chiffrement côté client, clé dérivée d'une passphrase, jamais stockée côté serveur.
// Réutilise le patron de l'ADR 0020 (jeton chiffré côté client).
//
// KDF v1 : PBKDF2 (SHA-256, 600 000 itérations) via WebCrypto natif — aucune
// dépendance, portable navigateur + Node 22 + Vercel serverless. L'interface
// KdfParams permet de brancher Argon2id (hash-wasm) ultérieurement sans casser
// les consommateurs : ADR 0024 mentionne Argon2id comme cible, ADR 0020 admet
// PBKDF2/Argon2id. Le passage à Argon2id sera un nouveau `algorithm` dans
// KdfParams ; les blobs existants restent déchiffrables selon leurs propres
// kdfParams stockés.
//
// Chiffrement : AES-256-GCM via WebCrypto. IV aléatoire par seal, préfixé au
// blob. Le sel et les kdfParams sont stockés séparément côté serveur (non
// secrets : ils servent à recalculer la clé, pas à la protéger).
//
// Invariants absolus :
// - La passphrase et la clé en clair ne quittent jamais la fonction appelante.
// - Aucun log, aucune persistance de la clé ou de la passphrase.
// - Le blob stocké est opaque sans la clé : pas de filet de récupération.

// --- Types ---
export interface KdfParams {
  algorithm: 'pbkdf2';
  iterations: number;
  hash: 'sha-256';
}

export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'pbkdf2',
  iterations: 600_000,
  hash: 'sha-256',
};

export const SALT_LENGTH = 16; // octets
const IV_LENGTH = 12; // octets (GCM)
const KEY_USAGES: KeyUsage[] = ['encrypt', 'decrypt'];

function crypto(): Crypto {
  const c = globalThis.crypto as Crypto | undefined;
  if (!c) throw new Error('WebCrypto indisponible (Node >= 22 ou navigateur requis)');
  return c;
}

function subtle(): SubtleCrypto {
  return crypto().subtle;
}

// --- Sel ---

/** Génère un sel cryptographiquement aléatoire (à stocker côté serveur, non secret). */
export function generateSalt(length = SALT_LENGTH): Uint8Array {
  return crypto().getRandomValues(new Uint8Array(length));
}

// --- Dérivation de clé ---

/**
 * Dérive une clé AES-256-GCM depuis une passphrase + un sel, via PBKDF2.
 * La CryptoKey retournée n'est pas extractible : elle vit en mémoire, jamais
 * sérialisée. L'appelant est responsable de la durée de vie (ne pas la garder
 * au-delà de la session).
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  kdfParams: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<CryptoKey> {
  if (!passphrase) throw new Error('passphrase vide');
  if (salt.length === 0) throw new Error('sel vide');
  const s = subtle();
  const baseKey = await s.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return s.deriveKey(
    {
      name: 'PBKDF2',
      // Cast : @types/node type Uint8Array sur ArrayBufferLike (inclut SharedArrayBuffer),
      // BufferSource attend ArrayBuffer. Le blob est toujours un vrai ArrayBuffer ici.
      salt: salt as BufferSource,
      iterations: kdfParams.iterations,
      hash: kdfParams.hash,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    KEY_USAGES,
  );
}

// --- Scellement / déchiffrement ---

export interface SealedBlob {
  /** iv (12 octets) || ciphertext+tag. Format opaque, stocké côté serveur. */
  blob: Uint8Array;
}

/**
 * Chiffre un texte clair en AES-256-GCM. L'IV aléatoire est préfixé au blob.
 * Retourne un blob opaque stockable côté serveur sans la clé.
 */
export async function seal(plaintext: string, key: CryptoKey): Promise<Uint8Array> {
  const s = subtle();
  const iv = crypto().getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await s.encrypt({ name: 'AES-GCM', iv }, key, data);
  const blob = new Uint8Array(iv.length + ciphertext.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(ciphertext), iv.length);
  return blob;
}

/**
 * Déchiffre un blob produit par `seal`. Lance si la clé est erronée (AES-GCM
 * vérifie l'authenticité : un tag invalide lève) ou si le blob est corrompu.
 */
export async function open(blob: Uint8Array, key: CryptoKey): Promise<string> {
  if (blob.length < IV_LENGTH + 1) throw new Error('blob trop court');
  const s = subtle();
  const iv = blob.slice(0, IV_LENGTH);
  const ciphertext = blob.slice(IV_LENGTH);
  const plaintext = await s.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// --- Round-trip utilitaire (pour tests et validation d'activation) ---

/**
 * Valide qu'une passphrase dérive bien la bonne clé : déchiffre un blob scellé
 * connu. Retourne true si la clé est correcte, false sinon (ne lance pas — utile
 * pour l'UX d'activation : « cette passphrase ouvre-t-elle le coffre ? »).
 */
export async function verifyPassphrase(
  passphrase: string,
  salt: Uint8Array,
  kdfParams: KdfParams,
  referenceBlob: Uint8Array,
): Promise<boolean> {
  try {
    const key = await deriveKey(passphrase, salt, kdfParams);
    await open(referenceBlob, key);
    return true;
  } catch {
    return false;
  }
}

/** Scelle une valeur-test (pour poser une référence de validation à l'activation). */
export async function sealReference(
  passphrase: string,
  salt: Uint8Array,
  kdfParams: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  const key = await deriveKey(passphrase, salt, kdfParams);
  return seal('nawame-souverain-reference', key);
}

// --- Sérialisation des kdfParams (stockage jsonb côté serveur) ---

export function serializeKdfParams(kdfParams: KdfParams): string {
  return JSON.stringify(kdfParams);
}

export function deserializeKdfParams(raw: string): KdfParams {
  const parsed = JSON.parse(raw) as KdfParams;
  if (parsed.algorithm !== 'pbkdf2') {
    throw new Error(`algorithme KDF non supporté : ${parsed.algorithm}`);
  }
  if (typeof parsed.iterations !== 'number' || parsed.iterations < 1000) {
    throw new Error('iterations KDF invalides');
  }
  return parsed;
}
