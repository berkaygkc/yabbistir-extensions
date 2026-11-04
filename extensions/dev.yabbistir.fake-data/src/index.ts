import type { Actions } from "@yabbistir/api";

import type { Locale } from "./data.ts";
import {
  address, birthDate, cardNumber, city, company, email, fullName, iban, jobTitle, paragraph, person, phone, sentence, tckn,
  userJson, username, vkn,
} from "./generators.ts";

/** "tr-TR" is "tr". */
function baseLanguage(code: string | undefined): string {
  return (code ?? "").split(/[-_]/)[0].toLowerCase();
}

/** The person's choice in Settings; "auto" (or anything unknown) follows the app's language. */
export function localeFor(preference: unknown, language: string | undefined): Locale {
  if (preference === "tr" || preference === "en") return preference;
  return baseLanguage(language) === "tr" ? "tr" : "en";
}

type Make = (locale: Locale) => string;

const people: Record<string, Make> = {
  fullName: (locale) => fullName(person(locale)),
  firstName: (locale) => person(locale).first,
  lastName: (locale) => person(locale).last,
  username: (locale) => username(person(locale)),
  birthDate: () => birthDate(new Date()),
};
const contacts: Record<string, Make> = {
  email: (locale) => email(person(locale)),
  phone,
  address: (locale) => address(locale).text,
  city,
};
const work: Record<string, Make> = { company, jobTitle };
const numbers: Record<string, Make> = {
  tckn: () => tckn(),
  vkn: () => vkn(),
  iban: () => iban(),
  visa: () => cardNumber("visa"),
  mastercard: () => cardNumber("mastercard"),
  amex: () => cardNumber("amex"),
};
const lorem: Record<string, Make> = { sentence: () => sentence(), paragraph: () => paragraph() };

/** An action over a table of generators; an unknown or missing variant falls back to the first. */
function generator(table: Record<string, Make>): Actions[string] {
  const first = Object.keys(table)[0];
  return {
    run(_item, ctx) {
      const make = table[ctx.variant ?? ""] ?? table[first];
      const locale = localeFor((ctx.preferences as Record<string, unknown> | undefined)?.locale, ctx.language);
      return { text: make(locale) };
    },
  };
}

export const actions: Actions = {
  person: generator(people),
  contact: generator(contacts),
  work: generator(work),
  numbers: generator(numbers),
  lorem: generator(lorem),
  user: {
    run(_item, ctx) {
      const locale = localeFor((ctx.preferences as Record<string, unknown> | undefined)?.locale, ctx.language);
      return { text: userJson(locale, new Date()) };
    },
  },
};
