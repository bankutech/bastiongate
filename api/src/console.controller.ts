import { Controller, Get, Header } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'";

function loadHtml(filename: string): string {
  const candidates = [
    join(__dirname, '..', '..', 'public', filename),
    join(__dirname, '..', 'public', filename),
    join(process.cwd(), 'api', 'public', filename),
    join(process.cwd(), 'public', filename),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  throw new Error(`${filename} not found, tried: ${candidates.join(', ')}`);
}

@Controller()
export class ConsoleController {
  private html = loadHtml('admin.html');

  @Get('admin')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', CSP)
  @Header('cache-control', 'no-store')
  page() {
    return this.html;
  }
}
