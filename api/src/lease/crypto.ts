import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  sign as edSign,
  timingSafeEqual,
  verify as edVerify,
} from 'node:crypto';
import { canonicalize } from './canonical';
import { LeaseSigner, LocalSigner, KmsSigner, verifyLease, buildSigner } from './signer';

export { LeaseSigner, LocalSigner, KmsSigner, verifyLease, buildSigner };

/**
 * Generate a new Ed25519 keypair formatted as PEM strings.
 */
export function generateEd25519KeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/**
 * Sign arbitrary data buffer using Ed25519 private key.
 */
export function signEd25519(privateKey: KeyObject | string, message: Buffer): Buffer {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  return edSign(null, message, key);
}

/**
 * Verify arbitrary data buffer signature using Ed25519 public key.
 */
export function verifyEd25519(publicKey: KeyObject | string, message: Buffer, signature: Buffer): boolean {
  try {
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
    return edVerify(null, message, key, signature);
  } catch {
    return false;
  }
}

/**
 * Deterministically sign a lease object by canonicalizing to JSON then signing with Ed25519.
 */
export async function signLeaseObject(signer: LeaseSigner, lease: object): Promise<string> {
  const canonical = canonicalize(lease);
  const signature = await signer.sign(Buffer.from(canonical, 'utf8'));
  return signature.toString('base64');
}

/**
 * Create HMAC-SHA256 signature (hex encoded).
 */
export function signHmacSha256(secret: string | Buffer, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Constant-time HMAC-SHA256 verification to prevent timing side-channel attacks.
 */
export function verifyHmacSha256(secret: string | Buffer, data: string | Buffer, signatureHex: string): boolean {
  try {
    const expected = createHmac('sha256', secret).update(data).digest();
    const given = Buffer.from(signatureHex, 'hex');
    if (given.length !== expected.length) return false;
    return timingSafeEqual(given, expected);
  } catch {
    return false;
  }
}
