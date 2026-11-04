# HTML to Markdown

Adds **Paste as Markdown** to text you copy with its formatting, from a web page, Google Docs, Notion, Word or Outlook. The row shows the Markdown before you pick it, and that Markdown is what gets pasted: headings, lists, links, tables and code come out as clean Markdown for your notes, READMEs and docs.

## Example

Copy this from a web page:

> **Release notes**
>
> - Faster search, see [the guide](https://example.com/guide)
> - Fixed a crash in `sync`

Press ⇧ on the item and choose *Paste as Markdown*:

```markdown
**Release notes**

- Faster search, see [the guide](https://example.com/guide)
- Fixed a crash in `sync`
```

## What it converts

- Headings, paragraphs and line breaks.
- Bold, italic, strikethrough and inline code, from tags and from the inline styles editors use (`font-weight: 700`, `font-style: italic`, `text-decoration: line-through`).
- Links with their titles, and images with their description, address and title. A link whose text is its own address becomes `<https://…>`.
- Bulleted, numbered and nested lists, with each list's starting number, and task lists (`- [x]`).
- Block quotes, horizontal rules and code blocks, with the language when the page names it (`language-js`, `lang-js`, `highlight-source-js`, `data-lang`).
- Tables, with the column alignment the page sets. Cells that span columns or rows leave the cells they cover empty.
- Entities such as `&amp;` and `&#8217;`, and white space the way a browser shows it.
- Text that Markdown would read as syntax is escaped, and nothing else: `snake_case` stays as it is, while a line that starts with `1.` or `#` gets a backslash.

It knows the quirks of the apps you copy from:

- **Google Docs**: the whole copy is wrapped in bold that isn't bold, nested lists sit beside their parent item, and checklists keep their ticks.
- **Notion**: to-do lists keep their state, and lists split into one item each are joined again.
- **Word and Outlook**: bullets and numbers written as paragraphs become real nested lists, and the stylesheet, conditional comments, `<o:p>` and hidden text are left out.
- **Safari and Chrome**: bold and italic written as inline styles count, and the styles a browser adds to everything do not.
- **Code editors**: code copied as colored lines in a monospaced font becomes a code block.

## Limits

- It needs the copy's formatting. Plain text, and copies whose formatting is larger than 256 KB (yabbistir doesn't pass those to extensions), get the message *This copy has no formatting to turn into Markdown*.
- Relative links stay as they are, since the page they came from isn't known.
- Images stored inside the copy, rather than at an address, are left out; their description stays as text. Images copied from Word point to temporary files on your Mac.
- Underline, highlight, colors, font sizes, and superscript and subscript have no Markdown, so that text stays plain.
- A table cell is one line: its paragraphs and line breaks become `<br>`. A table used for layout, such as an email's columns or a cell holding a list or heading, is read as its content instead.
- In Google Docs and Word, text in a monospaced font such as Courier is code: a paragraph of it becomes a code block, a few words become inline code. When the whole copy is in that font, it stays text. On web pages, only real code elements count.
- Markdown cannot show a few combinations, such as bold that ends in punctuation right before a letter (`**Note:**then`); those may lose their bold.

## Permissions

None. The extension reads only the item you pick, and converts it on your Mac.

## Data

The names of HTML's character entities come from the [WHATWG HTML Standard](https://html.spec.whatwg.org/multipage/named-characters.html), used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
