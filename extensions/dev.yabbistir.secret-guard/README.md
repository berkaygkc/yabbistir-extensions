# Secret Guard

Keeps the API keys, tokens, private keys and other secrets you copy out of your yabbistir history.

Password managers mark what they copy as concealed, and yabbistir never stores those copies. A key copied from a terminal, a `.env` file or a web dashboard arrives unmarked, and without Secret Guard it stays in your history for months. Secret Guard looks at each new copy before it is stored and, when the copy is or contains a secret, never writes it to your history.

That is all it does. It never changes your clipboard: the copy still pastes normally this time, as often as you like until you copy something else. It is simply never written to history, so it is not there to find, search or paste later.

## Example

Copy `export GITHUB_TOKEN=ghp_…` from a terminal and paste it into another one: it pastes as usual, and it is not in your history.

Copy a whole `.env` file:

```sh
NODE_ENV=production
STRIPE_SECRET_KEY=sk_live_…
SESSION_SECRET="…"
PORT=3000
```

It pastes into your new project as usual. Your history never gets the file, harmless lines included: a copy that holds a secret is left out whole.

## What it catches

Only formats it can recognize with high confidence: a known prefix, a fixed length or shape, or a label that names the value.

- **GitHub** tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`) and **GitLab** tokens (`glpat-`, and the deploy, runner, trigger and OAuth tokens).
- **AWS** access key ids (`AKIA…`, `ASIA…`), and secret access keys and session tokens where a label names them: `aws_secret_access_key = …` in a credentials file, `"SecretAccessKey": "…"` in the command line's output.
- **Stripe** secret and restricted keys, live and test (`sk_live_`, `sk_test_`, `rk_live_`, `rk_test_`).
- **Slack** tokens (`xoxb-`, `xoxp-`, `xapp-` and the others) and webhook addresses (`hooks.slack.com/services/…`).
- **Google** API keys (`AIza…`), **OpenAI** keys (`sk-proj-…`, `sk-svcacct-…`, `sk-admin-…` and the older `sk-` keys of 48 characters), **Anthropic** keys (`sk-ant-…`).
- **npm** (`npm_…`), **PyPI** (`pypi-…`), **SendGrid** (`SG.….…`) and **Twilio** API keys (`SK` and 32 hexadecimal digits).
- **Discord** bot tokens, checked by the bot id they start with, and **Telegram** bot tokens.
- **Private keys**: `-----BEGIN … PRIVATE KEY-----` blocks of every kind (RSA, EC, DSA, OpenSSH, PKCS #8, encrypted, PGP), also inside a JSON file such as a service account key, and also when the END line was not copied.
- **Database and queue addresses** with a password: `postgres://`, `postgresql://`, `mysql://`, `mariadb://`, `mongodb://`, `mongodb+srv://`, `redis://`, `rediss://`, `amqp://`, `amqps://`. An address without a password is kept.
- **`.env` lines** whose name says secret (`…_SECRET`, `…_TOKEN`, `…_API_KEY`, `…_PASSWORD`, `…_PASS`, `…_PASSPHRASE`, `SECRET_KEY`, `PRIVATE_KEY` and a few more) and that hold a value, as in `.env` files, `export` lines and Docker Compose `environment` lists.
- **Two-factor seeds**: `otpauth://` and `otpauth-migration://` addresses, and authenticator exports in JSON (Aegis, 2FAS, LastPass Authenticator, andOTP, Bitwarden), where each seed sits next to an issuer, digits, a period or an algorithm. People paste such exports into the Authenticator extension's settings, so they pass through the clipboard.
- **JSON Web Tokens**, only when you turn them on. The JWT extension shows what is inside a token, and many people want to keep them, so they are kept by default.

## What it leaves alone

- Hashes, git commit ids, UUIDs, base64 data and images, and ordinary links, however long and random they look.
- Prefixes in prose, such as "tokens start with `ghp_`" or `sk-learn`, and anything too short or too long for its format.
- Placeholders and references: `API_KEY=your-api-key-here`, `TOKEN=changeme`, `PASSWORD=${DB_PASSWORD}`, `mongodb+srv://<username>:<password>@…`, `sk-xxxxxxxx`.
- Code that names a secret without holding one: `token = get_token()`, `api_key=settings.API_KEY`, `password = os.environ["DB_PASSWORD"]`.
- Public keys, certificates, and the sample keys in AWS's documentation, which end with `EXAMPLE`.
- Keys shown masked, as dashboards show them: `sk_live_••••a1b2`.

## Settings

- **Treat JSON Web Tokens as secrets**: off by default.

You can turn the rule off in Settings → Extensions, as any capture rule.

## Setup

Install Secret Guard from the Store in Settings → Extensions and allow its one permission. It works from the next copy on. Copies already in your history stay there: delete them by hand.

## Permissions and privacy

- **capture**, which you read as "Can see everything you copy": the rule has to see a copy before it is stored to keep a secret out. It is the only permission Secret Guard asks for.

Secret Guard sees your copies but has no way to send them anywhere. It has no network or program permission, and yabbistir runs capture rules without effects: a rule that tried to reach the network, run a program, read your history or show a notice would be refused. It writes nothing to disk or to its own storage, logs nothing, and returns only its decision: keep the copy, or do not store it. The whole extension is one short file, [src/index.ts](src/index.ts), that you can read in a few minutes.

## Limits

- **It works silently.** A capture rule cannot show a notice, so nothing tells you a copy was left out of your history. If a copy is missing that you expected, it held something that looked like a secret.
- **Only known formats.** A password typed into a chat message, or a key with no known prefix and no label, is not recognized. Secret Guard would rather keep a copy than drop one by mistake.
- **Text and links only.** A screenshot of a key, or a key file copied in Finder, is not text, and no rule sees it.
- **Very long copies.** yabbistir decides whether a rule runs from the first 64 KB of a copy; a copy longer than that always goes to Secret Guard, which reads all of it. Copies over 256 KB meet no rule and are stored as they are.
- **The whole copy goes.** A long message or file with one secret in it is left out of your history whole; Secret Guard never stores a cleaned version, since yabbistir would also put that version on your clipboard.
