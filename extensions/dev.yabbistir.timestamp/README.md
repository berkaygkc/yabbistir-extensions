# Timestamp

Recognizes a copied Unix timestamp or date and tells you which moment it is. The item gets a small *time* chip; its preview shows the local time, UTC, ISO 8601, how long ago it was, the weekday and the Unix seconds. On a tagged item, ⇧ offers four conversions, each with its result as a hint.

## What it recognizes

The **whole copied text** must be one timestamp, between 1 January 1990 and 31 December 2099 (UTC):

- Unix seconds (10 digits), milliseconds (13), microseconds (16) and nanoseconds (19). With ten digits the range starts in September 2001, because 9-digit values cannot be told from other numbers.
- ISO 8601 / RFC 3339 date-times: `2026-01-01T03:00:00+03:00`, `2026-01-01T00:00:00.123Z`, `2026-01-01 00:00`, with `Z`, an offset (`+03:00`, `+0300`) or none. Fractions of a second up to nine digits are kept.
- RFC 2822 dates: `Thu, 1 Jan 2026 00:00:00 +0000`, with a numeric offset or `UT`, `GMT`, `EST`, `EDT`, `CST`, `CDT`, `MST`, `MDT`, `PST`, `PDT`. A weekday that does not match the date is refused.

A date or time without a zone is read in this Mac's time zone, and the preview says so ("Read as").

Not tagged: phone numbers and ids that only look like timestamps (wrong length, a leading zero, outside the range), years alone, dates without a time, invalid dates such as 30 February, leap seconds (`:60`) and `24:00`.

## Example

Copy `1767225600`. The preview shows `January 1, 2026 at 3:00:00 AM GMT+3` (local), the same moment in UTC, `2026-01-01T00:00:00Z`, "3 days ago", "Thursday" and `1767225600`. In Turkish the same preview reads "1 Ocak 2026 03:00:00 GMT+3", "3 gün önce", "Perşembe".

## Actions

On a tagged item: *Convert to ISO 8601 (UTC)*, *Convert to Unix seconds*, *Convert to Unix milliseconds*, *Convert to local date and time*. Sub-millisecond digits survive in the ISO form (`2026-01-01T00:00:00.123456789Z`).

Anywhere: *Paste now as Unix seconds* and *Paste now as ISO 8601*.

## Setting

**Extra time zone** (empty by default): an IANA zone such as `America/New_York` or `Europe/London`. When set, the preview adds a row in that zone, with its abbreviation so daylight saving is clear. An invalid zone is ignored.

## Permissions

None. The extension only reads the item it is asked about and the clock. Nothing is sent anywhere, and no command-line tool is needed.

## Limits

- Dates are formatted by the system's `Intl`, so wording follows macOS.
- Relative time is rounded ("3 months ago" is about 91 days).
- Millisecond precision is the finest a pasted Unix or ISO value keeps in the preview's local and UTC rows; the ISO row and the conversions keep nanoseconds.
