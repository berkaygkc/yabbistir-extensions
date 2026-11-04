/**
 * Geographic area codes of the +90 numbering plan and the province each one serves. İstanbul's two codes and
 * Northern Cyprus are locale keys, since their names differ by language; the rest are province names, the same in
 * every language.
 */
export const areaCodes: Readonly<Record<string, { name: string } | { key: string }>> = {
  "212": { key: "area.istanbulEurope" }, "216": { key: "area.istanbulAsia" },
  "222": { name: "Eskişehir" }, "224": { name: "Bursa" }, "226": { name: "Yalova" }, "228": { name: "Bilecik" },
  "232": { name: "İzmir" }, "236": { name: "Manisa" }, "242": { name: "Antalya" }, "246": { name: "Isparta" },
  "248": { name: "Burdur" }, "252": { name: "Muğla" }, "256": { name: "Aydın" }, "258": { name: "Denizli" },
  "262": { name: "Kocaeli" }, "264": { name: "Sakarya" }, "266": { name: "Balıkesir" }, "272": { name: "Afyonkarahisar" },
  "274": { name: "Kütahya" }, "276": { name: "Uşak" }, "282": { name: "Tekirdağ" }, "284": { name: "Edirne" },
  "286": { name: "Çanakkale" }, "288": { name: "Kırklareli" }, "312": { name: "Ankara" }, "318": { name: "Kırıkkale" },
  "322": { name: "Adana" }, "324": { name: "Mersin" }, "326": { name: "Hatay" }, "328": { name: "Osmaniye" },
  "332": { name: "Konya" }, "338": { name: "Karaman" }, "342": { name: "Gaziantep" }, "344": { name: "Kahramanmaraş" },
  "346": { name: "Sivas" }, "348": { name: "Kilis" }, "352": { name: "Kayseri" }, "354": { name: "Yozgat" },
  "356": { name: "Tokat" }, "358": { name: "Amasya" }, "362": { name: "Samsun" }, "364": { name: "Çorum" },
  "366": { name: "Kastamonu" }, "368": { name: "Sinop" }, "370": { name: "Karabük" }, "372": { name: "Zonguldak" },
  "374": { name: "Bolu" }, "376": { name: "Çankırı" }, "378": { name: "Bartın" }, "380": { name: "Düzce" },
  "382": { name: "Aksaray" }, "384": { name: "Nevşehir" }, "386": { name: "Kırşehir" }, "388": { name: "Niğde" },
  "392": { key: "area.northernCyprus" },
  "412": { name: "Diyarbakır" }, "414": { name: "Şanlıurfa" }, "416": { name: "Adıyaman" }, "422": { name: "Malatya" },
  "424": { name: "Elazığ" }, "426": { name: "Bingöl" }, "428": { name: "Tunceli" }, "432": { name: "Van" },
  "434": { name: "Bitlis" }, "436": { name: "Muş" }, "438": { name: "Hakkari" }, "442": { name: "Erzurum" },
  "446": { name: "Erzincan" }, "452": { name: "Ordu" }, "454": { name: "Giresun" }, "456": { name: "Gümüşhane" },
  "458": { name: "Bayburt" }, "462": { name: "Trabzon" }, "464": { name: "Rize" }, "466": { name: "Artvin" },
  "472": { name: "Ağrı" }, "474": { name: "Kars" }, "476": { name: "Iğdır" }, "478": { name: "Ardahan" },
  "482": { name: "Mardin" }, "484": { name: "Siirt" }, "486": { name: "Şırnak" }, "488": { name: "Batman" },
};

/** Mobile prefixes the operators give out: 500–509, 530–559 and 561. */
const mobile = /^5(?:0[0-9]|3[0-9]|4[0-9]|5[0-9]|61)$/;

export type PhoneKind = "mobile" | "landline" | "nonGeographic" | "tollFree";

export interface Phone {
  /** The ten-digit national significant number: "5321234567". */
  national: string;
  kind: PhoneKind;
}

/** Longer than any written form of a number, "+90 (0) 532 123 45 67" included. */
const maxText = 32;
const allowed = /^[+0-9 ()\- ]+$/;
const bracketed = /^\((?:0|0?[1-9][0-9]{2})\)$/;
const before = new Set(["", "0", "90", "0090"]);
const nonDigits = /[^0-9]/g;

function kindOf(national: string): PhoneKind | null {
  const prefix = national.slice(0, 3);
  if (mobile.test(prefix)) return "mobile";
  if (prefix === "850") return "nonGeographic";
  if (prefix === "800") return "tollFree";
  // A subscriber's number never starts with 0 or 1.
  if (Object.hasOwn(areaCodes, prefix) && national[3] >= "2") return "landline";
  return null;
}

/**
 * The Turkish phone number the whole text is, or null. Taken: +90, 0090 or 90 in front, or the trunk 0, with the
 * digits grouped by spaces or dashes and the area code in brackets, as in "+90 532 123 45 67", "0 (212) 123 45 67",
 * "0532-123-45-67" and "05321234567". Ten bare digits are not taken (they are as likely a tax number); ten digits
 * with groups are. Dots are not taken as separators, so an IP address is never a phone number.
 */
export function parsePhone(text: string): Phone | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > maxText || !allowed.test(trimmed)) return null;
  if (trimmed.lastIndexOf("+") > 0) return null;
  const open = trimmed.indexOf("(");
  const close = trimmed.indexOf(")");
  if (open !== trimmed.lastIndexOf("(") || close !== trimmed.lastIndexOf(")")) return null;
  if (open !== -1 || close !== -1) {
    // Brackets hold the area code ("(532)", "(0532)") or a trunk 0 ("+90 (0) 532"), and only the country code or a
    // trunk 0 comes before them.
    if (open === -1 || close === -1 || !bracketed.test(trimmed.slice(open, close + 1))) return null;
    if (!before.has(trimmed.slice(0, open).replace(nonDigits, ""))) return null;
  }
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(nonDigits, "");
  const grouped = digits.length + (plus ? 1 : 0) < trimmed.length;
  let national: string | null = null;
  if (plus) {
    if (!digits.startsWith("90")) return null;
    national = digits.slice(2);
    // "+90 (0) 532 …" and "+90 0532 …": a trunk 0 written after the country code.
    if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  } else if (digits.length === 14 && digits.startsWith("0090")) national = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("90")) national = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) national = digits.slice(1);
  else if (digits.length === 10 && grouped) national = digits;
  if (national === null || national.length !== 10 || national.startsWith("0")) return null;
  const kind = kindOf(national);
  return kind === null ? null : { national, kind };
}

/** "5321234567" → "532 123 45 67". */
const groups = (national: string) =>
  `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6, 8)} ${national.slice(8)}`;

/** "+90 532 123 45 67" */
export const international = (phone: Phone) => `+90 ${groups(phone.national)}`;
/** "0532 123 45 67" */
export const domestic = (phone: Phone) => `0${groups(phone.national)}`;
/** "+905321234567" */
export const e164 = (phone: Phone) => `+90${phone.national}`;
