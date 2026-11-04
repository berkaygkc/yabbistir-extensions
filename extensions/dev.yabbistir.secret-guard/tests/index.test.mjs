import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";

import { captureRules, findSecrets, isPlaceholder, LIMIT } from "../src/index.ts";
import { awsSecret, B32, B62, B64, chars, HEX, jwt, key, otpSeed, privateKey, secrets } from "./fixtures.mjs";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const accepts = manifest.contributes.captureRules[0].accepts;

const host = createFakeHost({ folder });
const jwtHost = createFakeHost({ folder, preferences: { jwt: true } });
const text = (value) => ({ kind: "text", text: value });
const code = (value) => ({ kind: "code", text: value });
const link = (url) => ({ kind: "link", url, text: url });
const capture = (item, on = host) => on.capture(captureRules.guard, item);
const DROPPED = { ignore: true };
const KEPT = { keep: true };
const find = (value, jwtOn = false) => findSecrets(value, { jwt: jwtOn });
/** The secrets found in `value`, as the text they cover. */
const spans = (value, jwtOn = false) => find(value, jwtOn).map((finding) => value.slice(finding.start, finding.end));

const formats = secrets();

describe("formats", () => {
  for (const [name, token] of Object.entries(formats)) {
    test(`${name}IsDropped`, async () => {
      assert.deepEqual(spans(`before ${token} after`), [token], name);
      assert.deepEqual(await capture(text(token)), DROPPED);
      assert.deepEqual(await capture(text(`key: ${token}`)), DROPPED);
      assert.deepEqual(await capture(code(`const key = "${token}";`)), DROPPED);
    });
  }

  test("aTokenAtTheEndOfASentenceEndsBeforeTheFullStop", () => {
    assert.deepEqual(spans(`Use ${formats.githubClassic}.`), [formats.githubClassic]);
  });

  test("aSlackWebhookLinkIsDropped", async () => {
    assert.deepEqual(await capture(link(formats.slackWebhook)), DROPPED);
    assert.deepEqual(spans(formats.slackWebhook), [formats.slackWebhook]);
  });

  test("aTokenInAnAddressIsFound", async () => {
    const url = `https://x-access-token:${formats.githubClassic}@github.com/example/repo.git`;
    assert.deepEqual(await capture(link(url)), DROPPED);
    assert.deepEqual(spans(url), [formats.githubClassic]);
  });

  test("everyGitHubPrefixCounts", () => {
    for (const prefix of ["p", "o", "u", "s", "r"]) assert.equal(find(`gh${prefix}_${key(B62, 36)}`).length, 1, prefix);
    assert.equal(find(`gh${"x"}_${key(B62, 36)}`).length, 0);
  });

  test("gitLabsOtherLongLivedTokensCount", () => {
    for (const prefix of ["gldt-", "glrt-", "glptt-", "gloas-"]) assert.equal(find(prefix + key(B62, 24)).length, 1, prefix);
  });

  test("aRotatingSlackTokenIsFoundWhole", async () => {
    const token = `xoxe.${"xo"}xp-1-${key(B62, 40)}`;
    assert.deepEqual(spans(`(${token})`), [token]);
    assert.deepEqual(await capture(text(token)), DROPPED);
  });
});

