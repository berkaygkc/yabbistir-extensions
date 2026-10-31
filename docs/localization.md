# Localization

yabbistir speaks English and Turkish, and an extension speaks the app's language through its locale files. Every extension ships English; other languages are welcome and optional.

## Locale files

`locales/<language>.json` is a flat JSON object from keys to strings. A `keywords` key holds a list of strings instead.

```json
{
  "name": "Slugify",
  "description": "Turns copied text into a URL slug.",
  "slugify.title": "Slugify",
  "slugify.keywords": ["slug", "slugify", "url"],
  "empty": "There is nothing to turn into a slug.",
  "count": "{n} slugs made"
}
```

- `locales/en.json` is required, and must hold every key the manifest uses.
- `defaultLocale` in the manifest is the fallback language; use `"en"`. Its file must hold every key the manifest uses too.
- Other languages may leave keys out: a missing string falls back to the default locale.
- Name keys after what they label: `slugify.title`, `slugify.keywords`, `download.fail`. Keys are never shown to anyone, unless one is missing everywhere.

A Turkish file for the same extension:

```json
{
  "name": "Slug",
  "description": "Kopyaladığın metni bir URL kısa adına çevirir.",
  "slugify.title": "Kısa ada çevir",
  "slugify.keywords": ["kısa ad", "slug", "url"],
  "empty": "Kısa ada çevrilecek bir şey yok."
}
```

## In the manifest

Every field a person reads holds a **key**, never the text: `name`, `description`, action `title`, `subtitle`, `keywords`, `verb` and `failTitle`, variant titles, detector `tag`, rule `title` and `description`, preference `title` and `confirm`, option `title`. The app looks each one up in the app's language.

## In code

`yab.t(key, args)` returns the string for `key` in the app's language, then in the default locale, then the key itself. `{name}` placeholders are filled from `args`; numbers and booleans become text.

```ts
import type { Actions } from "@yabbistir/api";

export const actions: Actions = {
  count: {
    run(item, ctx) {
      const words = (item?.text ?? "").split(/\s+/).filter(Boolean).length;
      const formatted = new Intl.NumberFormat(ctx.language).format(words);
      return { none: true, message: yab.t("count", { n: formatted }) };
    },
  },
};
```

- `ctx.language` and `yab.language` are the app's language, such as `"en"` or `"tr"`.
- Format numbers and dates with `Intl` and that language. `Intl` throws on a tag it does not know, so wrap it in `try` when the language comes from data.
- Keywords help people find the action in their own words; give each language its own, and add a few English ones to other languages, since people search in both.
- Write every message a person reads (results, notices, job progress, errors you throw) with `yab.t`.

## What the validator checks

- [`unknownLocaleKey`](errors.md#unknownlocalekey): a manifest key is missing from the default locale's file.
- [`enLocaleKeyMissing`](errors.md#enlocalekeymissing): a manifest key is missing from `locales/en.json`.
- [`enLocaleMissing`](errors.md#enlocalemissing): there is no `locales/en.json`.
- [`defaultLocaleMissing`](errors.md#defaultlocalemissing): there is no file for `defaultLocale`.
- [`localeUnreadable`](errors.md#localeunreadable): a locale file is not a JSON object. One broken file and the app reads no locale at all.

Keys used only in code (`yab.t("empty")`) are not checked: a test that runs the code in each language catches a missing one. The fake host reads the same files; `createFakeHost({ folder, context: { language: "tr" } })` answers in Turkish.
