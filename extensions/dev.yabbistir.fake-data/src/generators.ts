import {
  type Locale, companyParts, emailDomains, firstNames, jobTitles, lastNames, loremWords, places, streetNames, streetSuffixes,
  testCards, trBankCodes, trMobilePrefixes, usAreaCodes,
} from "./data.ts";
import { between, digits, int, pick, uuid } from "./random.ts";

const turkishFold: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", İ: "i", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };

/** Lower-case ASCII letters and digits only: "Şükrü" is "sukru". */
export function fold(text: string): string {
  return text
    .replace(/[çğıöşüİÇĞÖŞÜ]/g, (letter) => turkishFold[letter] ?? letter)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface Person {
  first: string;
  last: string;
}

export function person(locale: Locale): Person {
  return { first: pick(firstNames[locale]), last: pick(lastNames[locale]) };
}

export function fullName(who: Person): string {
  return `${who.first} ${who.last}`;
}

export function email(who: Person): string {
  const separator = pick([".", "_", ""]);
  const number = int(3) === 0 ? String(between(1, 99)) : "";
  return `${fold(who.first)}${separator}${fold(who.last)}${number}@${pick(emailDomains)}`;
}

export function username(who: Person): string {
  const separator = pick([".", "_", "-"]);
  const number = int(2) === 0 ? String(between(1, 999)) : "";
  const name = int(2) === 0 ? `${fold(who.first)}${separator}${fold(who.last)}` : `${fold(who.first)[0]}${fold(who.last)}`;
  return `${name}${number}`;
}

export function phone(locale: Locale): string {
  if (locale === "tr") {
    const rest = digits(7).join("");
    return `+90 ${pick(trMobilePrefixes)} ${rest.slice(0, 3)} ${rest.slice(3, 5)} ${rest.slice(5)}`;
  }
  // 555-0100 to 555-0199 is the range reserved for fiction in the North American numbering plan.
  return `+1 (${pick(usAreaCodes)}) 555-01${String(int(100)).padStart(2, "0")}`;
}

export interface Address {
  street: string;
  city: string;
  text: string;
}

export function address(locale: Locale): Address {
  const place = pick(places[locale]);
  const name = pick(streetNames[locale]);
  const suffix = pick(streetSuffixes[locale]);
  if (locale === "tr") {
    const district = pick(place.areas);
    const street = `${name} ${suffix} No: ${between(1, 120)}/${between(1, 24)}`;
    const code = String(between(1, 81)).padStart(2, "0") + String(between(100, 999));
    return { street, city: place.city, text: `${street}, ${district}/${place.city} ${code}` };
  }
  const street = `${between(100, 9899)} ${name} ${suffix}`;
  const zip = String(between(10000, 99899));
  return { street, city: place.city, text: `${street}, ${place.city}, ${place.areas[0]} ${zip}` };
}

export function city(locale: Locale): string {
  return pick(places[locale]).city;
}

export function company(locale: Locale): string {
  const [firsts, seconds, forms] = companyParts[locale];
  return `${pick(firsts)} ${pick(seconds)} ${pick(forms)}`;
}

export function jobTitle(locale: Locale): string {
  return pick(jobTitles[locale]);
}

const day = 86_400_000;

/** An adult's birth date (18 to 80 years old today) as `YYYY-MM-DD`. */
export function birthDate(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  // One day inside the 18-year line, so that a 29 February that rolls over to 1 March is still adult.
  const latest = Date.UTC(year - 18, month, date) - day;
  const earliest = Date.UTC(year - 80, month, date);
  const span = Math.floor((latest - earliest) / day);
  return new Date(earliest + int(span + 1) * day).toISOString().slice(0, 10);
}

/** A Turkish national identity number with a valid check: 11 digits, the first not 0. */
export function tckn(): string {
  const d = [between(1, 9), ...digits(8)];
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  d.push((((odd * 7 - even) % 10) + 10) % 10);
  d.push(d.reduce((sum, digit) => sum + digit, 0) % 10);
  return d.join("");
}

/** A Turkish tax number (VKN): 10 digits, the last is the check digit. */
export function vkn(): string {
  const d = digits(9);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const step = (d[i] + (9 - i)) % 10;
    let value = (step * 2 ** (9 - i)) % 9;
    if (step !== 0 && value === 0) value = 9;
    sum += value;
  }
  d.push((10 - (sum % 10)) % 10);
  return d.join("");
}

/** The remainder of a long digit string divided by 97, without big numbers. */
export function mod97(digitText: string): number {
  let rest = 0;
  for (const character of digitText) rest = (rest * 10 + Number(character)) % 97;
  return rest;
}

/** A Turkish IBAN (26 characters): TR, check digits, a bank code, a reserved 0 and a 16-digit account number. */
export function iban(): string {
  const basic = `${pick(trBankCodes)}0${digits(16).join("")}`;
  // "TR" is 29 27 in the IBAN letter-to-number scheme; the check digits are 98 minus the remainder.
  const check = String(98 - mod97(`${basic}292700`)).padStart(2, "0");
  return `TR${check}${basic}`;
}

export function cardNumber(network: keyof typeof testCards): string {
  const number = testCards[network];
  // Amex is written 4-6-5, the others in fours.
  return network === "amex" ? `${number.slice(0, 4)} ${number.slice(4, 10)} ${number.slice(10)}` : number.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function sentence(): string {
  const count = between(6, 14);
  const words = Array.from({ length: count }, () => pick(loremWords));
  return `${capitalize(words.join(" "))}.`;
}

export function paragraph(): string {
  return Array.from({ length: between(4, 6) }, sentence).join(" ");
}

/** One made-up person as a JSON object, every field from the same person. */
export function userJson(locale: Locale, now: Date = new Date()): string {
  const who = person(locale);
  const home = address(locale);
  const user: Record<string, unknown> = {
    id: uuid(),
    firstName: who.first,
    lastName: who.last,
    email: email(who),
    username: username(who),
    phone: phone(locale),
    birthDate: birthDate(now),
    company: company(locale),
    jobTitle: jobTitle(locale),
    address: { street: home.street, city: home.city },
  };
  if (locale === "tr") {
    user.tckn = tckn();
    user.iban = iban();
  }
  return JSON.stringify(user, null, 2);
}
