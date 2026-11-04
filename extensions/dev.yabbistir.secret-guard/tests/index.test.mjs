import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";

import { captureRules, findSecrets, isPlaceholder, LIMIT, maskSecrets } from "../src/index.ts";
import { awsSecret, B32, B62, B64, chars, HEX, jwt, key, otpSeed, privateKey, secrets } from "./fixtures.mjs";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const accepts = manifest.contributes.captureRules[0].accepts;

const dropHost = createFakeHost({ folder });
const maskHost = createFakeHost({ folder, preferences: { mode: "mask" } });
const text = (value) => ({ kind: "text", text: value });
const code = (value) => ({ kind: "code", text: value });
const link = (url) => ({ kind: "link", url, text: url });
const drop = (item, host = dropHost) => host.capture(captureRules.guard, item);
const mask = (item, host = maskHost) => host.capture(captureRules.guard, item);
const find = (value, jwtOn = false) => findSecrets(value, { jwt: jwtOn });

const formats = secrets();

describe("formats", () => {
  for (const [name, { token, masked }] of Object.entries(formats)) {
    test(`${name}IsFound`, async () => {
      const found = find(`before ${token} after`);
      assert.equal(found.length, 1, name);
      assert.equal(`before ${token} after`.slice(found[0].start, found[0].end), token, name);
      assert.deepEqual(await drop(text(token)), { ignore: true });
      assert.deepEqual(await mask(text(`key: ${token}`)), { replace: { text: `key: ${masked}` } });
    });
  }

  test("aTokenAtTheEndOfASentenceKeepsTheFullStop", async () => {
    const { token, masked } = formats.githubClassic;
    assert.deepEqual(await mask(text(`Use ${token}.`)), { replace: { text: `Use ${masked}.` } });
  });

  test("aSlackWebhookIsALinkToo", async () => {
    const { token, masked } = formats.slackWebhook;
    assert.deepEqual(await drop(link(token)), { ignore: true });
    // A masked link is no longer an address, so it is stored as text.
    assert.deepEqual(await mask(link(token)), { replace: { text: masked } });
  });

  test("aTokenInAnAddressIsFound", async () => {
    const { token, masked } = formats.githubClassic;
    const url = `https://x-access-token:${token}@github.com/example/repo.git`;
    assert.deepEqual(await mask(link(url)), { replace: { text: `https://x-access-token:${masked}@github.com/example/repo.git` } });
  });

  test("everyGitHubPrefixCounts", () => {
    for (const prefix of ["p", "o", "u", "s", "r"]) assert.equal(find(`gh${prefix}_${key(B62, 36)}`).length, 1, prefix);
    assert.equal(find(`gh${"x"}_${key(B62, 36)}`).length, 0);
  });

  test("gitLabsOtherLongLivedTokensCount", () => {
    for (const prefix of ["gldt-", "glrt-", "glptt-", "gloas-"]) assert.equal(find(prefix + key(B62, 24)).length, 1, prefix);
  });

  test("aRotatingSlackTokenKeepsItsWholePrefix", async () => {
    const token = `xoxe.${"xo"}xp-1-${key(B62, 40)}`;
    assert.deepEqual(await mask(text(token)), { replace: { text: `xoxe.xoxp-••••••••${token.slice(-4)}` } });
  });
});