describe("privateKeys", () => {
  for (const label of ["", "RSA ", "EC ", "DSA ", "OPENSSH ", "ENCRYPTED "]) {
    test(`${label.trim() || "PKCS8"}KeyIsDropped`, async () => {
      const { body, block } = privateKey(label);
      assert.deepEqual(await capture(text(block)), DROPPED);
      assert.deepEqual(spans(block), [`\n${body}\n`]);
    });
  }

  test("aPgpKeyBlockIsDropped", async () => {
    const header = "-----BEGIN PGP PRIVATE" + " KEY BLOCK-----";
    const body = `\nComment: synthetic\n\n${key(B64, 64)}\n${key(B64, 64)}\n=${chars(B62, 4)}\n`;
    const block = `${header}${body}-----END PGP PRIVATE KEY BLOCK-----`;
    assert.deepEqual(await capture(text(block)), DROPPED);
    assert.deepEqual(spans(block), [body]);
  });

  test("aKeyInTheMiddleOfATextIsDropped", async () => {
    const { body, block } = privateKey("OPENSSH ", 4);
    const message = `Here is the deploy key:\n\n${block}\n\nDelete it after use.`;
    assert.deepEqual(await capture(text(message)), DROPPED);
    assert.deepEqual(spans(message), [`\n${body}\n`]);
  });

  test("aKeyInsideAJsonStringIsDropped", async () => {
    const { body, block } = privateKey("", 3, "\\n");
    const json = `{"type": "service_account", "private_key": "${block}\\n", "client_email": "bot@example.iam"}`;
    assert.deepEqual(await capture(code(json)), DROPPED);
    assert.deepEqual(spans(json), [`\\n${body}\\n`]);
  });

  test("windowsLineEndsWork", async () => {
    const { body, block } = privateKey("EC ", 3, "\r\n");
    assert.deepEqual(await capture(text(block)), DROPPED);
    assert.deepEqual(spans(block), [`\r\n${body}\r\n`]);
  });

  test("aKeyCopiedWithoutItsEndLineIsDropped", async () => {
    const { header, body } = privateKey("RSA ", 4);
    const armor = `\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,${chars(HEX, 32).toUpperCase()}\n\n${body}`;
    const partial = `${header}${armor}\n\nthat was all I could copy`;
    assert.deepEqual(await capture(text(partial)), DROPPED);
    assert.deepEqual(spans(partial), [armor]);
  });

  test("aHeaderAloneIsKept", async () => {
    const header = "-----BEGIN RSA PRIVATE" + " KEY-----";
    assert.deepEqual(await capture(text(`A key file starts with ${header} and then base64.`)), KEPT);
    assert.deepEqual(await capture(text(`${header}\n-----END RSA PRIVATE KEY-----`)), KEPT);
  });

  test("publicKeysAndCertificatesAreKept", async () => {
    for (const label of ["PUBLIC KEY", "CERTIFICATE", "RSA PUBLIC KEY", "OPENSSH PUBLIC KEY"]) {
      const block = `-----BEGIN ${label}-----\n${key(B64, 64)}\n${key(B64, 64)}\n-----END ${label}-----`;
      assert.deepEqual(await capture(text(block)), KEPT, label);
    }
    assert.deepEqual(await capture(text(`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${key(B64, 43)} ada@example`)), KEPT);
  });
});

describe("aws", () => {
  test("aCredentialsFileIsDropped", async () => {
    const secret = awsSecret();
    const credentials = `[default]\naws_access_key_id = ${formats.awsAccessKey}\naws_secret_access_key = ${secret}\nregion = eu-central-1`;
    assert.deepEqual(await capture(text(credentials)), DROPPED);
    assert.deepEqual(spans(credentials), [formats.awsAccessKey, secret]);
  });

  test("theCommandLinesJsonIsDropped", async () => {
    const secret = awsSecret();
    const session = key(B64, 300);
    const output = JSON.stringify({ Credentials: { AccessKeyId: formats.awsSessionKey, SecretAccessKey: secret, SessionToken: session } }, null, 2);
    assert.deepEqual(await capture(code(output)), DROPPED);
    assert.deepEqual(spans(output), [formats.awsSessionKey, secret, session]);
  });

  test("anUnlabeledFortyCharacterStringIsKept", async () => {
    assert.deepEqual(await capture(text(awsSecret())), KEPT);
  });

  test("awsDocumentationSamplesAreKept", async () => {
    const sample = "AKIA" + "IOSFODNN7" + "EXAMPLE";
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCY" + "EXAMPLEKEY";
    assert.deepEqual(await capture(text(`aws_access_key_id = ${sample}\naws_secret_access_key = ${secret}`)), KEPT);
  });

  test("theAccessKeyIdNeedsItsLength", async () => {
    assert.deepEqual(await capture(text("AKIA is how AWS access key ids start, as in AKIA1234 or AKIAEXAMPLE.")), KEPT);
    assert.deepEqual(await capture(text(`AKIA${chars(B32, 15)}`)), KEPT);
    assert.deepEqual(await capture(text(`AKIA${chars(B32, 17)}`)), KEPT);
  });
});

