# Fake Data

Makes fake data for forms, fixtures and demos. Search for what you need (`fake`, `iban`, `tckn`, `email`, `lorem`) and press ↵: the value is pasted, and the row shows it before you pick it.

- **Fake person:** full name, first name, last name, username, date of birth (an adult, 18 to 80 years old, as `YYYY-MM-DD`).
- **Fake contact:** email, phone number, street address, city.
- **Fake work details:** company, job title.
- **Fake number:** Turkish ID number (TCKN), Turkish tax number (VKN), Turkish IBAN, and test card numbers (Visa, Mastercard, American Express).
- **Lorem ipsum:** a sentence or a paragraph.
- **Fake user (JSON):** one made-up person as a JSON object: id, name, email, username, phone, date of birth, company, job title and address. With Turkish data it has a `tckn` and an `iban` too.

## Example

```json
{
  "id": "5c1f0e0a-3a66-4a4f-9a0e-0d7f2a5a9b11",
  "firstName": "Elif",
  "lastName": "Kaya",
  "email": "elif.kaya@example.org",
  "username": "ekaya42",
  "phone": "+90 532 418 07 26",
  "birthDate": "1991-06-14",
  "company": "Mavi Yazılım A.Ş.",
  "jobTitle": "Ürün Yöneticisi",
  "address": { "street": "Gül Sokak No: 14/3", "city": "İzmir" },
  "tckn": "10000000146",
  "iban": "TR330006100519786457841326"
}
```

## Language of the data

Settings has one choice, **Language of the data**: *Same as the app* (the default), *Turkish* or *English*. It changes names, cities, streets, companies, job titles and phone formats. The Turkish ID, tax number and IBAN are always Turkish, and the card numbers and lorem ipsum never change.

## What is real and what is not

This data is fake. **Never use it to pretend to be someone, or for real payments.**

- **Names, cities, streets, companies, job titles** come from short lists written for this extension from common words. No list was taken from a real record. Because the lists are short and common, a made-up name can match a real person by chance.
- **Email** always ends in `example.com`, `example.org` or `example.net`, the names RFC 2606 reserves for documentation and tests. Mail to them reaches no one.
- **Phone numbers:** English numbers are US style (`+1 (area) 555-01xx`); there is no UK style. They use `555-0100` to `555-0199`, the range set aside for fiction. Turkey has no such range, so a Turkish mobile number is random and may belong to someone. Use it only to fill a field, never to call or send a message.
- **TCKN, VKN and IBAN** pass the public check-digit rules, so form validators accept them. They are random: a number may happen to belong to a real person or account. The IBAN is pasted compact, without spaces (`TR33…`), which is what forms usually want. Its five-digit bank code is picked from a short list of codes in the Central Bank of the Republic of Türkiye's published bank list; the account number is random and opens nothing.
- **Test cards** are the numbers the card networks publish for testing (`4111 1111 1111 1111` Visa, `5555 5555 5555 4444` Mastercard, `3782 822463 10005` American Express). They pass the Luhn check, work in the networks' test modes, and never belong to a real account. There is no expiry or security code: test systems take any future date and any code.
- **Lorem ipsum** uses the classic Latin placeholder words, which are in the public domain.

Everything is made on your Mac from `crypto.getRandomValues`, with no network.

## Permissions and tools

None. The extension needs no permission, runs no program and makes no request.

## Limits

- Each row makes one value; pick the row again for a new one.
- Turkish and English only.
- Data is meant to look plausible, not to be statistically realistic.
