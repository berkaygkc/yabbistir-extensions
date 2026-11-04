// The message to reply to, out of a copied mail: the newest message is on top, and what follows a line such as
// "On 3 May 2026, Ada wrote:" or "-----Original Message-----", and every line quoted with ">", is earlier mail.
// Replying to the newest message alone keeps the model from answering an older one.

/** "-----Original Message-----" and the like, in English and Turkish. */
const separator = /^-{2,} ?(?:original message|forwarded message|orijinal ileti|özgün ileti|iletilen ileti) ?-{2,}$/iu;

/** A line that says who wrote the earlier mail, in English or in Turkish. */
function isAttribution(line: string): boolean {
  // Common mail clients in English: "On Mon, 3 May 2026 at 10:00, Ada <ada@example.com> wrote:"
  if (line.startsWith("On ") && line.endsWith(" wrote:")) return true;
  // Apple Mail in Turkish: "3 May 2026 Pzt 10:00 tarihinde Ada <ada@example.com> şunu yazdı:"
  return line.includes(" tarihinde ") && (line.endsWith(" şunu yazdı:") || line.endsWith(" şunları yazdı:"));
}

/** Whether line `index` starts the earlier mail: plain string checks, so a long line costs no more than its length. */
function startsEarlierMail(lines: string[], index: number): boolean {
  const line = lines[index].trim();
  if (line.length > 300) return false;
  const next = (lines[index + 1] ?? "").trim();
  if (isAttribution(line)) return true;
  // Plain-text mail wraps a long attribution: "On Mon, 3 May 2026 at 10:00 AM Ada Lovelace <" and then
  // "ada@example.com> wrote:". A line that ends a sentence is the person's own, not the start of one.
  const endsASentence = ".!?".includes(line.at(-1) ?? "");
  if (next !== "" && next.length <= 300 && !endsASentence && isAttribution(`${line} ${next}`)) return true;
  if (separator.test(line)) return true;
  // Some mail clients: "From: …" followed by "Sent: …" or "Date: …".
  return (line.startsWith("From: ") || line.startsWith("Kimden: "))
    && ["Sent: ", "Date: ", "Gönderildi: ", "Tarih: "].some((label) => next.startsWith(label));
}

/** The newest message of a copied mail thread, or the whole text when it has no earlier mail in it. */
export function latestMessage(text: string): string {
  const lines = text.split("\n");
  let end = lines.length;
  for (let index = 1; index < lines.length; index++) {
    if (startsEarlierMail(lines, index)) {
      end = index;
      break;
    }
  }
  const newest = lines.slice(0, end).filter((line) => !line.trimStart().startsWith(">")).join("\n").trim();
  return newest === "" ? text : newest;
}