describe("connectionStrings", () => {
  const password = key(B62, 18);
  const schemes = ["postgres", "postgresql", "mysql", "mariadb", "mongodb", "mongodb+srv", "redis", "rediss", "amqp", "amqps", "postgresql+psycopg2"];
  for (const scheme of schemes) {
    test(`${scheme}WithAPasswordIsDropped`, async () => {
      const address = `${scheme}://app:${password}@db.example.com:5432/app?sslmode=require`;
      assert.deepEqual(await capture(link(address)), DROPPED);
      assert.deepEqual(await capture(text(`DATABASE_URL=${address}`)), DROPPED);
      assert.deepEqual(spans(`DATABASE_URL=${address}`), [password]);
    });
  }

  test("redisWithoutAUserIsDropped", async () => {
    const address = `redis://:${password}@localhost:6379/0`;
    assert.deepEqual(await capture(text(address)), DROPPED);
    assert.deepEqual(spans(address), [password]);
  });

  test("anAtSignInThePasswordIsPartOfIt", () => {
    assert.deepEqual(spans(`postgres://app:pa@${password}@db.example.com/app`), [`pa@${password}`]);
  });

  test("addressesWithoutAPasswordAreKept", async () => {
    for (const address of [
      "postgres://localhost:5432/app", "postgres://app@db.example.com/app", "mongodb://db.example.com:27017",
      "mongodb+srv://<username>:<password>@cluster0.example.mongodb.net", "postgres://user:password@localhost/app",
      "mysql://root:${MYSQL_ROOT_PASSWORD}@db/app", "redis://default:%3Cpassword%3E@localhost:6379",
      "https://ada:hunter2@example.com/", "ftp://ada:hunter22@example.com/",
    ]) {
      assert.deepEqual(await capture(text(address)), KEPT, address);
    }
  });
});

describe("envFiles", () => {
  test("threeSecretsAndTwoHarmlessLines", async () => {
    const session = key(B62, 32);
    const dbPassword = key(B62, 14);
    const env = [
      "# Example app",
      "NODE_ENV=production",
      `STRIPE_SECRET_KEY=${formats.stripeLive}`,
      `SESSION_SECRET="${session}"`,
      `export DB_PASSWORD='${dbPassword}'`,
      "PORT=3000",
    ].join("\n");
    assert.deepEqual(await capture(text(env)), DROPPED);
    assert.deepEqual(await capture(code(env)), DROPPED);
    assert.deepEqual(spans(env), [formats.stripeLive, session, dbPassword]);
    assert.deepEqual(find(env).map((finding) => finding.kind), ["stripe", "env", "env"]);
  });

  test("theHarmlessLinesAloneAreKept", async () => {
    assert.deepEqual(await capture(text("# Example app\nNODE_ENV=production\nPORT=3000")), KEPT);
  });

  test("keyNamesThatSaySecret", () => {
    const value = key(B62, 24);
    for (const name of ["API_KEY", "OPENAI_API_KEY", "APIKEY", "GITHUB_TOKEN", "TOKEN", "CLIENT_SECRET", "JWT_SECRET",
      "DJANGO_SECRET_KEY", "SECRET_KEY_BASE", "AWS_SECRET_ACCESS_KEY", "PASSWORD", "SMTP_PASS", "GPG_PASSPHRASE",
      "password", "db_password", "SIGNING_KEY", "ENCRYPTION_KEY", "MASTER_KEY", "PRIVATE_KEY"]) {
      assert.deepEqual(spans(`${name}=${value}`), [value], name);
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
    assert.deepEqual(spans(`services:\n  app:\n    environment:\n      - API_KEY=${value}\n`), [value]);
    assert.deepEqual(spans(`export API_KEY=${value}`), [value]);
    assert.deepEqual(spans(`  API_KEY = "${value}"`), [value]);
  });

  test("theValueEndsBeforeAComment", () => {
    const value = key(B62, 24);
    assert.deepEqual(spans(`API_KEY=${value} # from the dashboard`), [value]);
    assert.deepEqual(spans(`ADMIN_PASSWORD="${value}"`), [value]);
  });

  test("placeholdersAndReferencesAreKept", async () => {
    const example = [
      "API_KEY=", "API_KEY=your-api-key-here", "API_KEY=<your key>", "API_KEY=${API_KEY}", "API_KEY=$OPENAI_KEY",
      "TOKEN=changeme", "DB_PASSWORD=password", "SECRET=xxxxxxxxxxxx", "API_KEY=sk-xxxxxxxxxxxxxxxx", "TOKEN=********",
      "SECRET_KEY={{ secret_key }}", "API_KEY=\"\"", "PASSWORD=hunt", "TOKEN=$(cat ~/.token)", "SECRET=%APP_SECRET%",
      "# API_KEY=commented-out-value",
    ].join("\n");
    assert.deepEqual(await capture(text(example)), KEPT);
  });

  test("codeIsKept", async () => {
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
      assert.deepEqual(await capture(code(snippet)), KEPT, snippet);
    }
  });
});

