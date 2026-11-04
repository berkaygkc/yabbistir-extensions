# Türkiye Pack

Understands the numbers you copy every day in Türkiye: IBANs, TC Kimlik and tax numbers, phone numbers and cargo tracking numbers. Everything is worked out on this Mac; nothing is sent anywhere unless you choose to track a package.

| You copy | Its chip | Its preview | ⇧ on it offers |
|---|---|---|---|
| An IBAN, of any country | IBAN | The IBAN in groups of four, the country, the check result and, for a Turkish IBAN, the bank's name and code | Format IBAN with spaces · Format IBAN without spaces |
| A TC Kimlik No | TCKN | Valid, and by which rule | |
| A tax number (VKN) | VKN | Valid, and by which rule | |
| A Turkish phone number | Phone | Mobile or landline, the province of a landline, the international form | Format with +90 · Format with a leading 0 · Format as E.164 |
| A cargo tracking number | | | Track with Yurtiçi Kargo · Aras Kargo · DHL eCommerce · UPS · DHL Express |

## Example

Copy `TR05 0006 4000 0000 0000 0012 34` (a made-up IBAN). It gets the *IBAN* chip, and its preview shows:

| | |
|---|---|
| IBAN | TR05 0006 4000 0000 0000 0012 34 |
| Country | Türkiye |
| Bank | Türkiye İş Bankası |
| Bank code | 00064 |
| Check | Valid · mod 97 |

Press ⇧ on it and *Format IBAN without spaces* shows `TR050006400000000000001234`, which ↵ pastes.

Copy `0532 000 00 01` and ⇧ offers `+90 532 000 00 01`, `0532 000 00 01` and `+905320000001`. Copy a Yurtiçi tracking number such as `100000000001`, pick *Track with Yurtiçi Kargo*, and Yurtiçi's tracking page opens in your browser with the number filled in.

## What it recognizes

The whole copied text must be the number (spaces and line breaks around it are ignored).

- **IBAN**: two letters for one of the 89 countries of the SWIFT IBAN Registry, the length that country uses, and check digits that pass ISO 7064 MOD 97-10. With or without spaces (non-breaking ones too), in upper or lower case, and after an `IBAN:` label. The bank is named from the five-digit code in positions 5 to 9 of a Turkish IBAN.
- **TC Kimlik No**: eleven digits, the first not 0, where the 10th digit is (7 × the sum of the 1st, 3rd, 5th, 7th and 9th digits − the sum of the 2nd, 4th, 6th and 8th) mod 10, and the 11th is the sum of the first ten mod 10.
- **VKN**: ten digits whose last is the check digit of the other nine. For the digit at position *i*: *p* = (digit + 10 − *i*) mod 10, *q* = *p* × 2^(10 − *i*) mod 9, or 9 when *p* is not 0 and *q* is; the check digit is 10 minus the sum of the *q*s, mod 10.
- **Phone number**: a mobile number (500–509, 530–559, 561), a landline with a province's area code (and a subscriber number that does not start with 0 or 1), or an 850 or 800 number. Written with `+90`, `0090`, `90` or the trunk `0` in front, grouped with spaces or dashes, with the area code in brackets, or as one block: `+90 (532) 000 00 01`, `0 532 000 00 01`, `0532-000-00-01`, `05320000001`.
- **Tracking number**: ten digits (a DHL Express waybill), 12 to 22 digits (Yurtiçi, Aras, DHL eCommerce and others), a UPS `1Z` number, or a DHL `JJD` or `JD` piece number. Eleven digits never are: in Türkiye those are a TC Kimlik No or a phone number with its 0. A tracking number gets no chip; the actions are offered on it.

## Tracking pages

Each carrier's own tracking page opens, with the number in its address. When yabbistir is in Turkish, the carriers' Turkish pages open.

| Carrier | Page |
|---|---|
| Yurtiçi Kargo | `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=<number>` (English: `/en/online-services/tracking?code=`). Takes 12 to 16 digits, the limits of Yurtiçi's own field; another number gets a short notice instead. |
| Aras Kargo | `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=<number>` |
| DHL eCommerce (formerly MNG Kargo) | `https://kargotakip.dhlecommerce.com.tr/?takipNo=<number>`. The page asks you to type a short verification code before it shows the shipment. |
| UPS | `https://www.ups.com/track?loc=tr_TR&tracknum=<number>&requester=ST%2Ftrackdetails` (English: `loc=en_US`) |
| DHL Express | `https://www.dhl.com/tr-tr/home/tracking.html?tracking-id=<number>&submit=1` (English: `global-en`) |

