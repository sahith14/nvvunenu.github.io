// ---------------------------------------------------------------
// BondSync E2EE client helpers (Web Crypto — works in browser + RN
// with react-native-quick-crypto or @peculiar/webcrypto shim).
//
// Threat model:
//   - Server stores only { ciphertext, iv, keyVersion } + wrapped AES keys.
//   - Private RSA key never leaves device (Keychain / SecureStore / IDB).
//   - Compromise of server leaks nothing useful.
// ---------------------------------------------------------------
const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (s)   => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer
};

export async function generateUserKeypair() {
  const kp = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
    true, ["wrapKey","unwrapKey","encrypt","decrypt"]
  );
  const pub  = await crypto.subtle.exportKey("spki",  kp.publicKey);
  const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  return { publicKey: b64.enc(pub), privateKey: b64.enc(priv) };
}

export async function importPublicKey(spkiB64) {
  return crypto.subtle.importKey(
    "spki", b64.dec(spkiB64),
    { name: "RSA-OAEP", hash: "SHA-256" },
    true, ["wrapKey","encrypt"]
  );
}

export async function importPrivateKey(pkcs8B64) {
  return crypto.subtle.importKey(
    "pkcs8", b64.dec(pkcs8B64),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false, ["unwrapKey","decrypt"]
  );
}

export async function generateConversationKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt","decrypt"]);
}

export async function wrapConvKeyFor(publicKey, convKey) {
  const wrapped = await crypto.subtle.wrapKey("raw", convKey, publicKey, { name: "RSA-OAEP" });
  return b64.enc(wrapped);
}

export async function unwrapConvKey(privateKey, wrappedB64) {
  return crypto.subtle.unwrapKey(
    "raw", b64.dec(wrappedB64), privateKey,
    { name: "RSA-OAEP" }, { name: "AES-GCM", length: 256 },
    false, ["encrypt","decrypt"]
  );
}

export async function encryptMessage(convKey, plaintext) {
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const ct  = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, convKey, enc);
  return { ciphertext: b64.enc(ct), iv: b64.enc(iv) };
}

export async function decryptMessage(convKey, ciphertextB64, ivB64) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64.dec(ivB64)) },
    convKey, b64.dec(ciphertextB64)
  );
  return new TextDecoder().decode(pt);
}
