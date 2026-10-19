import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { RazorpayClient } from './razorpay.client';

export interface RouteInput {
  email: string; phone: string; legal_business_name: string; business_type: string; contact_name: string;
  pan: string; gst?: string; category: string; subcategory: string;
  street1: string; street2?: string; city: string; state: string; postal_code: string;
  bank_account_number: string; bank_ifsc: string; bank_beneficiary_name: string;
}

const REQUIRED: (keyof RouteInput)[] = [
  'email', 'phone', 'legal_business_name', 'business_type', 'contact_name', 'pan', 'category', 'subcategory',
  'street1', 'city', 'state', 'postal_code', 'bank_account_number', 'bank_ifsc', 'bank_beneficiary_name',
];

@Injectable()
export class RouteService {
  constructor(private db: DbService, private rzp: RazorpayClient) {}

  async status(tenantId: string) {
    const row = await this.load(tenantId);
    let remote: any = null;
    if (row.razorpay_account_id && this.rzp.configured) {
      try {
        remote = await this.rzp.call('GET', `/v2/accounts/${row.razorpay_account_id}`);
      } catch {
        remote = null;
      }
    }
    return { account_id: row.razorpay_account_id, step: row.route_step, remote_status: remote?.status ?? null };
  }

  async onboard(tenantId: string, input: RouteInput) {
    if (!this.rzp.configured) throw new ServiceUnavailableException('Razorpay keys are not set');
    const missing = REQUIRED.filter(k => typeof input?.[k] !== 'string' || !input[k].trim());
    if (missing.length) throw new BadRequestException(`missing fields: ${missing.join(', ')}`);

    const row = await this.load(tenantId);
    if (row.route_step === 'DONE') throw new ConflictException('route account already onboarded');
    let { razorpay_account_id: accountId, route_product_id: productId, route_step: step } = row;
    const save = () => this.db.withSuper(c =>
      c.query('UPDATE tenants SET razorpay_account_id = $2, route_product_id = $3, route_step = $4 WHERE id = $1', [tenantId, accountId, productId, step]),
    );

    if (step === 'NONE') {
      const acc = await this.rzp.call<{ id: string }>('POST', '/v2/accounts', {
        email: input.email, phone: input.phone, type: 'route', reference_id: tenantId,
        legal_business_name: input.legal_business_name, business_type: input.business_type, contact_name: input.contact_name,
        profile: {
          category: input.category, subcategory: input.subcategory,
          addresses: { registered: { street1: input.street1, street2: input.street2 || input.street1, city: input.city, state: input.state, postal_code: input.postal_code, country: 'IN' } },
        },
        legal_info: { pan: input.pan, ...(input.gst ? { gst: input.gst } : {}) },
      });
      accountId = acc.id;
      step = 'ACCOUNT';
      await save();
    }

    if (step === 'ACCOUNT') {
      await this.rzp.call('POST', `/v2/accounts/${accountId}/stakeholders`, {
        name: input.contact_name, email: input.email, relationship: { executive: true }, kyc: { pan: input.pan },
      });
      step = 'STAKEHOLDER';
      await save();
    }

    if (step === 'STAKEHOLDER') {
      const product = await this.rzp.call<{ id: string }>('POST', `/v2/accounts/${accountId}/products`, { product_name: 'route', tnc_accepted: true });
      productId = product.id;
      step = 'PRODUCT';
      await save();
    }

    const done = await this.rzp.call<{ activation_status?: string }>('PATCH', `/v2/accounts/${accountId}/products/${productId}`, {
      settlements: { account_number: input.bank_account_number, ifsc_code: input.bank_ifsc, beneficiary_name: input.bank_beneficiary_name },
      tnc_accepted: true,
    });
    step = 'DONE';
    await save();
    return { account_id: accountId, step, activation_status: done.activation_status ?? null };
  }

  private async load(tenantId: string) {
    const res = await this.db.withSuper(c =>
      c.query<{ razorpay_account_id: string | null; route_product_id: string | null; route_step: string }>(
        'SELECT razorpay_account_id, route_product_id, route_step FROM tenants WHERE id = $1', [tenantId],
      ),
    );
    if (!res.rowCount) throw new NotFoundException('unknown tenant');
    return res.rows[0];
  }
}
