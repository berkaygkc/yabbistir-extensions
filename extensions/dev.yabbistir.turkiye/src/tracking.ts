/**
 * What counts as a tracking number, the same as the action's `accepts.pattern`: ten digits (a DHL Express waybill),
 * twelve to twenty-two digits (Yurtiçi, Aras, DHL eCommerce and others), a UPS "1Z" number, or a DHL "JJD"/"JD"
 * piece number. Eleven digits are left out on purpose: in Türkiye they are a TC Kimlik No or a phone number with its
 * trunk 0. So are 90 and 0090 followed by a phone number.
 */
const shape = /^(?:[0-9]{10}|[0-9]{12,22}|1Z[0-9A-Z]{16}|J{1,2}D[0-9]{10,22})$/;
const phoneLike = /^(?:0090|90)[2-58][0-9]{9}$/;
const maxText = 32;

/** The tracking number the whole text is, in upper case, or null. */
export function trackingCode(text: string): string | null {
  const code = text.trim().toUpperCase();
  if (code.length > maxText || !shape.test(code) || phoneLike.test(code)) return null;
  return code;
}

export interface Carrier {
  /** The carrier's own tracking page with the number in its address. */
  url(code: string, turkish: boolean): string;
  /** Whether the carrier's page takes this number at all; without it, any tracking number is passed on. */
  takes?(code: string): boolean;
  /** The locale key of the message shown when `takes` says no. */
  refused?: string;
}

/** Yurtiçi's own field takes 12 to 16 digits. */
const yurticiShape = /^[0-9]{12,16}$/;

/**
 * The carriers whose official tracking page takes the number in its address, by variant id. PTT and Sürat Kargo
 * are not here: their pages ask for the number together with a security check and cannot be opened with it.
 */
export const carriers: Readonly<Record<string, Carrier>> = {
  yurtici: {
    url: (code, turkish) =>
      turkish
        ? `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${encodeURIComponent(code)}`
        : `https://www.yurticikargo.com/en/online-services/tracking?code=${encodeURIComponent(code)}`,
    takes: (code) => yurticiShape.test(code),
    refused: "yurtici.refused",
  },
  aras: {
    url: (code) => `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=${encodeURIComponent(code)}`,
  },
  dhlecommerce: {
    url: (code) => `https://kargotakip.dhlecommerce.com.tr/?takipNo=${encodeURIComponent(code)}`,
  },
  ups: {
    url: (code, turkish) =>
      `https://www.ups.com/track?loc=${turkish ? "tr_TR" : "en_US"}&tracknum=${encodeURIComponent(code)}&requester=ST%2Ftrackdetails`,
  },
  dhl: {
    url: (code, turkish) =>
      `https://www.dhl.com/${turkish ? "tr-tr" : "global-en"}/home/tracking.html?tracking-id=${encodeURIComponent(code)}&submit=1`,
  },
};
