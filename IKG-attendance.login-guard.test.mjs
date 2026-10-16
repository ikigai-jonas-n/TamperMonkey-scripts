import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./IKG-attendance.user.js", import.meta.url), "utf8");
const block = source.slice(source.indexOf("// @@login-guard:start"), source.indexOf("// @@login-guard:end"));
const G = new Function(`${block}\nreturn IkgLoginGuard;`)();

const NOW = Date.UTC(2026, 9, 16, 9, 0);
const MIN = 60e3;
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (expMs) => `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(expMs / 1000) })}.sig`;

describe("allowAutoLogin", () => {
  test("the first two auto-clicks within 5 minutes are allowed", () => {
    const first = G.allowAutoLogin([], NOW);
    const second = G.allowAutoLogin(first.history, NOW + MIN);
    assert.deepEqual([first.allowed, second.allowed, second.history.length], [true, true, 2]);
  });
  test("a 3rd auto-click within 5 minutes is blocked and leaves the history unchanged", () => {
    const history = [NOW - 2 * MIN, NOW - MIN];
    assert.deepEqual(G.allowAutoLogin(history, NOW), { allowed: false, history });
  });
  test("clicks older than 5 minutes are dropped and the click is allowed", () => {
    const r = G.allowAutoLogin([NOW - 6 * MIN, NOW - 5.5 * MIN], NOW);
    assert.deepEqual(r, { allowed: true, history: [NOW] });
  });
  test("a corrupt stored history is treated as empty", () => assert.equal(G.allowAutoLogin("nope", NOW).allowed, true));
});

describe("isSsoCallbackUrl", () => {
  test("an OAuth return with code and state is a callback", () => assert.equal(G.isSsoCallbackUrl("https://ikg.deel.team/login?code=abc&state=xyz"), true));
  test("a /login/callback path is a callback", () => assert.equal(G.isSsoCallbackUrl("https://ikg.deel.team/login/callback"), true));
  test("a SAML or SSO path is a callback", () => {
    assert.equal(G.isSsoCallbackUrl("https://ikg.deel.team/saml/acs"), true);
    assert.equal(G.isSsoCallbackUrl("https://ikg.deel.team/sso/google"), true);
  });
  test("plain /login is not a callback", () => assert.equal(G.isSsoCallbackUrl("https://ikg.deel.team/login"), false));
  test("the dashboard is not a callback", () => assert.equal(G.isSsoCallbackUrl("https://ikg.deel.team/dashboard?tab=home"), false));
});

describe("pickDeelToken", () => {
  test("an expired JWT in token loses to a fresh JWT from the request header", () => {
    const fresh = jwt(NOW + 60 * MIN);
    const r = G.pickDeelToken([{ source: "localStorage.token", value: jwt(NOW - MIN) }, { source: "x-auth-token", value: fresh }], NOW);
    assert.deepEqual(r, { source: "x-auth-token", value: fresh });
  });
  test("a non-JWT opaque token is accepted", () => assert.equal(G.pickDeelToken([{ source: "cookie.auth-token", value: "opaque123" }], NOW).value, "opaque123"));
  test("empty, null and 'undefined' values are ignored", () => {
    assert.equal(G.pickDeelToken([{ source: "a", value: "" }, { source: "b", value: null }, { source: "c", value: "undefined" }, { source: "d", value: "null" }], NOW), null);
  });
  test("surrounding quotes from JSON-stored tokens are stripped", () => assert.equal(G.pickDeelToken([{ source: "s", value: '"opaque"' }], NOW).value, "opaque"));
  test("isJwt recognises three dot-separated base64url parts only", () => {
    assert.deepEqual([G.isJwt(jwt(NOW)), G.isJwt("a.b"), G.isJwt("not a token")], [true, false, false]);
  });
});
