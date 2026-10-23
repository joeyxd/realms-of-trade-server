// IC08 egress fence for server requests to owner-supplied URLs (probe and completion).
// https only, no userinfo; every resolved address must be public; the request connects to the vetted
// address (pinned lookup) with SNI and Host set to the hostname. There is no switch to relax it.
import dns from 'node:dns';
import net from 'node:net';

const BLOCKED = Object.freeze({ ok: false, why: 'egress_blocked' });

function ipv4(text) {
  const parts = String(text).split('.');
  if (parts.length !== 4 || parts.some(part => !/^[0-9]{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => value * 256 + Number(part), 0);
}

const V4_BLOCKS = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]
  .map(([base, bits]) => [ipv4(base), 2 ** (32 - bits)]);

const blockedV4 = value => V4_BLOCKS.some(([base, size]) => value >= base && value < base + size);

// Eight 16-bit groups, or null. Accepts '::' compression, a dotted IPv4 tail and a zone suffix.
function ipv6(text) {
  let value = String(text).toLowerCase();
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  const last = value.lastIndexOf(':');
  if (value.slice(last + 1).includes('.')) {
    const tail = ipv4(value.slice(last + 1));
    if (tail === null) return null;
    value = `${value.slice(0, last + 1)}${Math.floor(tail / 65536).toString(16)}:${(tail % 65536).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const split = part => part === '' ? [] : part.split(':');
  const head = split(halves[0]), rest = halves.length === 2 ? split(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (halves.length === 2 ? fill < 1 : head.length !== 8) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...rest];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map(group => parseInt(group, 16));
}

function blockedV6(groups) {
  const zero = (from, to) => groups.slice(from, to).every(group => group === 0);
  const embedded = () => blockedV4(groups[6] * 65536 + groups[7]);
  if (zero(0, 6)) return true; // ::, ::1 and the deprecated IPv4-compatible ::/96
  if (zero(0, 5) && groups[5] === 0xffff) return embedded(); // IPv4-mapped
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zero(2, 6)) return embedded(); // NAT64
  if ((groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xff00) === 0xff00) return true;
  if (groups[0] === 0x2002) return true; // 6to4 tunnels to an embedded IPv4
  if (groups[0] === 0x2001 && groups[1] === 0) return true; // Teredo
  return groups[0] === 0x2001 && groups[1] === 0x0db8;
}

/** True when an address is not a public unicast address (or does not parse). */
export function blockedAddress(address) {
  const family = net.isIP(String(address).replace(/%.*$/, ''));
  if (family === 4) { const value = ipv4(address); return value === null || blockedV4(value); }
  if (family === 6) { const groups = ipv6(address); return groups === null || blockedV6(groups); }
  return true;
}

/** The strict production fence. `lookup` is injectable for tests (same signature as dns.lookup). */
export function createEgressGuard({ lookup = dns.lookup } = {}) {
  if (typeof lookup !== 'function') throw new TypeError('invalid egress guard');
  async function vet(input) {
    let url;
    try { url = new URL(input); } catch { return BLOCKED; }
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return BLOCKED;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses;
    if (net.isIP(hostname)) addresses = [{ address: hostname, family: net.isIP(hostname) }];
    else {
      try {
        addresses = await new Promise((resolve, reject) => lookup(hostname, { all: true, verbatim: true },
          (error, list) => error ? reject(error) : resolve(list)));
      } catch { return { ok: false, why: 'transport_error' }; }
    }
    if (!Array.isArray(addresses) || !addresses.length ||
        addresses.some(item => !item || typeof item.address !== 'string' || blockedAddress(item.address))) return BLOCKED;
    const address = addresses[0].address;
    return Object.freeze({ ok: true, hostname, address, family: net.isIP(address) });
  }
  return Object.freeze({ vet });
}

/** http(s).request options that connect to the vetted address while keeping SNI and Host on the hostname. */
export function pinnedRequestOptions(vetted) {
  const { address, family, hostname } = vetted;
  return { lookup: (_host, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (options?.all) callback(null, [{ address, family }]); else callback(null, address, family);
  }, ...(net.isIP(hostname) ? {} : { servername: hostname }) };
}
