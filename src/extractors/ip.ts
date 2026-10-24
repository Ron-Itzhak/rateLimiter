import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { ServiceError } from '../models';

export function normalizeIp(ip: string, prefix = 128): string {
  if (typeof ip !== 'string' || ip.includes('%') || !isIP(ip) || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
    throw new ServiceError(400, 'INVALID_IP', 'Expected a valid IP address and subnet mask');
  }
  const address = ipaddr.process(ip);
  if (address.kind() === 'ipv4') return address.toString();
  const bytes = address.toByteArray().map((byte, index) => {
    const bits = Math.max(0, Math.min(8, prefix - index * 8));
    return byte & (256 - 2 ** (8 - bits));
  });
  return `${ipaddr.fromByteArray(bytes).toString()}/${prefix}`;
}
