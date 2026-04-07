/**
 * E2EE: ECDH P-256 + HKDF + AES-GCM.
 * Приватный ключ только в localStorage; сервер не может прочитать переписку.
 */

const LS_PRIVATE = "kareta_e2e_private_pkcs8_b64";
const LS_PUBLIC = "kareta_e2e_public_spki_b64";

const conversationAesCache = new Map();

function bufToB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    buf[i] = bin.charCodeAt(i);
  }
  return buf.buffer;
}

export function getLocalPublicSpkiB64() {
  return localStorage.getItem(LS_PUBLIC);
}

export function clearConversationKeyCache() {
  conversationAesCache.clear();
}

async function loadPrivateKey() {
  const raw = localStorage.getItem(LS_PRIVATE);
  if (!raw) {
    return null;
  }
  return crypto.subtle.importKey(
    "pkcs8",
    b64ToBuf(raw),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits", "deriveKey"],
  );
}

export async function generateAndStoreKeyPair() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits", "deriveKey"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  localStorage.setItem(LS_PRIVATE, bufToB64(pkcs8));
  localStorage.setItem(LS_PUBLIC, bufToB64(spki));
  return bufToB64(spki);
}

/**
 * Создаёт пару ключей при необходимости и загружает SPKI на сервер, если ещё не сохранён.
 */
export async function ensureE2EKeys(getMe, uploadPublicKey) {
  let spki = getLocalPublicSpkiB64();
  if (!spki) {
    spki = await generateAndStoreKeyPair();
  }
  const me = await getMe();
  if (!me.user.public_key_spki) {
    await uploadPublicKey(spki);
  }
}

async function importPeerPublicSpki(spkiB64) {
  return crypto.subtle.importKey(
    "spki",
    b64ToBuf(spkiB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

export async function getConversationAesKey(conversationId, peerPublicKeySpkiB64) {
  if (!peerPublicKeySpkiB64) {
    throw new Error("У собеседника нет ключа шифрования.");
  }
  const cid = String(conversationId);
  if (conversationAesCache.has(cid)) {
    return conversationAesCache.get(cid);
  }
  const privateKey = await loadPrivateKey();
  if (!privateKey) {
    throw new Error("Нет локального ключа. Перезайди в аккаунт.");
  }
  const peerPub = await importPeerPublicSpki(peerPublicKeySpkiB64);
  const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: peerPub }, privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(`kareta-e2e-v1-${cid}`),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  conversationAesCache.set(cid, aesKey);
  return aesKey;
}

export async function encryptChatMessage(aesKey, plainText) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(plainText));
  return {
    iv_b64: bufToB64(iv),
    ciphertext_b64: bufToB64(ciphertext),
  };
}

export async function decryptChatMessage(aesKey, ivB64, ciphertextB64) {
  const iv = new Uint8Array(b64ToBuf(ivB64));
  const ciphertext = b64ToBuf(ciphertextB64);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}
