# Password Generator

Makes a strong password or a random key right where you type. Open the panel (⇧⌘V), type `password`, `passphrase`, `pin` or `key`, and the row already shows the value that ↵ will paste.

| Row | What you get | Settings |
|---|---|---|
| Generate a password | Random characters, at least one from every set that is on | Length 8 to 128 (default 20); lowercase, uppercase, digits, symbols; leave out look-alikes `I l 1 O 0` (on by default) |
| Generate a passphrase | Random words from the EFF large word list | 4 to 8 words (default 5); separator: dash, space, period, underscore, comma or none |
| Generate a PIN | Digits only | 4 to 12 digits (default 6) |
| Generate a hex key | 32 random bytes as 64 lowercase hex digits | none |
| Generate a Base64URL key | 32 random bytes as 43 characters, no padding | none |

## Example

With the defaults, *Generate a password* shows something like `q7Rm-xW3#tBv9Kd2Zn_p`, and *Generate a passphrase* something like `crunching-oyster-pledge-bonus-jogger` (five words, about 64 bits).

## How the values are made

- The only source of randomness is `crypto.getRandomValues`. `Math.random` is never used.
- Every pick from a list uses **rejection sampling**: a 32-bit draw that falls in the last, incomplete block is thrown away, so every single pick is unbiased (no modulo bias). A password also guarantees one character from each enabled set, then fills the rest from the whole pool. The password is then shuffled with an unbiased Fisher-Yates shuffle.
- Every character set that is on is present in the password.
- The row's hint and the pasted value are the same run: what you see is what ↵ pastes.
- Four EFF words contain a hyphen themselves (`drop-down`, `felt-tip`, `t-shirt`, `yo-yo`); with the dash separator they look like two words. Pick another separator if that matters to you.

## Permissions

None. It needs no network, runs no program, and reads no clipboard history. It never logs or shows a generated value anywhere but in the result.

## Limits

- yabbistir has no way for an extension to mark a result as concealed or keep it out of history. **A generated value is pasted like any text and joins clipboard history**, where anyone with access to your history can read it. Delete the item from history after you have used a password that matters.
- Length, word count and PIN length are set in Settings, not in the row. A length that is not a whole number falls back to 20, and one outside 8 to 128 is moved to the nearest end.
- If all four character sets are turned off, the row says so and pastes nothing.

## Word list

The passphrase words are the EFF large word list (7,776 words), unchanged, from <https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases>. Copyright Electronic Frontier Foundation, licensed under [Creative Commons Attribution 3.0 United States (CC BY 3.0 US)](https://creativecommons.org/licenses/by/3.0/us/). The list is in `src/words.ts`.

## Develop

```sh
npm test -- dev.yabbistir.password-generator
npm run build -- dev.yabbistir.password-generator
```
