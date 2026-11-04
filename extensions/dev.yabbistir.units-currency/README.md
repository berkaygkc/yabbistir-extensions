# Units & Currency

Recognizes a copy whose whole text is a number with a unit, or an amount of money, tags it, and converts it.

**Units.** Length (mm cm m km in ft yd mi), mass (mg g kg t oz lb st), temperature (°C °F K), volume (ml cl l, tsp tbsp fl oz cup pt qt gal), speed (km/h mph m/s kn), area (cm² m² ha km² in² ft² yd² acre mi²), data (B KB MB GB TB and KiB MiB GiB TiB) and time (ms s min h d wk, also `1h 30m`). The preview lists the sensible conversions: the other system first (metric to imperial and back), then the close neighbors. **Convert unit** pastes the main one; **Convert to all units** pastes the list, one per line.

**Currency.** `120 USD`, `$120`, `€50`, `₺1.250,50`, `50 EUR`, `100 TL`, `USD 120`, `1.250,50 ₺`. **Convert to TRY / EUR / USD / GBP** pastes the converted amount; **Convert to all currencies** pastes one line per currency. A text setting, *More currencies*, adds other ISO codes (for example `JPY, CHF`) to the list and to the preview.

## Example

Copy `72°F`: the tag *Unit* appears, the preview shows `22.22 °C` and `295.37 K`, and **Convert unit** pastes `22.22 °C`.
Copy `110 USD`, choose **Convert to EUR**: it pastes `€100.00` (at a rate of 1.10), and a notice says which day's rate was used.

## Permissions

- **network**, only to `www.ecb.europa.eu`. The rates come from the European Central Bank's daily reference rates (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`). The request carries nothing about the copied text, and only happens when you run a currency action, never while you copy or preview.

No tools, no other permissions.

## How rates work

- The ECB publishes the rates once on working days (about 16:00 Central European Time), for about thirty currencies against the euro. Other pairs are worked out through the euro. These are reference rates, not what a bank or card charges.
- The rates are kept on this Mac (`yab.storage`) with their date, and reused for six hours. After that the next currency action fetches them again.
- If the ECB can't be reached, the last saved rates are used and the notice says *Offline. Using the rate of <date>*. With no saved rates there is nothing to convert and you are told so.
- The preview never uses the network: it shows conversions from the saved rates and their date, or says that rates load the first time you convert.
- Source and terms: ECB euro foreign exchange reference rates, free to reuse with the source named (https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html). Unit factors are the exact definitions of the international yard and pound (1959), the US customary volumes, the knot (1852 m/h) and SI/IEC prefixes; nothing is copied from a third-party table.

## Notes and limits

- Only a **whole** text is recognized: `5 km` yes, `it is 5 km away` no.
- Numbers: `1,234.5`, `1.234,5`, `1 234,5`, `1'234.5` and `3,5` are all read. A lone separator followed by exactly three digits (`1,234`) is a thousands separator unless it is your language's decimal separator (so `1.234` is 1234 in Turkish and 1.234 in English).
- `KB`, `MB`… count 1000 bytes (as macOS does); `KiB`, `MiB`… count 1024. `Mb` and `Gb` (bits) are not recognized.
- `oz` is a mass; volume is `fl oz`. `t` is the metric tonne. `pt`, `qt`, `gal`, `cup`, `tbsp` and `tsp` are US measures. A bare `C` or `F` (capital) is a temperature; lowercase is not.
- `$` means US dollars and `¥` Japanese yen; use the code (`CAD`, `CNY`) for others. Only currencies the ECB publishes are supported.
- Temperatures below absolute zero, and numbers beyond 10^15, are not recognized.
- Months and years are not units (their length varies).
