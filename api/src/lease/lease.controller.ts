import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { LeaseService } from './lease.service';

@Controller('v1/leases')
export class LeaseController {
  constructor(private leases: LeaseService) {}

  @Get('public-key')
  async publicKey() {
    return { algorithm: 'Ed25519', pem: await this.leases.publicKey() };
  }

  @Get('pass/:leaseId')
  async getPass(@Param('leaseId') leaseId: string) {
    const pass = await this.leases.getById(leaseId);
    if (!pass) throw new NotFoundException('lease not found');
    return pass;
  }

  @Get('member/:memberId')
  async getMemberPass(@Param('memberId') memberId: string, @Query('tenant_id') tenantId?: string) {
    const pass = await this.leases.getLatestMemberLease(memberId, tenantId);
    if (!pass) throw new NotFoundException('lease not found');
    return pass;
  }
}
