import { Injectable } from '@nestjs/common';
import { config } from '../config';

@Injectable()
export class RazorpayClient {
  get configured() {
    return Boolean(config.razorpayKeyId && config.razorpayKeySecret);
  }

  async call<T = any>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64');
    const baseUrl = config.razorpayBaseUrl.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    const res = await fetch(baseUrl + cleanPath, {
      method,
      headers: { authorization: `Basic ${auth}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    if (!res.ok) throw new Error(`razorpay ${method} ${path} -> ${res.status}: ${json?.error?.description ?? text.slice(0, 160)}`);
    return json as T;
  }
}
