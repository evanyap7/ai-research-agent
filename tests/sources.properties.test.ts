import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { isPublicUrl } from "../lib/sources.ts";

// FC_RUNS=20000 npm test for a deep pass.
const numRuns = Number(process.env.FC_RUNS ?? 300);
const check = (p: fc.IPropertyWithHooks<unknown[]>) => fc.assert(p, { numRuns });

type Quad = [number, number, number, number];
const octet = fc.integer({ min: 0, max: 255 });
const ip = ([a, b, c, d]: Quad) => `${a}.${b}.${c}.${d}`;
const toInt = ([a, b, c, d]: Quad) => ((a * 256 + b) * 256 + c) * 256 + d;
const hex2 = (n: number) => n.toString(16).padStart(2, "0");

// Every range an SSRF guard must refuse, written down independently of ipaddr.js.
const blockedV4: fc.Arbitrary<Quad> = fc.oneof(
  fc.tuple(fc.constant(10), octet, octet, octet),
  fc.tuple(fc.constant(172), fc.integer({ min: 16, max: 31 }), octet, octet),
  fc.tuple(fc.constant(192), fc.constant(168), octet, octet),
  fc.tuple(fc.constant(127), octet, octet, octet),
  fc.tuple(fc.constant(169), fc.constant(254), octet, octet),
  fc.tuple(fc.constant(100), fc.integer({ min: 64, max: 127 }), octet, octet),
  fc.tuple(fc.constant(0), octet, octet, octet),
  fc.tuple(fc.integer({ min: 224, max: 255 }), octet, octet, octet)
);

const publicV4: fc.Arbitrary<Quad> = fc.tuple(
  fc.oneof(
    fc.integer({ min: 11, max: 99 }),
    fc.integer({ min: 101, max: 126 }),
    fc.integer({ min: 130, max: 168 }),
    fc.integer({ min: 174, max: 191 })
  ),
  octet,
  octet,
  octet
);

const scheme = fc.constantFrom("http", "https", "HTTP", "Https");
const port = fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined });
const path = fc.constantFrom("", "/", "/a/b", "/?q=1", "/#frag");
const suffix = fc.tuple(port, path).map(([p, s]) => `${p === undefined ? "" : `:${p}`}${s}`);

test("private, loopback, link-local, CGNAT, unspecified and multicast IPv4 are always rejected", () => {
  check(fc.property(scheme, blockedV4, suffix, (s, q, tail) => {
    assert.equal(isPublicUrl(`${s}://${ip(q)}${tail}`), false);
  }));
});

test("blocked IPv4 stays rejected written as one decimal integer", () => {
  check(fc.property(scheme, blockedV4, (s, q) => {
    assert.equal(isPublicUrl(`${s}://${toInt(q)}/`), false);
  }));
});

test("blocked IPv4 stays rejected written as one hexadecimal integer", () => {
  check(fc.property(scheme, blockedV4, (s, q) => {
    assert.equal(isPublicUrl(`${s}://0x${toInt(q).toString(16)}/`), false);
  }));
});

test("blocked IPv4 stays rejected written with octal or hex octets", () => {
  check(fc.property(blockedV4, fc.constantFrom("octal", "hex"), (q, base) => {
    const host = q.map((n) => (base === "octal" ? `0${n.toString(8)}` : `0x${n.toString(16)}`)).join(".");
    assert.equal(isPublicUrl(`http://${host}/`), false);
  }));
});

test("blocked IPv4 stays rejected inside an IPv4-mapped IPv6 address", () => {
  check(fc.property(blockedV4, fc.constantFrom("dotted", "hex"), (q, form) => {
    const mapped = form === "dotted" ? `::ffff:${ip(q)}` : `::ffff:${hex2(q[0])}${hex2(q[1])}:${hex2(q[2])}${hex2(q[3])}`;
    assert.equal(isPublicUrl(`http://[${mapped}]/`), false);
  }));
});

test("credentials in the URL do not change the verdict on the host", () => {
  check(fc.property(blockedV4, fc.stringMatching(/^[a-z0-9]{1,8}$/), fc.stringMatching(/^[a-z0-9]{1,8}$/), (q, user, pass) => {
    assert.equal(isPublicUrl(`http://${user}:${pass}@${ip(q)}/`), false);
  }));
});

test("globally routable IPv4 is accepted", () => {
  check(fc.property(scheme, publicV4, suffix, (s, q, tail) => {
    assert.equal(isPublicUrl(`${s}://${ip(q)}${tail}`), true);
  }));
});

test("IPv6 loopback, unspecified, unique-local and link-local are rejected", () => {
  const hextet = fc.integer({ min: 0, max: 0xffff }).map((n) => n.toString(16));
  const tail = fc.array(hextet, { minLength: 1, maxLength: 6 }).map((h) => h.join(":"));
  const prefixes = fc.oneof(
    fc.constant("fe80"),
    fc.integer({ min: 0xfc00, max: 0xfdff }).map((n) => n.toString(16))
  );
  check(fc.property(prefixes, tail, (p, t) => {
    assert.equal(isPublicUrl(`http://[${p}::${t}]/`), false);
  }));
  assert.equal(isPublicUrl("http://[::1]/"), false);
  assert.equal(isPublicUrl("http://[::]/"), false);
});

test("hostnames under internal suffixes are rejected, in any letter case", () => {
  const label = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}[a-z0-9]$/);
  const labels = fc.array(label, { minLength: 1, maxLength: 3 }).map((l) => l.join("."));
  check(fc.property(labels, fc.constantFrom("local", "internal", "lan"), fc.boolean(), (host, tld, upper) => {
    const name = `${host}.${tld}`;
    assert.equal(isPublicUrl(`http://${upper ? name.toUpperCase() : name}/`), false);
  }));
});

test("a trailing dot does not turn an internal hostname public", () => {
  const label = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}[a-z0-9]$/);
  check(fc.property(label, fc.constantFrom("local", "internal", "lan"), (host, tld) => {
    assert.equal(isPublicUrl(`http://${host}.${tld}./`), false);
  }));
  assert.equal(isPublicUrl("http://localhost./"), false);
  assert.equal(isPublicUrl("http://169.254.169.254./"), false);
});

test("subdomains of localhost are rejected (RFC 6761 resolves them to loopback)", () => {
  const label = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}[a-z0-9]$/);
  check(fc.property(label, (host) => {
    assert.equal(isPublicUrl(`http://${host}.localhost/`), false);
  }));
});

test("only http and https are ever accepted", () => {
  const schemes = fc.stringMatching(/^[a-z][a-z0-9+.-]{0,9}$/).filter((s) => s !== "http" && s !== "https");
  check(fc.property(schemes, (s) => {
    assert.equal(isPublicUrl(`${s}://example.com/`), false);
  }));
});

test("never throws, whatever the input", () => {
  check(fc.property(fc.string({ unit: "binary" }), (s) => {
    assert.equal(typeof isPublicUrl(s), "boolean");
  }));
});

test("a public hostname with ordinary labels is accepted", () => {
  const label = fc.stringMatching(/^[a-z][a-z0-9]{0,10}[a-z0-9]$/);
  check(fc.property(fc.array(label, { minLength: 1, maxLength: 3 }), fc.constantFrom("com", "org", "net", "io", "dev"), (ls, tld) => {
    fc.pre(ls[ls.length - 1] !== "localhost");
    assert.equal(isPublicUrl(`https://${ls.join(".")}.${tld}/`), true);
  }));
});
