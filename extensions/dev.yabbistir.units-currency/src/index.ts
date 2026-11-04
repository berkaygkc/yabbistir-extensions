import type { Actions, Context, Detectors, Item, PreviewSection, Result } from "@yabbistir/api";

import {
  cachedRates, convertMoney, extraCodes, formatMoney, loadRates, parseMoney, targetsFor,
} from "./currency.ts";
import {
  conversionsOf, formatNumber, formatQuantity, parseQuantity, usesDecimalComma,
} from "./units.ts";

export { limits } from "./currency.ts";

const textOf = (item: Item | null): string => (item?.text ?? "").trim();

// ---- Detectors -----------------------------------------------------------------------------------------------

export const detectors: Detectors = {
  unit: {
    validate: (item) => parseQuantity(textOf(item)) !== null,
    preview(item, ctx): PreviewSection[] {
      const quantity = parseQuantity(textOf(item), usesDecimalComma(ctx.language));
      if (!quantity) return [];
      const own = quantity.display ?? formatQuantity(quantity.value, quantity.unit, ctx.language);
      return [{
        type: "keyValue",
        title: own,
        rows: conversionsOf(quantity).map(({ unit, value }) => [unit.label, formatNumber(value, ctx.language)]),
      }];
    },
  },
  currency: {
    validate: (item) => parseMoney(textOf(item)) !== null,
    preview(item, ctx): PreviewSection[] {
      const money = parseMoney(textOf(item), usesDecimalComma(ctx.language));
      if (!money) return [];
      const cache = cachedRates();
      if (!cache || cache.rates[money.code] === undefined) {
        return [{ type: "text", title: yab.t("preview.rates"), text: yab.t("preview.noRates") }];
      }
      const rows: [string, string][] = [];
      for (const code of targetsFor(money.code, extraCodes(ctx.preferences.moreCurrencies)).slice(0, 8)) {
        const converted = convertMoney(money.amount, money.code, code, cache.rates);
        if (converted !== null) rows.push([code, formatMoney(converted, code, ctx.language)]);
      }
      if (rows.length === 0) return [];
      return [
        { type: "keyValue", title: formatMoney(money.amount, money.code, ctx.language), rows },
        { type: "text", title: yab.t("preview.rates"), text: yab.t("preview.source", { date: cache.date }) },
      ];
    },
  },
};

// ---- Actions -------------------------------------------------------------------------------------------------

function notice(message: string): void {
  try {
    yab.notify(message);
  } catch {
    // A dropped notice must not fail the conversion.
  }
}

type Outcome = { lines: string[] } | { result: Result };

async function currencyLines(item: Item | null, ctx: Context, targets: (source: string) => string[]): Promise<Outcome> {
  const money = parseMoney(textOf(item), usesDecimalComma(ctx.language));
  if (!money) return { result: { none: true, message: yab.t("notMoney") } };
  const wanted = targets(money.code);
  if (wanted.length === 0) return { result: { none: true, message: yab.t("sameCurrency") } };
  const loaded = await loadRates(ctx.signal);
  if (!loaded) return { result: { none: true, message: yab.t("offline") } };
  if (loaded.rates[money.code] === undefined) return { result: { none: true, message: yab.t("noRate", { code: money.code }) } };
  const lines: string[] = [];
  for (const code of wanted) {
    const converted = convertMoney(money.amount, money.code, code, loaded.rates);
    if (converted !== null) lines.push(formatMoney(converted, code, ctx.language));
  }
  if (lines.length === 0) return { result: { none: true, message: yab.t("sameCurrency") } };
  notice(yab.t(loaded.stale ? "rateStale" : "rateDate", { date: loaded.date }));
  return { lines };
}

export const actions: Actions = {
  convertUnit: {
    run(item, ctx) {
      const quantity = parseQuantity(textOf(item), usesDecimalComma(ctx.language));
      if (!quantity) return { none: true, message: yab.t("notUnit") };
      const [main] = conversionsOf(quantity);
      if (!main) return { none: true, message: yab.t("notUnit") };
      return { text: formatQuantity(main.value, main.unit, ctx.language) };
    },
  },
  convertUnitAll: {
    run(item, ctx) {
      const quantity = parseQuantity(textOf(item), usesDecimalComma(ctx.language));
      if (!quantity) return { none: true, message: yab.t("notUnit") };
      const lines = conversionsOf(quantity).map(({ unit, value }) => formatQuantity(value, unit, ctx.language));
      return lines.length === 0 ? { none: true, message: yab.t("notUnit") } : { text: lines.join("\n") };
    },
  },
  convertCurrency: {
    async run(item, ctx) {
      const target = (ctx.variant ?? "").toUpperCase();
      const result = await currencyLines(item, ctx, (source) => (target !== "" && target !== source ? [target] : []));
      if ("result" in result) return result.result;
      return { text: result.lines[0] };
    },
  },
  convertCurrencyAll: {
    async run(item, ctx) {
      const extras = extraCodes(ctx.preferences.moreCurrencies);
      const result = await currencyLines(item, ctx, (source) => targetsFor(source, extras));
      if ("result" in result) return result.result;
      return { text: result.lines.join("\n") };
    },
  },
};
