# Recipe: call an API with a key

An action that sends the selected word to a web service and pastes the answer, with the person's API key kept in the Keychain. The service here, `api.example.com`, stands in for yours: it answers `GET /v1/define?word=<word>` with `{ "word": …, "definition": … }`, and wants the key as a bearer token.

It shows: the `network` permission held to one host, a `secret` preference, `yab.http.fetch`, and turning a service's answers into results and messages.

```sh
npm run new -- dev.yourname.define --template action
```

Replace the template's files with these, and delete `locales/tr.json` (or translate the keys).

## manifest.json

```json file=manifest.json
{
  "id": "dev.yourname.define",
  "version": "1.0.0",
  "apiVersion": 1,
  "defaultLocale": "en",
  "name": "name",
  "description": "description",
  "icon": "sf:character.book.closed",
  "author": "your-github-name",
  "license": "MIT",
  "categories": ["text"],
  "permissions": ["network"],
  "network": { "domains": ["api.example.com"] },
  "preferences": [
    { "id": "apiKey", "type": "secret", "title": "apiKey.title" }
  ],
  "contributes": {
    "actions": [
      { "id": "define", "title": "define.title", "keywords": "define.keywords", "input": "item",
        "accepts": { "kinds": ["text"], "pattern": "^[\\p{L}'-]{2,40}$" }, "output": "text" }
    ]
  }
}
```

- `network.domains` names the one host. The person reads "Can reach: api.example.com", and any other host is refused.
- The `secret` preference appears in Settings as a field the person pastes the key into. It is kept in the Keychain, never in `yab.preferences`, and has no default.
- The pattern offers the action only on a single word.
- No `hint`: hints run without effects, and a request is an effect. The action runs when the person picks it.

## locales/en.json

```json file=locales/en.json
{
  "name": "Define",
  "description": "Looks up the copied word in a dictionary service.",
  "apiKey.title": "API key",
  "define.title": "Define word",
  "define.keywords": ["define", "definition", "dictionary", "meaning"],
  "noKey": "Add your API key in Settings → Extensions → Define.",
  "badKey": "The service did not accept the API key. Check it in Settings.",
  "notFound": "No definition found for “{word}”.",
  "serviceFailed": "The dictionary service did not answer (status {status}). Try again later."
}
```

## src/index.ts

```ts file=src/index.ts
import type { Actions } from "@yabbistir/api";

const endpoint = "https://api.example.com/v1/define";

export const actions: Actions = {
  define: {
    async run(item, ctx) {
      const word = (item?.text ?? "").trim();
      const key = yab.secrets.get("apiKey");
      if (key === null || key === "") return { none: true, message: yab.t("noKey") };

      // No connection rejects with "networkError", which the app reports itself: let it through.
      const response = await yab.http.fetch(`${endpoint}?word=${encodeURIComponent(word)}`, {
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
        signal: ctx.signal,
      });
      if (response.status === 401 || response.status === 403) return { none: true, message: yab.t("badKey") };
      if (response.status === 404) return { none: true, message: yab.t("notFound", { word }) };

      let definition: unknown;
      try {
        definition = (JSON.parse(response.text ?? "") as { definition?: unknown }).definition;
      } catch {
        definition = undefined;
      }
      if (response.status !== 200 || typeof definition !== "string") {
        return { none: true, message: yab.t("serviceFailed", { status: response.status }) };
      }
      return { text: definition.trim() };
    },
  },
};
```

- The key is read with `yab.secrets.get` when needed, sent only to its own service, and never logged or returned.
- A service that is down is not the extension's failure, so the code answers with a message (`{ none: true, message }`) instead of throwing. In an action, thrown errors count toward turning the extension off ([errors](../errors.md#turned-off-after-repeated-errors)).
- `yab.http.fetch` gives the body as `text` and lowercases header names. The web `fetch` works too, held to the same rules.

## tests/index.test.mjs

```js file=tests/index.test.mjs
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import { actions } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const word = (text) => ({ kind: "text", text });

/** The service: one known word, and the key checked. */
function service({ url, headers }) {
  if (headers.authorization !== "Bearer test-key") return { status: 401, text: "" };
  if (url === "https://api.example.com/v1/define?word=serendipity") {
    return { json: { word: "serendipity", definition: "Finding something good without looking for it." } };
  }
  return { status: 404, text: "" };
}

describe("define", () => {
  test("looksUpTheWordWithTheKey", async () => {
    const host = createFakeHost({ folder, secrets: { apiKey: "test-key" }, http: service });
    assert.deepEqual(await host.run(actions.define, word("serendipity")), { text: "Finding something good without looking for it." });
  });

  test("saysWhenTheWordIsUnknown", async () => {
    const host = createFakeHost({ folder, secrets: { apiKey: "test-key" }, http: service });
    assert.deepEqual(await host.run(actions.define, word("zzzz")), { none: true, message: "No definition found for “zzzz”." });
  });

  test("asksForTheKeyBeforeAnyRequest", async () => {
    const host = createFakeHost({ folder, http: service });
    const result = await host.run(actions.define, word("serendipity"));
    assert.equal(result.message, "Add your API key in Settings → Extensions → Define.");
    assert.ok(!host.calls.some((call) => call.api === "http.fetch"));
  });

  test("explainsARejectedKey", async () => {
    const host = createFakeHost({ folder, secrets: { apiKey: "wrong" }, http: service });
    assert.equal((await host.run(actions.define, word("serendipity"))).message, "The service did not accept the API key. Check it in Settings.");
  });

  test("aServerErrorIsAMessageNotAFailure", async () => {
    const host = createFakeHost({ folder, secrets: { apiKey: "test-key" }, http: () => ({ status: 503, text: "busy" }) });
    assert.deepEqual(await host.run(actions.define, word("serendipity")),
      { none: true, message: "The dictionary service did not answer (status 503). Try again later." });
  });

  test("noConnectionIsLetThrough", async () => {
    const host = createFakeHost({ folder, secrets: { apiKey: "test-key" }, http: () => yabError("networkError", "offline") });
    await assert.rejects(host.run(actions.define, word("serendipity")), { code: "networkError" });
  });

  test("neverRunsAsAHint", async () => {
    const host = createFakeHost({ folder, secrets: { apiKey: "test-key" }, http: service });
    await assert.rejects(host.hint(actions.define, word("serendipity")), { code: "permissionDenied" });
  });
});
```

## Try it

```sh
npm test -- dev.yourname.define
npm run validate -- dev.yourname.define
npm run dev -- dev.yourname.define
```

Point `endpoint` and `network.domains` at your real service first. In yabbistir, approve the permission and paste your key in Settings → Extensions → Define. The README must say what is sent where: the selected word, to your service, when the person runs the action.
