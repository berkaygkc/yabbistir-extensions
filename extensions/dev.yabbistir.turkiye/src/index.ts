import type { Action, Actions, Detectors, Item, PreviewSection } from "@yabbistir/api";

import { bankName } from "./banks.ts";
import { grouped, parseIban, turkishBankCode } from "./iban.ts";
import { isTCKN, isVKN } from "./ids.ts";
import { areaCodes, domestic, e164, international, parsePhone } from "./phone.ts";
import type { Phone } from "./phone.ts";
import { carriers, trackingCode } from "./tracking.ts";

const textOf = (item: Item | null) => (item?.text ?? "").trim();

function countryName(code: string, language: string): string {
  try {
    return new Intl.DisplayNames([language], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function areaName(phone: Phone): string | null {
  if (phone.kind !== "landline") return null;
  const area = areaCodes[phone.national.slice(0, 3)];
  return "key" in area ? yab.t(area.key) : area.name;
}

/** A number check's preview: that it is valid, by which rule, and what was not checked. Nothing about whose it is. */
function checkSection(title: string, rule: string, note: string): PreviewSection[] {
  return [{
    type: "keyValue",
    title: yab.t(title),
    rows: [[yab.t("row.check"), yab.t("valid")], [yab.t("row.rule"), yab.t(rule)], ["", yab.t(note)]],
  }];
}

export const detectors: Detectors = {
  iban: {
    validate: (item) => parseIban(textOf(item)) !== null,
    preview(item, ctx): PreviewSection[] {
      const iban = parseIban(textOf(item));
      if (iban === null) return [];
      const rows: [string, string][] = [
        [yab.t("row.iban"), grouped(iban.compact)],
        [yab.t("row.country"), countryName(iban.country, ctx.language)],
      ];
      const code = turkishBankCode(iban);
      if (code !== null) {
        const name = bankName(code);
        if (name !== null) rows.push([yab.t("row.bank"), name]);
        rows.push([yab.t("row.bankCode"), code]);
      }
      rows.push([yab.t("row.check"), yab.t("check.iban")]);
      return [{ type: "keyValue", title: yab.t("preview.iban"), rows }];
    },
  },
  tckn: {
    validate: (item) => isTCKN(textOf(item)),
    preview: (item) => (isTCKN(textOf(item)) ? checkSection("preview.tckn", "rule.tckn", "note.tckn") : []),
  },
  vkn: {
    validate: (item) => isVKN(textOf(item)),
    preview: (item) => (isVKN(textOf(item)) ? checkSection("preview.vkn", "rule.vkn", "note.vkn") : []),
  },
  phone: {
    validate: (item) => parsePhone(textOf(item)) !== null,
    preview(item): PreviewSection[] {
      const phone = parsePhone(textOf(item));
      if (phone === null) return [];
      const rows: [string, string][] = [[yab.t("row.type"), yab.t(`type.${phone.kind}`)]];
      const area = areaName(phone);
      if (area !== null) rows.push([yab.t("row.area"), area]);
      rows.push([yab.t("row.international"), international(phone)]);
      return [{ type: "keyValue", title: yab.t("preview.phone"), rows }];
    },
  },
};

function ibanAction(format: (compact: string) => string): Action {
  return {
    run(item) {
      const iban = parseIban(textOf(item));
      if (iban === null) return { none: true, message: yab.t("notIban") };
      return { text: format(iban.compact) };
    },
  };
}

function phoneAction(format: (phone: Phone) => string): Action {
  return {
    run(item) {
      const phone = parsePhone(textOf(item));
      if (phone === null) return { none: true, message: yab.t("notPhone") };
      return { text: format(phone) };
    },
  };
}

export const actions: Actions = {
  ibanSpaced: ibanAction(grouped),
  ibanCompact: ibanAction((compact) => compact),
  phoneInternational: phoneAction(international),
  phoneNational: phoneAction(domestic),
  phoneE164: phoneAction(e164),
  track: {
    run(item, ctx) {
      const code = trackingCode(textOf(item));
      if (code === null) return { none: true, message: yab.t("notTracking") };
      const carrier = ctx.variant !== null && Object.hasOwn(carriers, ctx.variant) ? carriers[ctx.variant] : null;
      if (carrier === null) return { none: true, message: yab.t("noCarrier") };
      if (carrier.takes !== undefined && !carrier.takes(code)) return { none: true, message: yab.t(carrier.refused ?? "notTracking") };
      // The number goes to the carrier the person picked, and nowhere else; the browser opening is the answer.
      yab.open(carrier.url(code, ctx.language === "tr"));
      return { none: true };
    },
  },
};
