import { canonicalize } from '../src/lease/canonical';
import { LocalSigner, verifyLease } from '../src/lease/signer';

async function main() {
  const signer = new LocalSigner();
  const lease = {
    status: 'ACTIVE', lease_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', monotonic_nonce: 18,
    valid_until: '2026-10-31T23:59:59.000Z', balance_due_paise: 0,
  };
  const reordered = { balance_due_paise: 0, valid_until: lease.valid_until, monotonic_nonce: 18, lease_id: lease.lease_id, status: 'ACTIVE' };
  console.log('canonical stable ->', canonicalize(lease) === canonicalize(reordered));

  const msg = Buffer.from(canonicalize(lease));
  const sig = await signer.sign(msg);
  const pem = await signer.publicKeyPem();
  console.log('valid signature  ->', verifyLease(pem, msg, sig));
  const tampered = Buffer.from(canonicalize({ ...lease, valid_until: '2027-10-31T23:59:59.000Z' }));
  console.log('tampered payload ->', verifyLease(pem, tampered, sig));
}

main();
