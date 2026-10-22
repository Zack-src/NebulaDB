// Without the look-alikes (0/O, 1/l/I), so a generated password can be read out or retyped.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_+=";

/** A random password from the browser's CSPRNG. */
export function generatePassword(length = 24): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    // Rejection sampling: `byte % length` alone would favour the first characters.
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}
