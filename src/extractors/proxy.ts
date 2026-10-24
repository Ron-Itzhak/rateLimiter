import ipaddr from 'ipaddr.js';
import { normalizeIp } from './ip';
import { ServiceError } from '../models';

export function resolveClientIp(remoteIp: string, forwarded: string | undefined, trustedCidrs: readonly string[]): string {
  const canonical = (value: string) => { normalizeIp(value); return ipaddr.process(value).toString(); };
  const trusted = trustedCidrs.map((cidr): [ipaddr.IPv4 | ipaddr.IPv6, number] => {
    const [network, prefix] = ipaddr.parseCIDR(cidr);
    if (network instanceof ipaddr.IPv6 && network.isIPv4MappedAddress()) {
      if (prefix < 96) throw new RangeError('Mapped IPv4 proxy CIDRs require prefix >= 96');
      return [network.toIPv4Address(), prefix - 96];
    }
    return [network, prefix];
  });
  const isTrusted = (value: string): boolean => {
    const address = ipaddr.process(value);
    return trusted.some(([network, prefix]) => {
      if (address instanceof ipaddr.IPv4 && network instanceof ipaddr.IPv4) return address.match(network, prefix);
      if (address instanceof ipaddr.IPv6 && network instanceof ipaddr.IPv6) return address.match(network, prefix);
      return false;
    });
  };
  let current = canonical(remoteIp);
  if (!forwarded || !isTrusted(current)) return current;
  if (forwarded.length > 4096) throw new ServiceError(400, 'INVALID_PROXY_CHAIN', 'Proxy chain too long');
  const chain = forwarded.split(',');
  if (chain.length > 32) throw new ServiceError(400, 'INVALID_PROXY_CHAIN', 'Too many proxy hops');
  for (let i = chain.length - 1; i >= 0 && isTrusted(current); i--) current = canonical(chain[i]!.trim());
  return current;
}
