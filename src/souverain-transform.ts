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
// RÈGLE DE SÛRETÉ (refus par défaut) : un outil qui n'est pas explicitement classé
// est REFUSÉ, jamais transmis. Une liste blanche de ce qu'on scelle laisserait
// partir en clair tout outil oublié, ou ajouté plus tard côté Nawame ; ici, un
// outil inconnu coûte un message d'erreur, pas une fuite.
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
// Jeton COMPLET : la chaîne ENTIÈRE est un marqueur bien formé, et rien d'autre.
// Sert à ne pas re-sceller ce qui est déjà scellé, sans ouvrir de porte : un texte
// utilisateur qui COMMENCE par « NAWSOUV1: » reste du texte utilisateur, et il est
// scellé comme le reste. Le préfixe n'est pas un laissez-passer.
const WHOLE_TOKEN_RE = /^NAWSOUV1:[A-Za-z0-9_-]+$/;

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
 * (corrompu, étranger, extrait tronqué par le serveur) est réinséré TEL QUEL :
 * on n'affiche jamais du chiffré comme s'il était en clair, et on ne casse pas
 * toute la réponse pour autant.
 *
 * La chaîne est reconstruite par SEGMENTS, à la position EXACTE de chaque jeton.
 * Un remplacement par motif (String.replace) viserait la première occurrence du
 * MOTIF et corromprait la sortie si un texte déchiffré contient lui-même un
 * marqueur. Le clair réinjecté n'est jamais re-parcouru.
 */
async function openMarkersInString(s: string): Promise<string> {
  const re = new RegExp(TOKEN_RE.source, 'g');
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const token = m[0];
    parts.push(s.slice(last, m.index));
    let piece = token;
    try {
      piece = await openToken(token);
    } catch {
      // jeton non ouvrable : réinséré tel quel, jamais présenté comme du clair
    }
    parts.push(piece);
    last = m.index + token.length;
  }
  if (last === 0) return s;
  parts.push(s.slice(last));
  return parts.join('');
}

/**
 * Pose une valeur sur un objet reconstruit SANS jamais déclencher l'accesseur
 * « __proto__ » : une clé venue du réseau (ou d'un contenu utilisateur) ne doit
 * ni changer le prototype de l'objet, ni disparaître silencieusement en chemin.
 */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
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
    for (const [k, v] of Object.entries(value)) setOwn(out, k, await decodeDeep(v));
    return out;
  }
  return value;
}

// --- Scellement en profondeur d'une requête ----------------------------------

/**
 * Dit si une chaîne est DÉJÀ un de NOS chiffrés. L'apparence ne suffit pas : une
 * valeur fabriquée « NAWSOUV1: » + base64url(texte en clair) a la FORME d'un jeton
 * sans en être un, et traverserait le relais en clair, trivialement lisible côté
 * serveur. On exige donc une PREUVE : le jeton s'ouvre avec notre clé. Le coût est
 * nul, la clé est en cache ; un échec veut dire « ce n'est pas de nous », et la
 * valeur repart alors au scellement comme n'importe quel texte.
 */
async function isOurSealedToken(v: string): Promise<boolean> {
  if (!WHOLE_TOKEN_RE.test(v)) return false;
  try {
    await openToken(v);
    return true;
  } catch {
    return false;
  }
}

/** Scelle une chaîne, sauf si c'est déjà (preuve à l'appui) un de nos chiffrés. */
async function sealStringIfPlain(v: string): Promise<string> {
  if (v.length === 0) return v;
  if (await isOurSealedToken(v)) return v;
  return sealString(v);
}

/**
 * Scelle TOUTE chaîne non vide rencontrée, quelle que soit la CLÉ et quelle que
 * soit la PROFONDEUR (objets imbriqués et tableaux). Symétrique exact de
 * `decodeDeep`, qui rouvre déjà en profondeur : l'aller-retour reste correct.
 *
 * C'est le seul traitement sûr d'un objet de contenu LIBRE : le serveur accepte
 * un objet arbitraire et le stocke tel quel. Une liste de clés « de contenu »
 * connues laisserait partir en clair toute clé oubliée, inventée par l'IA, ou
 * ajoutée plus tard côté serveur : le fail-open serait seulement déplacé.
 *
 * Les nombres, booléens et null traversent tels quels : ce sont des valeurs de
 * structure, pas du texte rédigé, et les sceller changerait leur type (donc
 * casserait l'aller-retour, `decodeDeep` ne rendant que des chaînes).
 *
 * LIMITE ASSUMÉE, même nature : seules les VALEURS sont scellées, jamais les NOMS
 * de rubriques (les clés de l'objet). Une clé est de la structure, au même rang
 * qu'un titre ou qu'un tag : elle reste en clair côté serveur et y est stockée
 * verbatim. Les sceller casserait la lecture serveur de `{ text }` pour les notes
 * et le calcul des écarts entre versions. Le README le dit à l'utilisateur : ne
 * pas mettre de secret dans le NOM d'une rubrique.
 */