describe("privateKeys", () => {
  for (const label of ["", "RSA ", "EC ", "DSA ", "OPENSSH ", "ENCRYPTED "]) {
    test(`${label.trim() || "PKCS8"}KeyIsFound`, async () => {
      const { header, footer, block } = privateKey(label);
      assert.deepEqual(await drop(text(block)), { ignore: true });
      assert.deepEqual(await mask(text(block)), { replace: { text: `${header}\n••••••••\n${footer}` } });
    });
  }

  test("aPgpKeyBlockIsFound", async () => {
    const header = "-----BEGIN PGP PRIVATE" + " KEY BLOCK-----";
    const footer = "-----END PGP PRIVATE KEY BLOCK-----";
    const block = `${header}\nComment: synthetic\n\n${key(B64, 64)}\n${key(B64, 64)}\n=${chars(B62, 4)}\n${footer}`;
    assert.deepEqual(await mask(text(block)), { replace: { text: `${header}\n••••••••\n${footer}` } });
  });

  test("aKeyInTheMiddleOfATextKeepsTheText", async () => {
    const { header, footer, block } = privateKey("OPENSSH ", 4);
    const message = `Here is the deploy key:\n\n${block}\n\nDelete it after use.`;
    assert.deepEqual(await mask(text(message)),
      { replace: { text: `Here is the deploy key:\n\n${header}\n••••••••\n${footer}\n\nDelete it after use.` } });
    assert.deepEqual(await drop(text(message)), { ignore: true });
  });

  test("aKeyInsideAJsonStringKeepsItsEscapedLineBreaks", async () => {
    const { header, footer, block } = privateKey("", 3, "\\n");
    const json = `{"type": "service_account", "private_key": "${block}\\n", "client_email": "bot@example.iam"}`;
    assert.deepEqual(await mask(code(json)),
      { replace: { text: `{"type": "service_account", "private_key": "${header}\\n••••••••\\n${footer}\\n", "client_email": "bot@example.iam"}` } });
  });

  test("windowsLineEndsStay", async () => {
    const { header, footer, block } = privateKey("EC ", 3, "\r\n");
    assert.deepEqual(await mask(text(block)), { replace: { text: `${header}\r\n••••••••\r\n${footer}` } });
  });

  test("aKeyCopiedWithoutItsEndLineIsFound", async () => {
    const { header, body } = privateKey("RSA ", 4);
    const partial = `${header}\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,${chars(HEX, 32).toUpperCase()}\n\n${body}\n\nthat was all I could copy`;
    assert.deepEqual(await mask(text(partial)), { replace: { text: `${header}\n••••••••\n\nthat was all I could copy` } });
  });

  test("aHeaderAloneIsNotAKey", async () => {
    const header = "-----BEGIN RSA PRIVATE" + " KEY-----";
    assert.deepEqual(await drop(text(`A key file starts with ${header} and then base64.`)), { keep: true });
    assert.deepEqual(await drop(text(`${header}\n-----END RSA PRIVATE KEY-----`)), { keep: true });
  });

  test("publicKeysAndCertificatesStay", async () => {
    for (const label of ["PUBLIC KEY", "CERTIFICATE", "RSA PUBLIC KEY", "OPENSSH PUBLIC KEY"]) {
      const block = `-----BEGIN ${label}-----\n${key(B64, 64)}\n${key(B64, 64)}\n-----END ${label}-----`;
      assert.deepEqual(await drop(text(block)), { keep: true }, label);
    }
    assert.deepEqual(await drop(text(`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${key(B64, 43)} ada@example`)), { keep: true });
  });
});

