import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, sign as edSign, verify as edVerify } from 'node:crypto';
import { GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { config } from '../config';

export interface LeaseSigner {
  sign(message: Buffer): Promise<Buffer>;
  publicKeyPem(): Promise<string>;
}

export class LocalSigner implements LeaseSigner {
  private priv: KeyObject;
  private pub: KeyObject;

  constructor(pem?: string) {
    if (pem) {
      this.priv = createPrivateKey(pem);
      this.pub = createPublicKey(this.priv);
    } else {
      const pair = generateKeyPairSync('ed25519');
      this.priv = pair.privateKey;
      this.pub = pair.publicKey;
      console.warn('[lease] ephemeral dev key in use, leases die on restart');
    }
  }

  async sign(message: Buffer) {
    return edSign(null, message, this.priv);
  }

  async publicKeyPem() {
    return this.pub.export({ type: 'spki', format: 'pem' }).toString();
  }
}

export class KmsSigner implements LeaseSigner {
  private client = new KMSClient({ region: config.region });
  private cachedPem?: string;

  constructor(private keyId: string) {}

  async sign(message: Buffer) {
    const out = await this.client.send(new SignCommand({
      KeyId: this.keyId,
      Message: message,
      MessageType: 'RAW',
      SigningAlgorithm: 'ED25519_SHA_512',
    }));
    if (!out.Signature) throw new Error('KMS returned no signature');
    return Buffer.from(out.Signature);
  }

  async publicKeyPem() {
    if (this.cachedPem) return this.cachedPem;
    const out = await this.client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    if (!out.PublicKey) throw new Error('KMS returned no public key');
    const b64 = Buffer.from(out.PublicKey).toString('base64');
    const chunks = b64.match(/.{1,64}/g) ?? [b64];
    this.cachedPem = `-----BEGIN PUBLIC KEY-----\n${chunks.join('\n')}\n-----END PUBLIC KEY-----\n`;
    return this.cachedPem;
  }
}

export function verifyLease(publicPem: string, message: Buffer, signature: Buffer): boolean {
  if (!publicPem || typeof publicPem !== 'string' || !Buffer.isBuffer(message) || !Buffer.isBuffer(signature) || signature.length !== 64) {
    return false;
  }
  try {
    return edVerify(null, message, createPublicKey(publicPem), signature);
  } catch {
    return false;
  }
}

export function buildSigner(): LeaseSigner {
  return config.kmsKeyId ? new KmsSigner(config.kmsKeyId) : new LocalSigner(config.devSigningKeyPem || undefined);
}