async function sealDeep(value: unknown): Promise<unknown> {
  if (typeof value === 'string') return sealStringIfPlain(value);
  if (Array.isArray(value)) return Promise.all(value.map((v) => sealDeep(v)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) setOwn(out, k, await sealDeep(v));
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
    tools?: Array<{ name?: string } & Record<string, unknown>>;
  } & Record<string, unknown>;
}

/**
 * Ouvre le contenu chiffré d'une réponse JSON-RPC MCP (lecture) ET retire du
 * catalogue les outils que le relais n'expose pas. Muté en place.
 */
export async function openResponseRpc<T>(rpc: T): Promise<T> {
  const r = rpc as RpcResponse;
  const result = r?.result;
  if (!result) return rpc;
  // tools/list : on retire les outils cachés AVANT que l'IA ne voie le catalogue,
  // pour qu'elle ne tente même pas un outil que le relais refuse (et qui, pour la
  // session souveraine de l'Offre A, transporterait la passphrase).
  if (Array.isArray(result.tools)) {
    result.tools = result.tools.filter(
      (t) => !(t && typeof t.name === 'string' && HIDDEN_TOOLS.has(t.name)),
    );
  }
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

// --- Catalogue : ce qu'on scelle, ce qu'on laisse passer, ce qu'on refuse ------

/** Levée quand un outil ne peut pas passer le relais : on NE transmet RIEN. */
export class SouverainRejected extends Error {
  /** Nom de l'outil refusé (repris dans le message rendu à l'IA). */
  tool: string;

  constructor(tool: string, message: string) {
    super(message);
    this.name = 'SouverainRejected';
    this.tool = tool;
  }
}

// 1) Outils qui PORTENT du texte rédigé : on scelle chacun des champs listés.
//    À GARDER SYNCHRONISÉ avec le catalogue MCP de Nawame. Les champs de
//    NAVIGATION (titre, tags, dossier, identifiants, e-mails) restent en clair :
//    c'est le périmètre assumé de l'ADR 0024.
//    Table en Map, et non en objet : un objet indexé par un nom d'outil venu du
//    réseau répondrait pour « constructor », « toString » ou « __proto__ » (clés
//    héritées d'Object.prototype), ce qui contournerait le refus par défaut plus
//    bas. Une Map ne connaît que ce qu'on y a mis.
const SEAL_TEXT_FIELDS = new Map<string, string[]>([
  // Mémoires : le contenu rédigé, ET le résumé de modification qui en dit la substance.
  ['write_note', ['text']],
  ['update_entry', ['text', 'change_summary']],
  ['append_to_conversation', ['text', 'change_summary']],
  ['open_or_create_working_memory', ['text']],
  // Boîte à outils : `body` est une directive rédigée (une mémoire entière).
  // `title` reste en clair, comme tous les titres.
  ['add_tool', ['body']],
  // Dossier racine : `description` est du texte rédigé, pas un simple nom.
  ['create_project', ['description']],
  // Motifs et notes rédigés, stockés côté Nawame puis relus par le relais.
  ['mark_superseded', ['reason']],
  ['revoke_authority', ['reason']],
  ['suggest_authority', ['note']],
  ['suggest_classification', ['rationale']],
  // Coffre de secrets en modèle pointeur (ADR 0015) : le NOM reste en clair (c'est
  // la clé de recherche de locate_secret), tout le descriptif est scellé.
  ['set_secret', ['location', 'usage', 'provider', 'external_id', 'vault_project', 'region', 'link']],
  ['record_secret_ref', ['location', 'usage', 'provider', 'external_id', 'vault_project', 'region', 'link']],
]);

// 1 bis) Champs qui portent un objet de contenu LIBRE : le serveur accepte là un
//    objet arbitraire et, pour un type autre que « note », le stocke VERBATIM. On
//    y scelle donc TOUTE chaîne, à toute profondeur (sealDeep), sans liste de clés
//    connues : sinon la moindre clé inattendue (« next_steps », « notes », un objet
//    imbriqué) partirait en clair. Map, pour la même raison que ci-dessus.
const SEAL_DEEP_FIELDS = new Map<string, string[]>([['update_entry', ['content']]]);

// 2) SAFE_TOOLS : outils dont les arguments ne transportent AUCUN texte rédigé
//    (lectures, navigation, métadonnées, identifiants, e-mails, booléens). Ils
//    passent tels quels. Un mot-clé de recherche (query, subject, filtre) est
//    traité comme une métadonnée, au même rang que les titres et les tags qui
//    restent en clair ; de toute façon le serveur ne peut plus chercher dans le
//    contenu scellé, il ne retrouve que les titres et les tags.
const SAFE_TOOLS = new Set<string>([
  // Navigation et orientation
  'whoami',
  'instructions',
  'list_tools',
  'list_spaces',
  'list_projects',
  'get_project',
  'list_folders',
  'resolve_anchor',
  'set_current_anchor',
  'clear_current_anchor',
  'anchor_view',
  // Lectures
  'read_memory',
  'get_entry',
  'get_conversation',
  'open_private_conversation',
  'list_conversation_shares',
  'memory_quota',
  'search_memory',
  'gather_topic',
  'suggest_merge_or_amend',
  'list_authority_suggestions',
  'list_classification_suggestions',
  'list_toolbox',
  'list_secrets',
  'locate_secret',
  // Métadonnées et rangement (aucun contenu rédigé dans les arguments)
  'rename_conversation',
  'tag_conversation',
  'move_conversation',
  'move_folder',
  'merge_conversations',
  'merge_folders',
  'archive_entry',
  'restore_version',
  'lock_entry',
  'unlock_entry',
  'delete_conversation',
  'delete_secret',
  'accept_classification',
  'dismiss_classification',
  'dismiss_authority_suggestion',
  'create_folder',
  'push_to_project',
  'share_conversation_with',
  'revoke_conversation_share',
  'decline_feedback',
  // Boîte à outils (codes et références seulement)
  'activate_tool',
  'clone_tool',
  'set_tool_hidden',
  // Organisation, membres, accès (identifiants, e-mails, rôles)
  'create_organization',
  'add_org_domain',
  'verify_org_domain',
  'list_org_domains',
  'invite_to_org',
  'accept_org_invitation',
  'set_org_sharing_mode',
  'list_share_requests',
  'approve_share_request',
  'deny_share_request',
  'set_member_role',
  'set_member_capabilities',
  'list_org_members',
  'grant_folder_access',
  'set_folder_owner_team',
  'anonymize_author',
]);

// 3) FAIL_CLOSED : outils explicitement refusés, avec le motif rendu à l'IA. Rien
//    n'est transmis. Trois familles : ceux qui exigent que le SERVEUR lise le clair,
//    ceux dont le texte est destiné à d'AUTRES que le porteur de la passphrase, et
//    ceux de la session souveraine serveur (Offre A), qui transportent la passphrase.
const FAIL_CLOSED = new Map<string, string>([
  [
    'replace_section',
    "l'outil « replace_section » est indisponible via le relais : le serveur ne peut pas retrouver un passage exact dans du contenu chiffré. Fais réécrire la mémoire entière (update_entry), ou ajoute un bloc en fin (append_to_conversation). Rien n'a été transmis.",
  ],
  [
    'share_conversation',
    "l'outil « share_conversation » est indisponible via le relais : le contenu partagé est destiné à d'autres personnes, qui n'ont pas ta passphrase. Le sceller le rendrait illisible pour elles, le laisser en clair le rendrait lisible par Nawame. Rien n'a été transmis.",
  ],
  [
    'engrave_conversation',
    "l'outil « engrave_conversation » est indisponible via le relais : un contenu gravé fait foi pour d'autres personnes, qui n'ont pas ta passphrase. Le sceller le rendrait illisible pour elles, le laisser en clair le rendrait lisible par Nawame. Rien n'a été transmis.",
  ],
  [
    'report_bug',
    "l'outil « report_bug » est indisponible via le relais : un signalement est destiné à l'équipe Nawame, il partirait donc en clair. Rien n'a été transmis. Pour signaler un problème, passe par la console Nawame ou par e-mail.",
  ],
  [
    'submit_feedback',
    "l'outil « submit_feedback » est indisponible via le relais : le commentaire est destiné à l'équipe Nawame, il partirait donc en clair. Rien n'a été transmis. Le sondage reste accessible depuis la console Nawame.",
  ],
  [
    'unlock_souverain',
    "l'outil « unlock_souverain » n'a pas lieu d'être ici : le mode relais n'utilise pas les sessions serveur, ta passphrase ne doit jamais partir. Rien n'a été transmis. Le chiffrement est déjà assuré par le relais, en permanence.",
  ],
  [
    'lock_souverain',
    "l'outil « lock_souverain » n'a pas lieu d'être ici : le mode relais n'utilise pas les sessions serveur, ta passphrase ne doit jamais partir. Rien n'a été transmis.",
  ],
  [
    'souverain_status',
    "l'outil « souverain_status » n'a pas lieu d'être ici : le mode relais n'utilise pas les sessions serveur, ta passphrase ne doit jamais partir. Rien n'a été transmis. Le relais, lui, chiffre en permanence.",
  ],
]);

// 4) HIDDEN_TOOLS : retirés du catalogue rendu par tools/list. Les outils de session
//    souveraine (Offre A) transportent la passphrase : l'IA ne doit même pas les voir.
export const HIDDEN_TOOLS = new Set<string>([
  'unlock_souverain',
  'lock_souverain',
  'souverain_status',
]);

/** Message de refus pour un outil que le relais ne connaît pas (refus par défaut). */
function unknownToolMessage(name: string): string {
  return `l'outil « ${name} » n'est pas reconnu par le relais souverain. Par sécurité, le relais refuse tout outil dont il ne sait pas s'il transporte du texte rédigé : mieux vaut un refus qu'une fuite en clair. Rien n'a été transmis.`;
}

/**
 * Vérifie qu'un champ à sceller est bien du TEXTE. Un champ absent (undefined ou
 * null) n'a rien à sceller et passe. Tout autre type (tableau, objet, nombre) est
 * REFUSÉ : le relais ne sait pas le chiffrer sous cette forme, et le laisser passer
 * ferait sortir du clair. Mieux vaut un refus lisible qu'une fuite silencieuse.
 *
 * La vérification est faite pour TOUS les champs AVANT le premier scellement :
 * un refus ne doit laisser derrière lui aucun argument à moitié transformé.
 */
function checkTextField(tool: string, obj: Record<string, unknown>, field: string): void {
  const v = obj[field];
  if (v === undefined || v === null) return;
  if (typeof v !== 'string') {
    throw new SouverainRejected(
      tool,
      `le champ « ${field} » de l'outil « ${tool} » doit être du texte : le relais ne sait pas le chiffrer sous cette forme. Rien n'a été transmis. Renvoie ce champ comme une simple chaîne de caractères.`,
    );
  }
}

/**
 * Scelle un champ texte s'il est en clair. Un champ DÉJÀ scellé par nous (jeton
 * qui s'ouvre réellement) n'est pas re-scellé. Tout le reste est scellé, y compris
 * un texte qui commencerait par « NAWSOUV1: » ou qui en aurait la forme sans être
 * de nous. Le type a déjà été validé par `checkTextField`.
 */
async function sealIfPlain(obj: Record<string, unknown>, field: string): Promise<void> {
  const v = obj[field];
  if (typeof v === 'string') obj[field] = await sealStringIfPlain(v);
}

interface RpcRequest {
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

// Méthodes JSON-RPC qui ne portent QUE du protocole : elles traversent le relais
// telles quelles. Liste EXPLICITE, pas une simple différence avec « tools/call » :
// une méthode inconnue (« tools/write », une extension future, une faute de frappe
// d'un client) peut très bien porter des arguments de contenu, et sortirait alors
// en clair. Ici, hors de cette liste et hors « tools/call », c'est un refus.
const PASSTHROUGH_METHODS = new Set<string>(['initialize', 'tools/list', 'ping']);
// Familles entières sans contenu rédigé : découverte de prompts, notifications de
// cycle de vie (notifications/initialized, notifications/cancelled…).
const PASSTHROUGH_PREFIXES = ['prompts/', 'notifications/'];

function isPassthroughMethod(method: string): boolean {
  if (PASSTHROUGH_METHODS.has(method)) return true;
  return PASSTHROUGH_PREFIXES.some((p) => method.startsWith(p));
}

// Clés que le protocole autorise sur un appel d'outil. Tout le reste est un champ
// FRÈRE, posé à côté du conteneur d'arguments : le relais ne le scelle pas, donc
// il sortirait EN CLAIR. Un champ « text » posé à côté d'« arguments » suffit à
// faire fuiter une mémoire entière, que les arguments soient valides ou non. On
// refuse donc tout ce qui n'est pas du protocole, au lieu de le transmettre.
const RPC_ENVELOPE_KEYS = new Set<string>(['jsonrpc', 'id', 'method', 'params']);
const CALL_PARAMS_KEYS = new Set<string>(['name', 'arguments', '_meta']);

/** Rend la première clé inattendue d'un objet, ou null s'il n'y en a aucune. */
function firstUnknownKey(obj: unknown, allowed: Set<string>): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    if (!allowed.has(k)) return k;
  }
  return null;
}

