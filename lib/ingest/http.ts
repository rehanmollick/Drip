import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import zlib from "node:zlib";

/**
 * Shared helpers for ingestion network I/O. No business logic.
 *
 *  - address classification (isPrivateIp) + DNS pre-resolution (resolvePublicAddresses)
 *  - pinnedFetch: an http(s) GET that connects ONLY to pre-vetted addresses (closes the
 *    DNS-rebinding window between "we checked the name" and "we connected")
 *  - capped body reads, deadline math, prod-safe error details
 */

// ── address classification ───────────────────────────────────────────────────

/** Parse a dotted quad → 4 octets, or null. */
function parseIpv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return o.every((n) => n <= 255) ? o : null;
}

/** Expand any textual IPv6 (incl. "::", "::ffff:1.2.3.4", bracketed) → 8 x 16-bit groups, or null. */
export function parseIpv6(input: string): number[] | null {
  let s = input.trim().replace(/^\[|\]$/g, "").toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(":")) return null;
  // trailing dotted quad → two hex groups
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...rest];
}

/** IPv4 ranges we never connect to: loopback, private, link-local/metadata, CGNAT, reserved, multicast, docs. */
export function isPrivateIpv4(host: string): boolean {
  const o = parseIpv4(host);
  if (!o) return false;
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127) return true;               // "this" net, private, loopback
  if (a === 169 && b === 254) return true;                          // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;                 // private
  if (a === 192 && b === 168) return true;                          // private
  if (a === 100 && b >= 64 && b <= 127) return true;                // carrier-grade NAT (incl. 100.100.100.200)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;    // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;             // benchmarking
  if (a === 198 && b === 51 && c === 100) return true;              // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;               // TEST-NET-3
  if (a >= 224) return true;                                        // multicast + reserved + broadcast
  return false;
}

/** IPv6 ranges we never connect to (plus any embedded IPv4 that is private). */
export function isPrivateIpv6(host: string): boolean {
  const g = parseIpv6(host);
  if (!g) return false;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(6)) return true;                                                   // ::/96 — unspecified, loopback, v4-compatible
  if (zeroTo(5) && g[5] === 0xffff) return isPrivateIpv4(v4(g[6], g[7]));       // ::ffff:a.b.c.d mapped
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIpv4(v4(g[6], g[7])); // 64:ff9b::/96 NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;              // 64:ff9b:1::/48 local NAT64
  if (g[0] === 0x2002) return isPrivateIpv4(v4(g[1], g[2]));                    // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return isPrivateIpv4(v4(g[6] ^ 0xffff, g[7] ^ 0xffff)); // teredo (server addr is inverted)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                          // documentation
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return true;      // 100::/64 discard
  if ((g[0] & 0xffc0) === 0xfe80) return true;                                  // link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                  // unique-local
  if ((g[0] & 0xff00) === 0xff00) return true;                                  // multicast
  return false;
}

/** True for any literal address (v4 or v6, bracketed or not) we must not connect to. */
export function isPrivateIp(address: string): boolean {
  return isPrivateIpv4(address) || isPrivateIpv6(address);
}

// ── dns pre-resolution ───────────────────────────────────────────────────────

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type LookupFn = (host: string) => Promise<LookupAddress[]>;

const defaultLookup: LookupFn = (host) => dns.lookup(host, { all: true, order: "verbatim" });

export class UnsafeAddressError extends Error {
  constructor(public host: string) {
    super(`unsafe address for ${host}`);
    this.name = "UnsafeAddressError";
  }
}

/**
 * Resolve a hostname to the concrete addresses we will connect to. Literal IPs
 * are checked directly. Throws UnsafeAddressError when ANY resolved address is
 * private/loopback/link-local/… (a public name pointing at 127.0.0.1 — nip.io,
 * sslip.io, an attacker's own record — is exactly the case this guards).
 * DNS failures propagate as the lookup's own error (ENOTFOUND etc.).
 */
export async function resolvePublicAddresses(hostname: string, lookup: LookupFn = defaultLookup): Promise<ResolvedAddress[]> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const literal = net.isIP(bare);
  if (literal) {
    if (isPrivateIp(bare)) throw new UnsafeAddressError(hostname);
    return [{ address: bare, family: literal === 6 ? 6 : 4 }];
  }
  const found = await lookup(bare);
  const list: ResolvedAddress[] = found
    .filter((a) => a && typeof a.address === "string" && a.address.length > 0)
    .map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
  if (list.length === 0) throw new UnsafeAddressError(hostname);
  if (list.some((a) => isPrivateIp(a.address))) throw new UnsafeAddressError(hostname);
  return list;
}

// ── pinned fetch ─────────────────────────────────────────────────────────────

export type PinnedFetchInit = {
  addresses: ResolvedAddress[];
  headers?: Record<string, string>;
  signal?: AbortSignal;
  method?: "GET" | "HEAD";
};

const NO_BODY_STATUS = new Set([204, 205, 304]);

/**
 * GET/HEAD `url` over http(s) but connect ONLY to `addresses` (the vetted
 * result of resolvePublicAddresses), keeping the original Host header + SNI.
 * Redirects are NOT followed (the caller re-vets each hop). Returns a WHATWG
 * Response so callers can use headers/body/streaming as usual; gzip/deflate/br
 * bodies are transparently decoded.
 */