describe("twoFactorSeeds", () => {
  const seed = otpSeed(32);

  test("anOtpauthLinkIsDropped", async () => {
    const address = `otpauth://totp/Example:ada%40example.com?secret=${seed}&issuer=Example&period=30`;
    assert.deepEqual(await capture(link(address)), DROPPED);
    assert.deepEqual(await capture(text(address)), DROPPED);
    assert.deepEqual(spans(address), [seed]);
  });

  test("hotpAndASecretAtTheEndCount", () => {
    assert.deepEqual(spans(`otpauth://hotp/Example?counter=0&secret=${seed}`), [seed]);
  });

  test("aMigrationLinkIsDropped", async () => {
    const data = encodeURIComponent(btoa(chars(B64, 90)));
    assert.deepEqual(await capture(text(`otpauth-migration://offline?data=${data}`)), DROPPED);
    assert.deepEqual(spans(`otpauth-migration://offline?data=${data}`), [data]);
  });

  test("aLinkWithoutASeedIsKept", async () => {
    assert.deepEqual(await capture(text("otpauth://totp/Example:ada?issuer=Example")), KEPT);
    assert.deepEqual(await capture(text("Authenticator apps read otpauth:// links from QR codes.")), KEPT);
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
    test(`${name}ExportIsDropped`, async () => {
      for (const indent of [0, 2]) {
        const document = JSON.stringify(make(), null, indent);
        const seeds = [...document.matchAll(/[A-Z2-7]{16,}/g)].map((match) => match[0]);
        assert.ok(seeds.length > 0);
        assert.deepEqual(await capture(code(document)), DROPPED);
        // Every seed is found, and nothing else.
        assert.deepEqual(spans(document), seeds, name);
      }
    });
  }

  test("aSecretFieldWithoutAuthenticatorKeysIsKept", async () => {
    assert.deepEqual(await capture(code(JSON.stringify({ name: "build", secret: otpSeed(32) }))), KEPT);
    assert.deepEqual(await capture(code(JSON.stringify({ secret: "not base32 at all: 0189", issuer: "Example", digits: 6 }))), KEPT);
  });
});

describe("jsonWebTokens", () => {
  const token = jwt();

  test("keptWhileTheToggleIsOff", async () => {
    assert.equal(manifest.preferences.find((preference) => preference.id === "jwt").default, false);
    assert.deepEqual(await capture(text(token)), KEPT);
    assert.deepEqual(await capture(text(`Authorization: Bearer ${token}`)), KEPT);
  });

  test("droppedWhileItIsOn", async () => {
    assert.deepEqual(await capture(text(token), jwtHost), DROPPED);
    assert.deepEqual(await capture(text(`Authorization: Bearer ${token}`), jwtHost), DROPPED);
    assert.deepEqual(spans(`Authorization: Bearer ${token}`, true), [token]);
  });

  test("onlyAWellFormedHeaderCounts", async () => {
    const noAlg = jwt({ typ: "JWT" });
    const notJson = `eyJ${chars(B62, 20)}.${chars(B62, 30)}.${key(B62, 43)}`;
    assert.deepEqual(await capture(text(noAlg), jwtHost), KEPT);
    assert.deepEqual(await capture(text(notJson), jwtHost), KEPT);
  });

  test("otherSecretsStillCountWithTheToggleOn", async () => {
    assert.deepEqual(await capture(text(formats.npm), jwtHost), DROPPED);
  });
});

describe("inLongerTexts", () => {
  test("aSecretInAChatMessage", async () => {
    const message = `hey, can you try this key? ${formats.openaiProject} — it's the staging one, I'll rotate it tomorrow`;
    assert.deepEqual(await capture(text(message)), DROPPED);
    assert.deepEqual(spans(message), [formats.openaiProject]);
  });

  test("severalSecretsAreEachFound", async () => {
    const { githubClassic, npm, google, anthropic } = formats;
    const notes = `gh: ${githubClassic}\nnpm: ${npm}\nmaps: "${google}"\nclaude: ${anthropic}`;
    assert.deepEqual(await capture(text(notes)), DROPPED);
    assert.deepEqual(spans(notes), [githubClassic, npm, google, anthropic]);
  });

  test("aTokenInAnEnvLineCountsAsTheToken", () => {
    const line = `GITHUB_TOKEN=${formats.githubClassic}`;
    assert.deepEqual(find(line).map((finding) => finding.kind), ["github"]);
    assert.deepEqual(spans(line), [formats.githubClassic]);
  });

  test("aSecretPastTheFirst64KBIsDropped", async () => {
    const log = "build step ok\n".repeat(6000);
    // The app matches accepts.pattern against the first 64 KB only; a copy that long reaches the rule anyway.
    assert.ok(acceptsMatch(accepts, text(log.slice(0, 65536))));
    assert.deepEqual(await capture(text(`${log}${formats.githubClassic}\n`)), DROPPED);
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
    // How dashboards and other apps show a key without showing it.
    maskedByADashboard: [
      `sk_live_••••••••${chars(B62, 4)}`, `${"gh"}p_••••••••${chars(B62, 4)}`, "API_KEY=••••••••", "DB_PASSWORD='••••••••'",
      "postgres://app:••••••••@db/app", "otpauth://totp/Example?secret=••••••••", "{\"secret\": \"••••••••\", \"digits\": 6}",
      `${"-----BEGIN RSA PRIVATE"} KEY-----\n••••••••\n-----END RSA PRIVATE KEY-----`, "eyJ••••••••abcd",
    ].join("\n"),
  };

  for (const [name, value] of Object.entries(benign)) {
    test(`${name}IsKept`, async () => {
      for (const jwtOn of [false, true]) assert.deepEqual(find(value, jwtOn), [], name);
      assert.deepEqual(await capture(text(value)), KEPT);
      assert.deepEqual(await capture(code(value), jwtHost), KEPT);
    });
  }

  test("aJwtIsKeptByDefault", async () => {
    assert.deepEqual(await capture(text(jwt())), KEPT);
  });

  test("mostOrdinaryCopiesNeverReachTheRule", () => {
    for (const name of ["gitSha", "uuid", "sha256", "versions", "cssColors", "css", "timestamps", "phone", "turkishProse", "slackChannel"]) {
      assert.equal(acceptsMatch(accepts, text(benign[name])), false, name);
    }
  });
});

describe("theRule", () => {
  test("itOnlyEverDropsOrKeeps", async () => {
    // Never `replace`: the app would write a replaced copy to the clipboard, and the person's paste must always work.
    const inputs = [...Object.values(formats), privateKey("RSA ").block, `otpauth://totp/Example?secret=${otpSeed(32)}`, jwt(),
      "hello", formats.githubClassic.slice(0, 20)];
    for (const input of inputs) {
      for (const on of [host, jwtHost]) {
        for (const item of [text(input), code(input), link(input)]) {
          const result = await capture(item, on);
          assert.ok(result.ignore === true || result.keep === true, JSON.stringify(Object.keys(result)));
          assert.equal(result.replace, undefined);
        }
      }
    }
  });

  test("codeAndLinksAreCovered", async () => {
    assert.deepEqual(accepts.kinds, ["text", "code", "link"]);
    assert.deepEqual(await capture(code(`const key = "${formats.stripeLive}";`)), DROPPED);
  });

  test("emptyAndMissingTextIsKept", async () => {
    assert.deepEqual(await capture(text("")), KEPT);
    assert.deepEqual(await capture({ kind: "link", url: undefined, text: undefined }), KEPT);
  });

  test("aCopyOverTheLimitIsKept", async () => {
    const huge = `${formats.githubClassic}\n${"x".repeat(LIMIT)}`;
    assert.deepEqual(await capture(text(huge)), KEPT);
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
    const found = find(`${telegram} then ${githubClassic} and ${twilio}`);
    assert.deepEqual(found.map((finding) => finding.kind), ["telegram", "github", "twilio"]);
    for (let index = 1; index < found.length; index++) assert.ok(found[index - 1].end <= found[index].start);
  });

  test("placeholders", () => {
    for (const value of ["", "  ", "$X", "${X}", "<token>", "{{ x }}", "xxxxxx", "******", "your_key", "put-it-here", "changeme", "Example",
      "a•••b", "sk_live_…", "pa@${password}"]) {
      assert.equal(isPlaceholder(value), true, value);
    }
    for (const value of [key(B62, 12), "hunter22", "s3cr3t-Pa55"]) assert.equal(isPlaceholder(value), false, value);
  });
});

describe("nothingSecretLeaks", () => {
  test("theRuleLogsNothingAndCallsNothing", async () => {
    const on = createFakeHost({ folder, preferences: { jwt: true } });
    const input = [...Object.values(formats), privateKey("RSA ").block, `otpauth://totp/Example?secret=${otpSeed(32)}`,
      `postgres://app:${key(B62, 16)}@db/app`, jwt()].join("\n");
    // The result says only that the copy is not stored: it holds nothing of the copy.
    assert.deepEqual(await capture(text(input), on), DROPPED);
    assert.deepEqual(on.logs, []);
    assert.deepEqual(on.calls, []);
    assert.deepEqual(on.notifications, []);
  });

  test("findsCarryNoText", () => {
    const [finding] = find(formats.npm);
    assert.deepEqual(Object.keys(finding).sort(), ["end", "kind", "start"]);
  });
});

describe("manifest", () => {
  test("thePrefilterLetsEveryFormatThrough", () => {
    const seed = otpSeed(32);
    const samples = [
      ...Object.values(formats),
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
    assert.ok(acceptsMatch(accepts, link(formats.slackWebhook)));
  });

  test("onlyTheCapturePermission", () => {
    assert.deepEqual(manifest.permissions, ["capture"]);
    assert.equal(manifest.network, undefined);
    assert.equal(manifest.requires, undefined);
  });

  test("theRuleDoesNotAskForTags", () => {
    assert.equal(accepts.tags, undefined);
  });

  test("theJwtToggleIsTheOnlySetting", () => {
    assert.deepEqual(manifest.preferences, [{ id: "jwt", type: "toggle", title: "jwt.title", default: false }]);
  });

  test("turkishHasEveryKey", () => {
    const en = JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
    const tr = JSON.parse(fs.readFileSync(new URL("../locales/tr.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
    assert.equal(tr.name, "Sır Bekçisi");
  });
});
