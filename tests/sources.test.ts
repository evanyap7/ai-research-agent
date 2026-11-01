import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicUrl } from "../lib/sources.ts";

test("allows ordinary public http(s) URLs", () => {
  for (const u of ["https://example.com/a", "http://news.ycombinator.com", "https://8.8.8.8/x"]) {
    assert.equal(isPublicUrl(u), true, u);
  }
});

test("rejects non-http schemes and garbage", () => {
  for (const u of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "not a url", ""]) {
    assert.equal(isPublicUrl(u), false, u);
  }
});

test("rejects internal hostnames", () => {
  for (const u of ["http://localhost", "http://db.internal", "http://printer.local", "http://metadata.google.internal"]) {
    assert.equal(isPublicUrl(u), false, u);
  }
});

test("rejects private, loopback, link-local and metadata IPv4", () => {
  for (const u of ["http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.1", "http://172.16.0.1", "http://169.254.169.254", "http://0.0.0.0"]) {
    assert.equal(isPublicUrl(u), false, u);
  }
});

test("rejects loopback, private and mapped IPv6", () => {
  for (const u of ["http://[::1]/", "http://[fc00::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/"]) {
    assert.equal(isPublicUrl(u), false, u);
  }
});
