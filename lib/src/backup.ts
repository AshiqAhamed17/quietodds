// Encrypted note backups. Every leaf the pool inserts carries a ciphertext in
// its LeafInserted event; the owner decrypts their own with the viewing key
// and rebuilds their balance from chain data alone.
//
// Format: 0x01 | iv (12 bytes) | AES-256-GCM(plaintext). Notes of other users
// fail GCM authentication, so scanning is a cheap trial decryption.
import { bytesToHex, hexToBytes, type Hex } from "viem";

const VERSION = 1;

/** What the owner needs, beyond their keys, to rebuild a note. */
export type NoteData =
  | { kind: "balance"; index: number; asset: bigint; amount: bigint }
  | { kind: "position"; index: number; market: bigint; side: bigint; stake: bigint }
  | { kind: "ticket"; index: number; batch: bigint; amountIn: bigint };

const KIND_CODES = { balance: 1, position: 2, ticket: 3 } as const;

function encode(n: NoteData): Uint8Array {
  const body: (string | number)[] = [KIND_CODES[n.kind], n.index];
  if (n.kind === "balance") body.push(n.asset.toString(), n.amount.toString());
  if (n.kind === "position") body.push(n.market.toString(), n.side.toString(), n.stake.toString());
  if (n.kind === "ticket") body.push(n.batch.toString(), n.amountIn.toString());
  return new TextEncoder().encode(JSON.stringify(body));
}

function decode(bytes: Uint8Array): NoteData {
  const [k, index, ...v] = JSON.parse(new TextDecoder().decode(bytes)) as [number, number, ...string[]];
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("bad index");
  if (k === 1) return { kind: "balance", index, asset: BigInt(v[0]), amount: BigInt(v[1]) };
  if (k === 2) return { kind: "position", index, market: BigInt(v[0]), side: BigInt(v[1]), stake: BigInt(v[2]) };
  if (k === 3) return { kind: "ticket", index, batch: BigInt(v[0]), amountIn: BigInt(v[1]) };
  throw new Error("bad kind");
}

const aesKey = (viewingKey: Uint8Array, usage: KeyUsage) =>
  crypto.subtle.importKey("raw", viewingKey as BufferSource, "AES-GCM", false, [usage]);

export async function encryptNote(viewingKey: Uint8Array, note: NoteData): Promise<Hex> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(viewingKey, "encrypt"), encode(note) as Uint8Array<ArrayBuffer>),
  );
  const out = new Uint8Array(1 + iv.length + ct.length);
  out.set([VERSION], 0);
  out.set(iv, 1);
  out.set(ct, 1 + iv.length);
  return bytesToHex(out);
}

/** The note, or null if this ciphertext is not ours (or not a note at all). */
export async function decryptNote(viewingKey: Uint8Array, ciphertext: Hex, key?: CryptoKey): Promise<NoteData | null> {
  const bytes = hexToBytes(ciphertext) as Uint8Array<ArrayBuffer>;
  if (bytes.length < 1 + 12 + 16 || bytes[0] !== VERSION) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(1, 13) },
      key ?? (await aesKey(viewingKey, "decrypt")),
      bytes.subarray(13),
    );
    return decode(new Uint8Array(plain));
  } catch {
    return null;
  }
}

/** Import the viewing key once when decrypting many ciphertexts. */
export const viewingCryptoKey = (viewingKey: Uint8Array) => aesKey(viewingKey, "decrypt");