/**
 * Scelle le contenu d'une requête JSON-RPC MCP (écriture) avant transmission.
 * Muté en place. Lève SouverainRejected pour tout outil refusé OU inconnu :
 * l'appelant ne transmet alors rien du tout à Nawame.
 */
export async function sealRequestRpc<T>(rpc: T): Promise<T> {
  const r = rpc as RpcRequest;
  if (!r || typeof r !== 'object') return rpc;
  // Seul tools/call transporte du contenu rédigé. initialize, tools/list, ping,
  // prompts/*, notifications/* ne portent que du protocole : ils passent. Tout le
  // reste est REFUSÉ : une méthode que le relais ne connaît pas peut porter du
  // contenu (« tools/write » et son champ text en sont l'exemple), et la laisser
  // passer serait exactement le fail-open que cette doctrine proscrit.
  const method = typeof r.method === 'string' ? r.method : '';
  if (method !== 'tools/call') {
    if (isPassthroughMethod(method)) return rpc;
    throw new SouverainRejected(
      method || 'inconnu',
      `la méthode « ${method || '(absente)'} » n'est pas reconnue par le relais souverain : le relais ne sait pas si elle transporte du texte rédigé, il refuse donc plutôt que de risquer une fuite en clair. Rien n'a été transmis. Utilise « tools/call » pour appeler un outil.`,
    );
  }

  const name = r.params?.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new SouverainRejected(
      'inconnu',
      "appel d'outil sans nom : le relais ne peut pas savoir ce qu'il transporterait. Rien n'a été transmis.",
    );
  }

  const refus = FAIL_CLOSED.get(name);
  if (refus) throw new SouverainRejected(name, refus);

  // Forme de l'appel : aucun champ frère hors protocole, ni dans l'enveloppe
  // JSON-RPC, ni dans params. Un tel champ échapperait au scellement (le relais
  // ne regarde que `params.arguments`) et partirait en clair.
  const intrus = firstUnknownKey(r, RPC_ENVELOPE_KEYS) ?? firstUnknownKey(r.params, CALL_PARAMS_KEYS);
  if (intrus !== null) {
    throw new SouverainRejected(
      name,
      `l'appel de l'outil « ${name} » porte un champ « ${intrus} » que le protocole ne prévoit pas : posé hors des arguments, il échapperait au chiffrement. Rien n'a été transmis. Mets tous les champs de l'outil dans « arguments ».`,
    );
  }

  const fields = SEAL_TEXT_FIELDS.get(name);
  const deepFields = SEAL_DEEP_FIELDS.get(name);
  // Refus par défaut : ni scellé, ni reconnu sans contenu rédigé = porte fermée.
  if (!fields && !deepFields && !SAFE_TOOLS.has(name)) {
    throw new SouverainRejected(name, unknownToolMessage(name));
  }

  // Conteneur d'arguments : il doit être un OBJET, sinon le relais ne sait pas où
  // sont les champs à sceller. Absent ou null, il n'y a rien à sceller et l'appel
  // passe (le refus par défaut de l'outil, plus haut, s'est déjà appliqué). Mais
  // un tableau ou une chaîne portent du contenu que le relais ne saurait pas
  // chiffrer : on REFUSE au lieu de transmettre tel quel.
  const args = r.params?.arguments;
  if (args === undefined || args === null) return rpc;
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new SouverainRejected(
      name,
      `les arguments de l'outil « ${name} » ne sont pas d'une forme que le relais sait traiter : il ne peut donc pas garantir le chiffrement. Rien n'a été transmis. Renvoie les arguments sous forme d'objet.`,
    );
  }

  // 1) Contrôle de forme d'abord : si un champ ne peut pas être scellé, on refuse
  //    sans avoir rien modifié ni transmis.
  if (fields) {
    for (const f of fields) checkTextField(name, args, f);
  }

  // 2) Puis le scellement, champ par champ.
  if (fields) {
    for (const f of fields) await sealIfPlain(args, f);
  }

  // 3) Objets de contenu libre : scellés EN PROFONDEUR, toute clé, toute imbrication.
  if (deepFields) {
    for (const f of deepFields) {
      const v = args[f];
      if (v === undefined || v === null) continue;
      args[f] = await sealDeep(v);
    }
  }
  return rpc;
}