export function pinnedFetch(url: URL, init: PinnedFetchInit): Promise<Response> {
  const { addresses, signal } = init;
  // Node skips `lookup` entirely when the host is an IP literal, so the pin would silently not apply.
  // Vet literals here instead: the address must be one the caller already cleared.
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literal) && !addresses.some((a) => a.address === literal)) {
    return Promise.reject(new Error(`address ${literal} is not vetted`));
  }
  const lookup: net.LookupFunction = (_hostname, options, callback) => {
    const wanted = options.family === 6 || options.family === "IPv6" ? 6 : options.family === 4 || options.family === "IPv4" ? 4 : 0;
    const list = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
    if (list.length === 0) {
      const err: NodeJS.ErrnoException = new Error(`no vetted ${wanted ? `IPv${wanted}` : ""} address`);
      err.code = "ENOTFOUND";
      return callback(err, "", 4);
    }
    if (options.all) return callback(null, list.map((a) => ({ address: a.address, family: a.family })));
    callback(null, list[0].address, list[0].family);
  };
  const mod = url.protocol === "https:" ? https : http;
  // A pooled keep-alive socket would be reused without ever consulting `lookup`, so a later request could
  // ride a connection opened for a different vetted set. One dedicated, non-pooling agent per request.
  const agent = url.protocol === "https:" ? new https.Agent({ keepAlive: false, lookup }) : new http.Agent({ keepAlive: false, lookup });
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) {
      agent.destroy();
      return reject(signal.reason ?? new Error("aborted"));
    }
    const req = mod.request(
      url,
      {
        method: init.method ?? "GET",
        headers: { "accept-encoding": "gzip, deflate, br", ...(init.headers ?? {}) },
        agent,
        lookup,
        signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 599) {
          res.resume();
          return reject(new Error(`unsupported status ${status}`));
        }
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
          else headers.set(k, v);
        }
        let body: Readable = res;
        const enc = (res.headers["content-encoding"] ?? "").toLowerCase().trim();
        if (init.method !== "HEAD" && !NO_BODY_STATUS.has(status)) {
          const inflate = enc === "gzip" || enc === "x-gzip" ? zlib.createGunzip() : enc === "deflate" ? zlib.createInflate() : enc === "br" ? zlib.createBrotliDecompress() : null;
          if (inflate) {
            body = res.pipe(inflate);
            res.on("error", (e) => inflate.destroy(e));
            headers.delete("content-encoding");
            headers.delete("content-length");
          }
        }
        const stream = init.method === "HEAD" || NO_BODY_STATUS.has(status) ? null : (Readable.toWeb(body) as ReadableStream<Uint8Array>);
        if (!stream) res.resume();
        resolve(new Response(stream, { status, statusText: res.statusMessage ?? "", headers }));
      },
    );
    req.on("error", (e) => {
      agent.destroy();
      reject(e);
    });
    req.on("close", () => agent.destroy());
    req.end();
  });
}

// ── body helpers ─────────────────────────────────────────────────────────────

/** Read a fetch Response body as bytes, stopping after `maxBytes` (stream cancelled). */
export async function readBytesCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array((await res.arrayBuffer()).slice(0, maxBytes));
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  const cap = Math.min(total, maxBytes);
  const buf = new Uint8Array(cap);
  let off = 0;
  for (const c of chunks) {
    const n = Math.min(c.byteLength, cap - off);
    if (n <= 0) break;
    buf.set(c.subarray(0, n), off);
    off += n;
  }
  return buf;
}

/** Read a fetch Response body as text (default UTF-8), stopping after `maxBytes` (stream cancelled). */
export async function readCapped(res: Response, maxBytes: number, charset = "utf-8"): Promise<string> {
  const bytes = await readBytesCapped(res, maxBytes);
  return decodeCapped([bytes], bytes.byteLength, charset);
}

/** Concatenate byte chunks up to `cap` bytes and decode as UTF-8 (lossy). */
export function decodeCapped(chunks: Uint8Array[], cap: number, charset = "utf-8"): string {
  const buf = new Uint8Array(Math.max(0, cap));
  let off = 0;
  for (const c of chunks) {
    const n = Math.min(c.byteLength, buf.byteLength - off);
    if (n <= 0) break;
    buf.set(c.subarray(0, n), off);
    off += n;
    if (off >= buf.byteLength) break;
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset, { fatal: false });
  } catch {
    decoder = new TextDecoder("utf-8", { fatal: false });
  }
  return decoder.decode(buf.subarray(0, off));
}

/** Drop a response body we don't want (3xx, errors) without waiting on it. */
export function discardBody(res: Response): void {
  res.body?.cancel().catch(() => {});
}

/** Milliseconds left until `deadline` (never below 1 so timers still fire). */
export function remainingMs(deadline: number, cap: number): number {
  return Math.max(1, Math.min(cap, deadline - Date.now()));
}

/** True when an error came from an aborted/timed-out signal. */
export function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: unknown }).name;
  const code = (e as { code?: unknown }).code;
  return name === "AbortError" || name === "TimeoutError" || code === "ABORT_ERR" || code === "ERR_CANCELED";
}

/** Error details are only echoed to the client outside production (they can leak fetch internals). */
export function devDetails(value: unknown): unknown {
  if (process.env.NODE_ENV === "production") return undefined;
  return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
}
