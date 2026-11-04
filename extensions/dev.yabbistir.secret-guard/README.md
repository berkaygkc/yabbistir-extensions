# Secret Guard

Keeps the API keys, tokens, private keys and other secrets you copy out of your yabbistir history.

Password managers mark what they copy as concealed, and yabbistir never stores those copies. A key copied from a terminal, a `.env` file or a web dashboard arrives unmarked, and without Secret Guard it stays in your history for months. Secret Guard looks at each new copy before it is stored and, when the copy is or contains a secret, leaves it out of the history.

Your clipboard is left alone: the paste you are about to make still works. Only the history never keeps the secret.

## Example

Copy `export GITHUB_TOKEN=ghp_…` from a terminal and paste it into another one: it pastes as usual, and it is not in your history.

Copy a whole `.env` file:

```sh
NODE_ENV=production
STRIPE_SECRET_KEY=sk_live_…
SESSION_SECRET="…"
PORT=3000
```

By default nothing of it is stored. With **Keep it masked** (see [Settings](#settings)), history keeps the file with every secret masked, and the rest as it was:

```sh
NODE_ENV=production
STRIPE_SECRET_KEY=sk_live_••••••••a1b2
SESSION_SECRET="••••••••c3d4"
PORT=3000
```

A mask keeps a short prefix that says what the secret was (`ghp_`, `sk_live_`, `AKIA`) and, for a token, its last four characters, which is how most dashboards list keys. Passwords, two-factor seeds and private keys never show their last four.

## What it catches

Only formats it can recognize with high confidence: a known prefix, a fixed length or shape, or a label that names the value.

- **GitHub** tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`) and **GitLab** tokens (`glpat-`, and the deploy, runner, trigger and OAuth tokens).
- **AWS** access key ids (`AKIA…`, `ASIA…`), and secret access keys and session tokens where a label names them: `aws_secret_access_key = …` in a credentials file, `"SecretAccessKey": "…"` in the command line's output.
- **Stripe** secret and restricted keys, live and test (`sk_live_`, `sk_test_`, `rk_live_`, `rk_test_`).
- **Slack** tokens (`xoxb-`, `xoxp-`, `xapp-` and the others) and webhook addresses (`hooks.slack.com/services/…`).
- **Google** API keys (`AIza…`), **OpenAI** keys (`sk-proj-…`, `sk-svcacct-…`, `sk-admin-…` and the older `sk-` keys of 48 characters), **Anthropic** keys (`sk-ant-…`).
- **npm** (`npm_…`), **PyPI** (`pypi-…`), **SendGrid** (`SG.….…`) and **Twilio** API keys (`SK` and 32 hexadecimal digits).
- **Discord** bot tokens, checked by the bot id they start with, and **Telegram** bot tokens.
- **Private keys**: `-----BEGIN … PRIVATE KEY-----` blocks of every kind (RSA, EC, DSA, OpenSSH, PKCS #8, encrypted, PGP), also inside a JSON file such as a service account key, and also when the END line was not copied. The BEGIN and END lines stay in a masked copy, so you can still see what kind of key it was.
- **Database and queue addresses** with a password: `postgres://`, `postgresql://`, `mysql://`, `mariadb://`, `mongodb://`, `mongodb+srv://`, `redis://`, `rediss://`, `amqp://`, `amqps://`. Only the password is masked; the user and the host stay.
- **`.env` lines** whose name says secret (`…_SECRET`, `…_TOKEN`, `…_API_KEY`, `…_PASSWORD`, `…_PASS`, `…_PASSPHRASE`, `SECRET_KEY`, `PRIVATE_KEY` and a few more), as in `.env` files, `export` lines and Docker Compose `environment` lists. Only the value is masked.
- **Two-factor seeds**: `otpauth://` and `otpauth-migration://` addresses, and authenticator exports in JSON (Aegis, 2FAS, LastPass Authenticator, andOTP, Bitwarden), where each seed sits next to an issuer, digits, a period or an algorithm. People paste such exports into the Authenticator extension's settings, so they pass through the clipboard.
- **JSON Web Tokens**, only when you turn them on. The JWT extension shows what is inside a token, and many people want to keep them, so they are kept by default.

## What it leaves alone

- Hashes, git commit ids, UUIDs, base64 data and images, and ordinary links, however long and random they look.
- Prefixes in prose, such as "tokens start with `ghp_`" or `sk-learn`, and anything too short or too long for its format.
- Placeholders and references: `API_KEY=your-api-key-here`, `TOKEN=changeme`, `PASSWORD=${DB_PASSWORD}`, `mongodb+srv://<username>:<password>@…`, `sk-xxxxxxxx`.
- Code that names a secret without holding one: `token = get_token()`, `api_key=settings.API_KEY`, `password = os.environ["DB_PASSWORD"]`.
- Public keys, certificates, and the sample keys in AWS's documentation, which end with `EXAMPLE`.

## Settings

- **When a copy holds a secret**: *Don’t keep it* (the default) or *Keep it masked*. A masked copy also takes the secret’s place on your clipboard (yabbistir does that with every copy a rule changes), so ⌘V then pastes the mask, not the secret. yabbistir asks you to confirm before it turns masking on. Choose it if you would rather see in your history that you copied a secret than be able to paste the secret.
- **Treat JSON Web Tokens as secrets**: off by default.

You can turn the rule off in Settings → Extensions, as any capture rule.

## Setup

Install Secret Guard from the Store in Settings → Extensions and allow its one permission. It works from the next copy on. Copies already in your history stay there: delete them by hand.

## Permissions and privacy

- **capture**, which you read as "Can see everything you copy": the rule has to see a copy before it is stored to keep a secret out. It is the only permission Secret Guard asks for.

Secret Guard sees your copies but has no way to send them anywhere. It has no network or program permission, and yabbistir runs capture rules without effects: a rule that tried to reach the network, run a program, read your history or show a notice would be refused. It writes nothing to disk or to its own storage, logs nothing, and returns only its decision, or the masked copy. The whole extension is one short file, [src/index.ts](src/index.ts), that you can read in a few minutes.

## Limits

- **It works silently.** A capture rule cannot show a notice, so nothing tells you a copy was left out of your history. If a copy is missing that you expected, it held something that looked like a secret.
- **Only known formats.** A password typed into a chat message, or a key with no known prefix and no label, is not recognized. Secret Guard would rather keep a copy than drop one by mistake.
- **Text and links only.** A screenshot of a key, or a key file copied in Finder, is not text, and no rule sees it.
- **Very long copies.** yabbistir decides whether a rule runs from the first 64 KB of a copy; a copy longer than that always goes to Secret Guard, which reads all of it. Copies over 256 KB meet no rule and are stored as they are.
- **Masking changes the clipboard too**, as described under [Settings](#settings).
