// Synthetic secrets for the tests. Every one is built here at run time, from a seeded generator and split prefixes, so no
// file holds anything shaped like a real credential (code hosts reject pushes that do).

let seed = 20261104;

/** `count` characters from `alphabet`, the same ones on every run. */
export function chars(alphabet, count) {
  let out = "";
  for (let index = 0; index < count; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out += alphabet[seed % alphabet.length];
  }
  return out;
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
export const B62 = UPPER + LOWER + DIGITS;
export const B64 = B62 + "+/";
export const B64URL = B62 + "-_";
export const B32 = UPPER + "234567";
export const HEX = "0123456789abcdef";

/** Like `chars`, but sure to hold a capital, a small letter and a digit, as random keys do. */
export function key(alphabet, count) {
  return "Aa1" + chars(alphabet, count - 3);
}

const base64url = (text) => btoa(text).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** One of each format the rule must catch, by name: the whole secret. */
export function secrets() {
  const list = {};
  const add = (name, prefix, body) => {
    list[name] = prefix + body;
  };
  add("githubClassic", "gh" + "p_", key(B62, 36));
  add("githubOAuth", "gh" + "o_", key(B62, 36));
  add("githubUser", "gh" + "u_", key(B62, 36));
  add("githubServer", "gh" + "s_", key(B62, 36));
  add("githubRefresh", "gh" + "r_", key(B62, 36));
  add("githubFineGrained", "github" + "_pat_", `${key(B62, 22)}_${key(B62, 59)}`);
  add("gitlab", "gl" + "pat-", key(B64URL, 20));
  add("slackBot", "xo" + "xb-", `${chars(DIGITS, 12)}-${chars(DIGITS, 13)}-${key(B62, 24)}`);
  add("slackUser", "xo" + "xp-", `${chars(DIGITS, 12)}-${chars(DIGITS, 12)}-${chars(DIGITS, 13)}-${chars(HEX, 32)}`);
  add("slackApp", "xa" + "pp-", `1-A${chars(UPPER + DIGITS, 10)}-${chars(DIGITS, 13)}-${chars(HEX, 64)}`);
  add("slackWebhook", "https://hooks." + "slack.com/services/", `T${chars(UPPER + DIGITS, 10)}/B${chars(UPPER + DIGITS, 10)}/${key(B62, 24)}`);
  add("stripeLive", "sk" + "_live_", key(B62, 99));
  add("stripeTest", "sk" + "_test_", key(B62, 24));
  add("stripeRestricted", "rk" + "_live_", key(B62, 24));
  add("stripeRestrictedTest", "rk" + "_test_", key(B62, 24));
  add("google", "AI" + "za", key(B64URL, 35));
  add("openaiProject", "sk-" + "proj-", key(B64URL, 156));
  add("openaiService", "sk-" + "svcacct-", key(B64URL, 156));
  add("openaiLegacy", "sk" + "-", `${key(B62, 20)}T3Blbk${"FJ"}${chars(B62, 20)}`);
  add("anthropic", "sk-" + "ant-api03-", `${key(B64URL, 93)}AA`);
  add("npm", "np" + "m_", key(B62, 36));
  add("pypi", "py" + "pi-", `AgEIcHlwaS5vcmc${key(B64URL, 70)}`);
  add("sendgrid", "S" + "G.", `${key(B64URL, 22)}.${key(B64URL, 43)}`);
  add("twilio", "S" + "K", chars(HEX, 32));
  add("awsAccessKey", "AK" + "IA", chars(B32, 16));
  add("awsSessionKey", "AS" + "IA", chars(B32, 16));
  add("discord", "", `${base64url("1" + chars(DIGITS, 17))}.${key(B64URL, 6)}.${key(B64URL, 27)}`);
  add("telegram", `${chars("123456789", 1)}${chars(DIGITS, 8)}:`, `A${key(B64URL, 34)}`);
  return list;
}

/** A private key block with `lines` lines of base64. */
export function privateKey(label = "RSA ", lines = 6, nl = "\n") {
  const body = Array.from({ length: lines }, (_, index) => key(B64, index === lines - 1 ? 24 : 64)).join(nl);
  const header = `-----BEGIN ${label}PRIVATE` + " KEY-----";
  const footer = `-----END ${label}PRIVATE` + " KEY-----";
  return { header, body, footer, block: `${header}${nl}${body}${nl}${footer}` };
}

/** An AWS secret access key: 40 characters of base64. */
export const awsSecret = () => key(B64, 38) + "/+";

/** A base32 two-factor seed. */
export const otpSeed = (count = 32) => chars(B32, count);

/** A JSON Web Token with `header` and `payload`, and a made-up signature. */
export function jwt(header = { alg: "HS256", typ: "JWT" }, payload = { sub: "ada", iat: 1767225600 }) {
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}.${key(B64URL, 43)}`;
}
