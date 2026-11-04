# Calculator

Copy a sum from a spreadsheet, an invoice or a chat, and yabbistir tags it and pastes the answer.

## Example

Copy `12 * 3 + 4`: the item gets the *calc* tag, its preview shows *Result: 40* and *Expression: 12 * 3 + 4*, and two actions are offered with the answer on the row:

- **Paste result** pastes `40`.
- **Paste expression = result** pastes `12 * 3 + 4 = 40`.

More that works: `15% of 80` (12), `80 + 15%` (92), `80 * 15%` (12), `(2 + 3) × 4`, `2^3^2` (512), `1.234,56 + 10` (1.244,56), `sqrt(16) + 1`, `max(1, 7) - min(4; 2)`.

## What it understands

- Numbers, `+ - * / × ÷ ^`, `%` as percent or remainder, parentheses, unary minus. `^` is right to left and binds tighter than unary minus: `2^3^2` is 512, `-2^2` is -4.
- Percentages: `15% of 80`, `80 + 15%` (80 plus 15% of 80), `80 - 15%`, `80 * 15%`. `10 % 3` (a space and an operand after it) is the remainder, 1.
- Functions: `sqrt abs round floor ceil sin cos tan log ln exp min max`. `log` is base 10, `ln` is natural, trigonometry is in radians, `round(x; digits)` takes an optional second argument. Separate arguments with `;` or with a comma followed by a space (`max(1, 2)`); a comma with no space after it is a decimal comma.
- Constants `pi` (or `π`) and `e`.
- A trailing or leading `=` is ignored.

## Number styles

Dot or comma decimals and thousands marks both work: `1.234,56` and `1,234.56`. When a number is clear (`1.234,56`, `1,5`, `1.5`, `1.234.567`) it is read as written. A single separator followed by exactly three digits (`1.234`, `1,234`) is ambiguous, and the app's language decides: in English the comma is the thousands mark, in Turkish (and German, French and so on) the dot is. The answer is written in the style of the input: the same decimal mark, and with thousands marks when the input had them. The answer has at most 12 significant digits; very large or tiny answers use an exponent (`1.26765060023e30`).

## What is not tagged

Anything that fails to parse: division by zero, overflow, unknown words, `sqrt(-1)`. A lone number, a lone percentage or a lone constant (no operator), text over 5,000 characters, and text on several lines. Things that look like a sum but are not: dates (`2024-11-04`, `11/04/2024`, `2024-11`), phone numbers (`555-123-4567`, `555-1234`), version strings (`1.2.3`), IP addresses, zero-padded numbers (`007`), times, `1920x1080`.

## Permissions

None. The extension reads only the item it is asked about. No network, no programs, no history.

## How it works

A tokenizer and a recursive-descent parser that evaluates as it reads: no `eval`, no `Function`. Parsing is linear in the text and nesting is limited, so a very long or adversarial copy is rejected quickly (the detector has 50 ms).

## Limits

- Write a subtraction of two plain numbers of three or more digits with spaces (`555 - 1234`): without spaces it is taken for a phone number or an identifier. Chains like `10-5-2` without spaces are taken for dates for the same reason; with spaces they are sums.
- No implicit multiplication (`2(3)`, `2pi`), no `x` as times, no units or currencies, no scientific notation input (`1e3`).
- Numbers with spaces or apostrophes as thousands marks (`1 234`, `1'234`) are not read.
- Floating point: results are rounded to 12 digits, so tiny differences (`0.1 + 0.2`) vanish.
