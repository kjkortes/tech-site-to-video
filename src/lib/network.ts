import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { config } from './config';

export function isPublicAddress(address: string) {
  try {
    let parsed = ipaddr.parse(address.replace(/^\[|\]$/g, ''));
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === 'unicast';
  } catch { return false; }
}
export async function validatePublicUrl(input: string): Promise<string> {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Enter an HTTP or HTTPS website URL.');
  if (url.username || url.password) throw new Error('URLs containing credentials are not supported.');
  if (config.privateUrls) return url.href;
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Public websites must use port 80 or 443.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Use a public website URL. Local and private network addresses are blocked.');
  url.hash = ''; return url.href;
}
