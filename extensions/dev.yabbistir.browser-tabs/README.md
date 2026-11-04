# Browser Tabs

Your open browser tabs as a column in yabbistir's panel, so you can paste a link to one without switching to the browser. It works with Safari, Google Chrome, Arc, Brave, Microsoft Edge and Vivaldi. Each row shows the tab's title, with the browser and the site's host under it. ↵ pastes the tab's link, ⇧↵ pastes it as a Markdown link, and ⌘C copies the link.

## Example

You are writing in Slack and want to share the pull request open in Chrome. Open the panel, move to the *Open tabs* column and type `pull`. The row *Pull request #42* (`Chrome · code.example.org`) is there:

- ↵ pastes `https://code.example.org/pull/42`
- ⇧↵ pastes `[Pull request #42](https://code.example.org/pull/42)`

## Order

The tab you are looking at in each window comes first: the active tab of every window, then the other tabs. Within that, the browser in front comes first, then Safari, Chrome, Arc, Brave, Edge and Vivaldi, with each browser's windows from front to back and the tabs in their order. Blank pages and new tab pages are left out, since they have nothing to link to.

## Setup

None to install. The column asks only the browsers that are already open, and never opens one.

The first time the column reads a browser, macOS asks whether yabbistir may control it ("“yabbistir” wants access to control “Safari”…"). Allow it once for each browser you use. If you answer after a few seconds, the column may say it couldn't read the tabs that time; open the panel again.

If you chose *Don’t Allow*, the column shows one row that says where to change it: **System Settings › Privacy & Security › Automation**, where you turn on the browser's switch under yabbistir. When only some browsers are allowed, the others' tabs are listed and a row at the end names the browser that isn't.

## Private windows

Private windows are left out where the browser says which windows are private: Chrome, Brave, Edge and Vivaldi (incognito and InPrivate windows) and Arc. Safari's scripting does not tell private windows apart, so **Safari's private windows are listed like any other**.

## Permissions and privacy

- **exec**, limited to `osascript`, which comes with macOS. The extension runs one fixed script with `osascript -l JavaScript -e <script>`. The script is part of the extension: it is never built from a tab, a row or anything you copied, and it takes no other arguments. It only reads: for each browser that is running, its windows' ids and modes and its tabs' ids, titles and addresses. It never opens, closes or changes a tab, never runs JavaScript in a page, and never launches a browser.
- **Why osascript:** browsers share their tabs with other apps only through Apple events, and osascript is how a program sends them. The store's review checklist counts osascript among the shells, since a script can do anything; here the script is fixed, so the review is of that one script, in [`src/script.ts`](src/script.ts).
- **Automation.** macOS asks you before yabbistir controls each browser, and you can turn that off at any time in System Settings › Privacy & Security › Automation.
- **Nothing is kept.** The tabs are read each time you open the panel and again when you press ↵, ⇧↵ or ⌘C, so the link pasted is the one the tab has now. The extension keeps no tab in its storage, in a file or in its memory, and never writes a title or an address to the log or into an error message. yabbistir keeps the rows in memory only, never in its history, its search index or on disk, and a link it pastes from the column does not enter the history either.
- **Only the host is shown.** A row's second line shows the browser and the site's host (`example.com`), never the rest of the address, so a token in a link's query stays out of sight. The full address is what ↵ pastes.
- No network permission: the extension itself reaches nothing outside your Mac.

## Markdown links

⇧↵ pastes `[Title](address)`. In the title, `\ [ ] < > * _` and `` ` `` are escaped with a backslash, so the title shows as written; in the address, spaces, `<`, `>` and parentheses are percent-encoded so the link does not end early. A tab without a title links with its host.

## Limits

- **Browsers:** Safari, Google Chrome, Arc, Brave, Microsoft Edge and Vivaldi, the release versions. Firefox shares no tabs through Apple events. Beta and Canary channels, Chromium, Opera and Safari Technology Preview are not asked.
- **Arc:** Little Arc windows have no scripting, so their tabs are not listed.
- **Many tabs:** each browser answers a few Apple events per window, not one per tab, so hundreds of tabs read quickly. The column shows up to 10,000 tabs, the active ones first.
- **A busy browser:** a browser that does not answer within the panel's 10 seconds keeps the whole column from loading that time.
- **Rows follow tabs:** a tab's row stays the same while it is open. Safari gives tabs no id, so a Safari row follows the tab's address and place: when the tab moves or goes to another page, its row is a new one. If you press ↵ on a row whose tab has since changed or closed, the column says the tab is no longer open.

## Sources

- Chromium's scripting dictionary, shared by Chrome, Brave, Edge and Vivaldi: [`scripting.sdef`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/ui/cocoa/applescript/scripting.sdef), and the window modes `normal` and `incognito` in [`constants_applescript.mm`](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/cocoa/applescript/constants_applescript.mm).
- Arc's scripting: [Arc AppleScript API](https://browserinc.notion.site/Arc-AppleScript-API-897272210c784627ba3925a7610b02b6).
- JavaScript for Automation, `Application(bundleID)` and `running()`: Apple's JXA release notes for [OS X 10.10](https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html) and [OS X 10.11](https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-11.html).
- What macOS answers when Automation is off, "Not authorized to send Apple events to …" (-1743): [Avoiding AppleScript security and privacy requests](https://scriptingosx.com/2020/09/avoiding-applescript-security-and-privacy-requests/), Scripting OS X.
- Safari's dictionary has no private-window property: [Using AppleScript to detect if a Safari window uses Private Browsing](https://alexwlchan.net/2021/detect-private-browsing/), alexwlchan.
