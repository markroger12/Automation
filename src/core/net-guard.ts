import net from 'node:net';

/** True for loopback, private, link-local, CGNAT, multicast, unspecified and unique-local addresses. */
export function isPrivateAddress(ip: string): boolean {
  let addr = ip.trim().toLowerCase();
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(addr)) {
    return addr === '::' || addr === '::1' || addr.startsWith('fc') || addr.startsWith('fd') || addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb') || addr.startsWith('ff');
  }
  return true;
}