**PTT Kargo and Sürat Kargo are not included**: their tracking pages take the number only together with a security check, and cannot be opened with the number in the address.

## Permissions

None. The extension reads only the item it is asked about. Opening a link in the browser (`yab.open`) needs no permission, and happens only when you pick a *Track with …* row: then the tracking number goes to that carrier's website, and nowhere else. TC Kimlik and tax numbers are never shown back in a preview, written to the log or sent anywhere.

There are no programs to install and nothing to set up.

## Limits

- A check digit says a number is well formed, not that it was ever issued or whose it is. Only the check digits are tested, and the preview says so.
- About one in ten ten-digit numbers fits the single VKN check digit by chance, and about one in a hundred eleven-digit numbers fits both TC Kimlik rules, so an unrelated number of that length (a ten-digit Unix time, for example) can get the chip.
- Ten bare digits are never taken as a phone number, since they are as likely a tax number; `532 000 00 01`, with groups, is. 444 numbers, short numbers, extensions and numbers written with dots are not recognized.
- A ten-digit tax number also looks like a DHL Express waybill, so *Track package* is offered on it too.
- Bank names come from the Central Bank's lists of 2026. A bank that has closed, or joined later, shows only its code.
- The IBAN check covers the length and the check digits, not the inner format of each country's account number. Countries added to the registry after December 2024 are not recognized yet.
- Whether a carrier knows a tracking number is up to its own page.

## Sources

- **IBAN lengths**: [SWIFT IBAN Registry](https://www.swift.com/standards/data-standards/iban), Release 99 (December 2024), as summarized in [Wikipedia's IBAN article](https://en.wikipedia.org/wiki/International_Bank_Account_Number#IBAN_formats_by_country). Only the country codes and lengths are used.
- **Bank codes and names**: the Central Bank of the Republic of Türkiye (TCMB), [TCMB Ödeme Sistemleri Katılımcıları (2026)](https://www.tcmb.gov.tr/wps/wcm/connect/9fa62a85-5b6d-46c5-9b01-eb461d43723d/TCMB+%C3%96deme+Sistemleri+Kat%C4%B1l%C4%B1mc%C4%B1lar%C4%B1+(072025).pdf?MOD=AJPERES) and [FAST Sistemi Katılımcı Listesi (2026)](https://www.tcmb.gov.tr/wps/wcm/connect/954e041c-582d-4d1a-bd35-ff78e7c277b8/FAST+S%C4%B0STEM%C4%B0+KATILIMCILARI.pdf?MOD=AJPERES). Names are written without the company type (A.Ş.).
- **Area codes and mobile prefixes**: the +90 numbering plan of the Information and Communication Technologies Authority (BTK), as listed in [Telephone numbers in Turkey](https://en.wikipedia.org/wiki/Telephone_numbers_in_Turkey).
- **TC Kimlik No rules**: [T.C. Kimlik Numarası](https://tr.wikipedia.org/wiki/T.C._Kimlik_Numaras%C4%B1) (Turkish Wikipedia).
- **VKN algorithm**: as implemented by [python-stdnum's `stdnum.tr.vkn`](https://arthurdejong.org/python-stdnum/doc/stdnum.tr.vkn), whose documented examples this one reproduces; no code was copied. The Revenue Administration's own check is its [VKN doğrulama](https://www.turkiye.gov.tr/gib-intvrg-vergi-kimlik-numarasi-dogrulama) service.
- **Tracking pages**: each carrier's tracking page (above), checked to take the number from its address: Yurtiçi's page script reads `code`, DHL eCommerce's page fills `takipNo` into its form, and Aras's page looks `code` up. The UPS and DHL addresses are the form their own sites use.

The embedded tables hold facts (country codes and lengths, bank codes and names, area codes and province names), not creative text, and no text or code from these sources is reproduced. The extension itself is MIT licensed.