describe("aws", () => {
  test("aLabeledSecretKeyIsFound", async () => {
    const secret = awsSecret();
    const id = formats.awsAccessKey.token;
    const credentials = `[default]\naws_access_key_id = ${id}\naws_secret_access_key = ${secret}\nregion = eu-central-1`;
    assert.deepEqual(await mask(text(credentials)), { replace: { text:
      `[default]\naws_access_key_id = ${formats.awsAccessKey.masked}\naws_secret_access_key = ••••••••${secret.slice(-4)}\nregion = eu-central-1` } });
  });

  test("theCommandLinesJsonIsFound", async () => {
    const secret = awsSecret();
    const session = key(B64, 300);
    const output = JSON.stringify({ Credentials: { AccessKeyId: formats.awsSessionKey.token, SecretAccessKey: secret, SessionToken: session } }, null, 2);
    const masked = (await mask(code(output))).replace.text;
    for (const part of [secret, session, formats.awsSessionKey.token]) assert.ok(!masked.includes(part));
    assert.match(masked, /"SecretAccessKey": "••••••••/);
    assert.match(masked, /"SessionToken": "••••••••/);
  });

  test("anUnlabeledFortyCharacterStringStays", async () => {
    assert.deepEqual(await drop(text(awsSecret())), { keep: true });
  });

  test("awsDocumentationSamplesStay", async () => {
    const sample = "AKIA" + "IOSFODNN7" + "EXAMPLE";
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCY" + "EXAMPLEKEY";
    assert.deepEqual(await drop(text(`aws_access_key_id = ${sample}\naws_secret_access_key = ${secret}`)), { keep: true });
  });

  test("theAccessKeyIdNeedsItsLength", async () => {
    assert.deepEqual(await drop(text("AKIA is how AWS access key ids start, as in AKIA1234 or AKIAEXAMPLE.")), { keep: true });
    assert.deepEqual(await drop(text(`AKIA${chars(B32, 15)}`)), { keep: true });
    assert.deepEqual(await drop(text(`AKIA${chars(B32, 17)}`)), { keep: true });
  });
});

describe("connectionStrings", () => {
  const password = key(B62, 18);
  const schemes = ["postgres", "postgresql", "mysql", "mariadb", "mongodb", "mongodb+srv", "redis", "rediss", "amqp", "amqps", "postgresql+psycopg2"];
  for (const scheme of schemes) {
    test(`${scheme}PasswordIsMasked`, async () => {
      const address = `${scheme}://app:${password}@db.example.com:5432/app?sslmode=require`;
      assert.deepEqual(await drop(link(address)), { ignore: true });
      assert.deepEqual(await mask(text(`DATABASE_URL=${address}`)),
        { replace: { text: `DATABASE_URL=${scheme}://app:••••••••@db.example.com:5432/app?sslmode=require` } });
    });
  }

  test("redisWithoutAUserIsMasked", async () => {
    assert.deepEqual(await mask(text(`redis://:${password}@localhost:6379/0`)), { replace: { text: "redis://:••••••••@localhost:6379/0" } });
  });

  test("anAtSignInThePasswordStaysHidden", async () => {
    assert.deepEqual(await mask(text(`postgres://app:pa@${password}@db.example.com/app`)),
      { replace: { text: "postgres://app:••••••••@db.example.com/app" } });
  });

  test("addressesWithoutAPasswordStay", async () => {
    for (const address of [
      "postgres://localhost:5432/app", "postgres://app@db.example.com/app", "mongodb://db.example.com:27017",
      "mongodb+srv://<username>:<password>@cluster0.example.mongodb.net", "postgres://user:password@localhost/app",
      "mysql://root:${MYSQL_ROOT_PASSWORD}@db/app", "redis://default:%3Cpassword%3E@localhost:6379",
      "https://ada:hunter2@example.com/", "ftp://ada:hunter22@example.com/",
    ]) {
      assert.deepEqual(await drop(text(address)), { keep: true }, address);
    }
  });
});

describe("envFiles", () => {
  test("threeSecretsAndTwoHarmlessLines", async () => {
    const stripe = formats.stripeLive;
    const session = key(B62, 32);
    const dbPassword = key(B62, 14);
    const env = [
      "# Example app",
      "NODE_ENV=production",
      `STRIPE_SECRET_KEY=${stripe.token}`,
      `SESSION_SECRET="${session}"`,
      `export DB_PASSWORD='${dbPassword}'`,
      "PORT=3000",
    ].join("\n");
    assert.deepEqual(await drop(text(env)), { ignore: true });
    assert.deepEqual(await mask(code(env)), { replace: { text: [
      "# Example app",
      "NODE_ENV=production",
      `STRIPE_SECRET_KEY=${stripe.masked}`,
      `SESSION_SECRET="••••••••${session.slice(-4)}"`,
      "export DB_PASSWORD='••••••••'",
      "PORT=3000",
    ].join("\n") } });
    assert.deepEqual(find(env).map((finding) => finding.kind), ["stripe", "env", "env"]);
  });

  test("keyNamesThatSaySecret", () => {
    const value = key(B62, 24);
    for (const name of ["API_KEY", "OPENAI_API_KEY", "APIKEY", "GITHUB_TOKEN", "TOKEN", "CLIENT_SECRET", "JWT_SECRET",
      "DJANGO_SECRET_KEY", "SECRET_KEY_BASE", "AWS_SECRET_ACCESS_KEY", "PASSWORD", "SMTP_PASS", "GPG_PASSPHRASE",
      "password", "db_password", "SIGNING_KEY", "ENCRYPTION_KEY", "MASTER_KEY", "PRIVATE_KEY"]) {
      assert.equal(find(`${name}=${value}`).length, 1, name);
    }
  });

  test("keyNamesThatDoNot", () => {
    const value = key(B62, 24);
    for (const name of ["NODE_ENV", "TOKEN_URL", "MAX_TOKENS", "PASSWORD_MIN_LENGTH", "SECRETS_DIR", "KEY", "SORT_KEY",
      "PUBLIC_KEY_ID", "AWS_ACCESS_KEY_ID", "PWD", "OLDPWD", "BYPASS_CACHE", "TOKENIZER"]) {
      assert.equal(find(`${name}=${value}`).length, 0, name);
    }
  });

  test("composeAndExportLinesCount", () => {
    const value = key(B62, 24);
    assert.equal(find(`services:\n  app:\n    environment:\n      - API_KEY=${value}\n`).length, 1);
    assert.equal(find(`export API_KEY=${value}`).length, 1);
    assert.equal(find(`  API_KEY = "${value}"`).length, 1);
  });

  test("onlyTheValueIsMasked", async () => {
    const value = key(B62, 24);
    assert.deepEqual(await mask(text(`API_KEY=${value} # from the dashboard`)),
      { replace: { text: `API_KEY=••••••••${value.slice(-4)} # from the dashboard` } });
  });

  test("passwordsNeverShowTheirLastFour", async () => {
    const value = key(B62, 30);
    assert.deepEqual(await mask(text(`ADMIN_PASSWORD=${value}`)), { replace: { text: "ADMIN_PASSWORD=••••••••" } });
  });

  test("placeholdersAndReferencesStay", async () => {
    const example = [
      "API_KEY=", "API_KEY=your-api-key-here", "API_KEY=<your key>", "API_KEY=${API_KEY}", "API_KEY=$OPENAI_KEY",
      "TOKEN=changeme", "DB_PASSWORD=password", "SECRET=xxxxxxxxxxxx", "API_KEY=sk-xxxxxxxxxxxxxxxx", "TOKEN=********",
      "SECRET_KEY={{ secret_key }}", "API_KEY=\"\"", "PASSWORD=hunt", "TOKEN=$(cat ~/.token)", "SECRET=%APP_SECRET%",
      "# API_KEY=commented-out-value",
    ].join("\n");
    assert.deepEqual(await drop(text(example)), { keep: true });
  });

  test("codeStays", async () => {
    for (const snippet of [
      "token = get_token()",
      "password = os.environ[\"DB_PASSWORD\"]",
      "client = Client(\n    api_key=api_key,\n    token=settings.TOKEN,\n)",
      "const token = await getToken();",
      "self.token = token",
      "api_key=config.api_key",
      "TOKEN=read_token(path)",
      "secret = None",
      "password = input()",
      "API_KEY = settings.API_KEY",
    ]) {
      assert.deepEqual(await drop(code(snippet)), { keep: true }, snippet);
    }
  });
});

describe("twoFactorSeeds", () => {
  const seed = otpSeed(32);

  test("anOtpauthAddressLosesItsSeed", async () => {
    const address = `otpauth://totp/Example:ada%40example.com?secret=${seed}&issuer=Example&period=30`;
    assert.deepEqual(await drop(link(address)), { ignore: true });
    assert.deepEqual(await mask(link(address)),
      { replace: { text: "otpauth://totp/Example:ada%40example.com?secret=••••••••&issuer=Example&period=30" } });
  });

  test("hotpAndASecretAtTheEndCount", async () => {
    assert.deepEqual(await mask(text(`otpauth://hotp/Example?counter=0&secret=${seed}`)),
      { replace: { text: "otpauth://hotp/Example?counter=0&secret=••••••••" } });
  });

  test("aMigrationAddressLosesItsData", async () => {
    const data = encodeURIComponent(btoa(chars(B64, 90)));
    assert.deepEqual(await mask(text(`otpauth-migration://offline?data=${data}`)),
      { replace: { text: "otpauth-migration://offline?data=••••••••" } });
  });

  test("anAddressWithoutASeedStays", async () => {
    assert.deepEqual(await drop(text("otpauth://totp/Example:ada?issuer=Example")), { keep: true });
    assert.deepEqual(await drop(text("Authenticator apps read otpauth:// links from QR codes.")), { keep: true });
  });

  const exports = {
    aegis: () => ({ version: 1, header: { slots: null, params: null }, db: { version: 3, entries: [
      { type: "totp", uuid: crypto.randomUUID(), name: "ada@example.com", issuer: "Example", note: "",
        info: { secret: otpSeed(32), algo: "SHA1", digits: 6, period: 30 } },
      { type: "totp", uuid: crypto.randomUUID(), name: "ada", issuer: "Sample", info: { secret: otpSeed(16), algo: "SHA256", digits: 8, period: 30 } },
    ] } }),
    twoFas: () => ({ schemaVersion: 4, appVersionCode: 5000000, services: [
      { name: "Example", secret: otpSeed(32), updatedAt: 1767225600000,
        otp: { label: "ada@example.com", account: "ada@example.com", issuer: "Example", digits: 6, period: 30, algorithm: "SHA1", tokenType: "TOTP", source: "Manual" },
        order: { position: 0 }, icon: { selected: "Label", label: { text: "EX", backgroundColor: "Default" } } },
    ] }),
    lastPass: () => ({ version: 3, accounts: [
      { accountID: "", issuerName: "Example", originalIssuerName: "Example", userName: "ada@example.com", originalUserName: "ada@example.com",
        pushNotification: false, secret: otpSeed(32), timeStep: 30, digits: 6, creationTimestamp: 1767225600000, isFavorite: false,
        algorithm: "SHA1", folderData: { folderId: 0, position: 0 } },
    ], folders: [{ id: 0, name: "Favorites", isOpened: true }] }),
    andOtp: () => [{ secret: otpSeed(32), issuer: "Example", label: "ada@example.com", digits: 6, type: "TOTP", algorithm: "SHA1", period: 30, tags: [] }],
    bitwarden: () => ({ encrypted: false, items: [
      { id: crypto.randomUUID(), name: "Example", type: 1, favorite: false, login: { username: "ada", totp: otpSeed(32) } },
      { id: crypto.randomUUID(), name: "Sample", type: 1, favorite: false, login: { totp: `otpauth://totp/Sample:ada?secret=${otpSeed(32)}&issuer=Sample` } },
    ] }),
  };

  for (const [name, make] of Object.entries(exports)) {
    test(`${name}ExportLosesEverySeed`, async () => {
      for (const indent of [0, 2]) {
        const document = JSON.stringify(make(), null, indent);
        const seeds = [...document.matchAll(/[A-Z2-7]{16,}/g)].map((match) => match[0]);
        assert.ok(seeds.length > 0);
        assert.deepEqual(await drop(code(document)), { ignore: true });
        const masked = (await mask(code(document))).replace.text;
        for (const each of seeds) assert.ok(!masked.includes(each), `${name}: a seed stayed`);
        // The rest of the document is untouched: only the seeds turned into dots.
        assert.equal(masked.replace(/••••••••/g, ""), seeds.reduce((rest, each) => rest.replace(each, ""), document));
      }
    });
  }

  test("aSecretFieldWithoutAuthenticatorKeysStays", async () => {
    assert.deepEqual(await drop(code(JSON.stringify({ name: "build", secret: otpSeed(32) }))), { keep: true });
    assert.deepEqual(await drop(code(JSON.stringify({ secret: "not base32 at all: 0189", issuer: "Example", digits: 6 }))), { keep: true });
  });
});

describe("jsonWebTokens", () => {
  const token = jwt();
  const jwtHost = createFakeHost({ folder, preferences: { jwt: true } });
  const jwtMaskHost = createFakeHost({ folder, preferences: { jwt: true, mode: "mask" } });

  test("keptWhileTheToggleIsOff", async () => {
    assert.equal(manifest.preferences.find((preference) => preference.id === "jwt").default, false);
    assert.deepEqual(await drop(text(token)), { keep: true });
    assert.deepEqual(await mask(text(`Authorization: Bearer ${token}`)), { keep: true });
  });

  test("aSecretWhileItIsOn", async () => {
    assert.deepEqual(await drop(text(token), jwtHost), { ignore: true });
    assert.deepEqual(await mask(text(`Authorization: Bearer ${token}`), jwtMaskHost),
      { replace: { text: `Authorization: Bearer eyJ••••••••${token.slice(-4)}` } });
  });

  test("onlyAWellFormedHeaderCounts", async () => {
    const noAlg = jwt({ typ: "JWT" });
    const notJson = `eyJ${chars(B62, 20)}.${chars(B62, 30)}.${key(B62, 43)}`;
    assert.deepEqual(await drop(text(noAlg), jwtHost), { keep: true });
    assert.deepEqual(await drop(text(notJson), jwtHost), { keep: true });
  });

  test("otherSecretsStillCountWithTheToggleOn", async () => {
    assert.deepEqual(await drop(text(formats.npm.token), jwtHost), { ignore: true });
  });
});

describe("inLongerTexts", () => {
  test("aSecretInAChatMessage", async () => {
    const { token, masked } = formats.openaiProject;
    const message = `hey, can you try this key? ${token} — it's the staging one, I'll rotate it tomorrow`;
    assert.deepEqual(await drop(text(message)), { ignore: true });
    assert.deepEqual(await mask(text(message)),
      { replace: { text: `hey, can you try this key? ${masked} — it's the staging one, I'll rotate it tomorrow` } });
  });

  test("severalSecretsAreEachMasked", async () => {
    const { githubClassic, npm, google, anthropic } = formats;
    const notes = `gh: ${githubClassic.token}\nnpm: ${npm.token}\nmaps: "${google.token}"\nclaude: ${anthropic.token}`;
    assert.deepEqual(await mask(text(notes)),
      { replace: { text: `gh: ${githubClassic.masked}\nnpm: ${npm.masked}\nmaps: "${google.masked}"\nclaude: ${anthropic.masked}` } });
  });

  test("aTokenInAnEnvLineKeepsItsPrefix", async () => {
    const { token, masked } = formats.githubClassic;
    assert.deepEqual(await mask(text(`GITHUB_TOKEN=${token}`)), { replace: { text: `GITHUB_TOKEN=${masked}` } });
    assert.deepEqual(find(`GITHUB_TOKEN=${token}`).map((finding) => finding.kind), ["github"]);
  });

  test("aSecretPastTheFirst64KBIsFound", async () => {
    const { token, masked } = formats.githubClassic;
    const log = "build step ok\n".repeat(6000);
    // The app matches accepts.pattern against the first 64 KB only; a copy that long reaches the rule anyway.
    assert.ok(acceptsMatch(accepts, text(log.slice(0, 65536))));
    assert.deepEqual(await mask(text(`${log}${token}\n`)), { replace: { text: `${log}${masked}\n` } });
  });
});

describe("benign", () => {
  const sha = chars(HEX, 40);
  const benign = {
    gitSha: sha,
    shortSha: `fix(panel): ${sha.slice(0, 7)} keeps the caret`,
    gitLog: `commit ${sha}\nAuthor: Ada <ada@example.com>\n\n    feat: new thing`,
    uuid: crypto.randomUUID(),
    uuidUpper: crypto.randomUUID().toUpperCase(),
    sha256: chars(HEX, 64),
    sha256Sum: `${chars(HEX, 64)}  yabbistir-0.4.0.dmg`,
    md5: chars(HEX, 32),
    base64Blob: btoa(String.fromCharCode(...Array.from({ length: 600 }, (_, index) => (index * 37 + 11) % 256))),
    base64Image: `data:image/png;base64,iVBORw0KGgo${chars(B64, 900)}=`,
    base32: otpSeed(32),
    longUrl: "https://www.example.com/search?q=clipboard+history&utm_source=newsletter&utm_medium=email&session=7f3a9c&token_type=bearer&page=2#results",
    oauthUrl: "https://accounts.example.com/o/oauth2/auth?client_id=1234.apps.example.com&redirect_uri=https%3A%2F%2Fexample.com&response_type=code&scope=email",
    skInProse: "Install scikit-learn (people call it sk-learn); the sk- prefix alone means nothing, and this task-runner is risk-free.",
    skShort: "sk-1234 and sk-proj-abc are too short to be keys",
    akiaInProse: "AKIA is how AWS access key ids start, as in AKIA followed by sixteen characters.",
    prefixesInProse: "GitHub tokens start with ghp_ or github_pat_, GitLab ones with glpat-, Slack ones with xoxb- or xoxp-, npm ones with npm_.",
    versions: "v1.2.3, 2.0.0-rc.1+build.5, 10.15.7, 0.4.0 (2026-11-03), node v24.20.0",
    cssColors: "color: #ff8800; background: rgb(12, 34, 56); border-color: hsl(210 40% 50%); outline: #0a0b0c80;",
    css: ".panel { box-shadow: 0 8px 24px rgba(0,0,0,.18); border-radius: 12px; }",
    json: JSON.stringify({ name: "yabbistir", version: "0.4.0", token_type: "bearer", expires_in: 3600, secret: false }, null, 2),
    swift: "let token = try await session.token(for: account)\nguard let password = keychain.password(for: id) else { return }",
    typescript: "const apiKey = process.env.API_KEY ?? \"\";\nexport const token = await getToken();",
    shell: "export PATH=\"$HOME/.nvm/versions/node/v24.20.0/bin:$PATH\"\nTOKEN=$(gh auth token)\necho $TOKEN | wc -c",
    envHarmless: "NODE_ENV=production\nPORT=3000\nTOKEN_URL=https://example.com/oauth/token\nMAX_TOKENS=4096\nPASSWORD_MIN_LENGTH=12",
    timestamps: "12:30:45 09:00 2026-11-04T12:34:56Z 1767225600",
    phone: "+90 555 123 45 67, IBAN TR00 0000 0000 0000 0000 0000 00",
    sshPublicKey: `ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ${chars(B64, 300)} ada@example`,
    turkishProse: "Şifreni kimseyle paylaşma; token’ı da bir yere yazma. Gizli anahtar dosyasını sil.",
    markdown: "## Tokens\n\nSet `GITHUB_TOKEN` in your shell, then run `gh auth status`.",
    slackChannel: "https://example.slack.com/archives/C01234567/p1767225600000100",
    jwtLookalike: `eyJhbGciOi.${chars(B62, 10)}`,
    docsWithEllipses: "STRIPE_SECRET_KEY=sk_live_…\nSESSION_SECRET=\"…\"\nexport GITHUB_TOKEN=ghp_…",
    templateSource: "const address = `postgres://app:${password}@db/app`;\nconst link = `otpauth://totp/Example?secret=${seed}&issuer=Example`;",
    otpPlaceholder: "otpauth://totp/Example:ada?secret=<your secret>&issuer=Example",
  };

  for (const [name, value] of Object.entries(benign)) {
    test(`${name}IsKept`, async () => {
      for (const jwtOn of [false, true]) assert.deepEqual(find(value, jwtOn), [], name);
      assert.deepEqual(await drop(text(value)), { keep: true });
      assert.deepEqual(await mask(code(value)), { keep: true });
    });
  }

  test("aJwtIsKeptByDefault", async () => {
    assert.deepEqual(await drop(text(jwt())), { keep: true });
  });

  test("mostOrdinaryCopiesNeverReachTheRule", () => {
    for (const name of ["gitSha", "uuid", "sha256", "versions", "cssColors", "css", "timestamps", "phone", "turkishProse", "slackChannel"]) {
      assert.equal(acceptsMatch(accepts, text(benign[name])), false, name);
    }
  });
});

describe("theRule", () => {
  test("dropIsTheDefault", async () => {
    assert.equal(manifest.preferences.find((preference) => preference.id === "mode").default, "drop");
    assert.deepEqual(await drop(text(formats.npm.token)), { ignore: true });
  });

  test("anUnknownModeDrops", async () => {
    const host = createFakeHost({ folder, preferences: { mode: "something-else" } });
    assert.deepEqual(await drop(text(formats.npm.token), host), { ignore: true });
  });

  test("codeAndLinksAreCovered", async () => {
    assert.deepEqual(accepts.kinds, ["text", "code", "link"]);
    assert.deepEqual(await drop(code(`const key = "${formats.stripeLive.token}";`)), { ignore: true });
  });

  test("emptyAndMissingTextIsKept", async () => {
    assert.deepEqual(await drop(text("")), { keep: true });
    assert.deepEqual(await drop({ kind: "link", url: undefined, text: undefined }), { keep: true });
  });

  test("aCopyOverTheLimitIsKept", async () => {
    const huge = `${formats.githubClassic.token}\n${"x".repeat(LIMIT)}`;
    assert.deepEqual(await drop(text(huge)), { keep: true });
  });

  test("aLargeCopyIsQuick", () => {
    const big = Array.from({ length: 3000 }, (_, index) => `${index} ${key(B64, 60)} KEY_${index}=${chars(B62, 12)}`).join("\n");
    const started = performance.now();
    findSecrets(big, { jwt: true });
    // The app allows 200 ms; this takes a few.
    assert.ok(performance.now() - started < 150);
  });

  test("findsComeInOrderWithoutOverlaps", () => {
    const { githubClassic, twilio, telegram } = formats;
    const found = find(`${telegram.token} then ${githubClassic.token} and ${twilio.token}`);
    assert.deepEqual(found.map((finding) => finding.kind), ["telegram", "github", "twilio"]);
    for (let index = 1; index < found.length; index++) assert.ok(found[index - 1].end <= found[index].start);
  });

  test("maskSecretsLeavesATextWithoutFindsAlone", () => {
    assert.equal(maskSecrets("nothing here", []), "nothing here");
  });

  test("placeholders", () => {
    for (const value of ["", "  ", "$X", "${X}", "<token>", "{{ x }}", "xxxxxx", "******", "your_key", "put-it-here", "changeme", "Example", "a•••b"]) {
      assert.equal(isPlaceholder(value), true, value);
    }
    for (const value of [key(B62, 12), "hunter22", "s3cr3t-Pa55"]) assert.equal(isPlaceholder(value), false, value);
  });
});

describe("nothingSecretLeaks", () => {
  test("theRuleLogsNothingAndAMaskedCopyHoldsNoSecret", async () => {
    const host = createFakeHost({ folder, preferences: { mode: "mask", jwt: true } });
    const all = Object.values(formats).map(({ token }) => token);
    const block = privateKey("RSA ");
    const seed = otpSeed(32);
    const password = key(B62, 16);
    const input = [...all, block.block, `otpauth://totp/Example?secret=${seed}`, `postgres://app:${password}@db/app`, jwt()].join("\n");
    const result = await host.capture(captureRules.guard, text(input));
    for (const token of all) assert.ok(!result.replace.text.includes(token));
    for (const part of [block.body, seed, password]) assert.ok(!result.replace.text.includes(part));
    assert.deepEqual(host.logs, []);
    assert.deepEqual(host.calls, []);
    assert.deepEqual(host.notifications, []);
  });

  test("aMaskedCopyCopiedAgainIsKept", async () => {
    const host = createFakeHost({ folder, preferences: { mode: "mask", jwt: true } });
    const env = `API_KEY=${key(B62, 24)}\nDB_PASSWORD='${key(B62, 12)}'\nDATABASE_URL=postgres://app:${key(B62, 12)}@db/app`;
    const seeds = JSON.stringify({ db: { entries: [{ issuer: "Example", info: { secret: otpSeed(32), digits: 6 } }] } });
    for (const input of [...Object.values(formats).map(({ token }) => token), privateKey("EC ").block, env, seeds,
      `otpauth://totp/Example?secret=${otpSeed(32)}`, jwt()]) {
      const masked = (await host.capture(captureRules.guard, text(input))).replace.text;
      assert.deepEqual(await host.capture(captureRules.guard, text(masked)), { keep: true }, masked);
    }
  });

  test("findsCarryNoText", () => {
    const [finding] = find(formats.npm.token);
    assert.deepEqual(Object.keys(finding).sort(), ["end", "keep", "kind", "start", "tail"]);
  });
});

describe("manifest", () => {
  test("thePrefilterLetsEveryFormatThrough", () => {
    const seed = otpSeed(32);
    const samples = [
      ...Object.values(formats).map(({ token }) => token),
      privateKey("RSA ").block, privateKey("").block, `aws_secret_access_key = ${awsSecret()}`, `"SecretAccessKey": "${awsSecret()}"`,
      `"SessionToken": "${key(B64, 120)}"`, `postgresql+psycopg2://app:${key(B62, 12)}@db/app`, `amqps://app:${key(B62, 12)}@mq/vhost`,
      `otpauth://totp/Example?secret=${seed}`, `otpauth-migration://offline?data=${seed}`, `{"info":{"secret":"${seed}","digits":6}}`,
      `{"login":{"totp":"${seed}"}}`, `API_KEY=${key(B62, 20)}`, `SECRET_KEY_BASE=${key(B62, 40)}`, `GPG_PASSPHRASE='${key(B62, 20)}'`,
      `password = "${key(B62, 12)}"`, jwt(),
    ];
    for (const sample of samples) {
      assert.ok(find(sample, true).length > 0, `the rule finds ${sample.slice(0, 12)}…`);
      for (const kind of ["text", "code"]) assert.ok(acceptsMatch(accepts, { kind, text: `see ${sample} here` }), `${kind}: ${sample.slice(0, 12)}…`);
    }
    assert.ok(acceptsMatch(accepts, link(formats.slackWebhook.token)));
  });

  test("onlyTheCapturePermission", () => {
    assert.deepEqual(manifest.permissions, ["capture"]);
    assert.equal(manifest.network, undefined);
    assert.equal(manifest.requires, undefined);
  });

  test("theRuleDoesNotAskForTags", () => {
    assert.equal(accepts.tags, undefined);
  });

  test("maskingAsksFirst", () => {
    const mode = manifest.preferences.find((preference) => preference.id === "mode");
    assert.deepEqual(mode.options.map((option) => option.id), ["drop", "mask"]);
    assert.equal(typeof mode.confirm, "string");
  });

  test("turkishHasEveryKey", () => {
    const en = JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
    const tr = JSON.parse(fs.readFileSync(new URL("../locales/tr.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
  });
});
