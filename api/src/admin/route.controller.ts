import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { RouteInput, RouteService } from '../billing/route.service';
import { AdminGuard, Roles } from './admin.guard';

@Controller('v1/admin/tenants/:id/route-account')
@UseGuards(AdminGuard)
@Roles('OWNER')
export class RouteController {
  constructor(private route: RouteService) {}

  @Get()
  status(@Param('id') id: string) {
    return this.route.status(id);
  }

  @Post()
  @HttpCode(200)
  onboard(@Param('id') id: string, @Body() body: RouteInput) {
    return this.route.onboard(id, body);
  }
}
