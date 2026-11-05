const elevenDigits = /^[1-9][0-9]{10}$/;
const tenDigits = /^[0-9]{10}$/;

const digitsOf = (text: string) => Array.from(text, (char) => char.charCodeAt(0) - 48);

/**
 * A TC Kimlik No: eleven digits, the first not 0, where
 * - the 10th digit is (7 × (1st + 3rd + 5th + 7th + 9th) − (2nd + 4th + 6th + 8th)) mod 10, and
 * - the 11th digit is the sum of the first ten, mod 10.
 */
export function isTCKN(text: string): boolean {
  if (!elevenDigits.test(text)) return false;
  const d = digitsOf(text);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  if (tenth !== d[9]) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) sum += d[index];
  return sum % 10 === d[10];
}

/**
 * A VKN (vergi kimlik numarası): ten digits whose last is the check digit of the first nine. For the digit at
 * position i from the left (1 to 9): p = (digit + 10 − i) mod 10; q = (p × 2^(10 − i)) mod 9, or 9 when p is not 0
 * and q is; the check digit is (10 − (sum of q) mod 10) mod 10.
 */
export function isVKN(text: string): boolean {
  if (!tenDigits.test(text)) return false;
  const d = digitsOf(text);
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    const p = (d[index] + 9 - index) % 10;
    let q = (p * 2 ** (9 - index)) % 9;
    if (p !== 0 && q === 0) q = 9;
    sum += q;
  }
  return (10 - (sum % 10)) % 10 === d[9];
}
