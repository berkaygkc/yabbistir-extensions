import type { SourceListing, SourceRow, Sources } from "@yabbistir/api";
import { readExport, type Account, type ExportContents } from "./exports.ts";
import { codeToPaste } from "./otp.ts";

// Two-factor codes as a column. The seeds are an authenticator's export, pasted into a `secret` preference that the
// app keeps in the Keychain. Each call reads it afresh and keeps nothing: no seed or code is logged, cached, stored or
// put in an error, and the rows are only issuers and account names.

/** The `secret` preference that holds the export. */
const ACCOUNTS = "accounts";
/** The source's one action: paste the code. */
const CODE = "code";

/** What the app turns into a space in a row's title, and what it trims from its ends after that. */
const LINE_BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const EDGE_SPACE = /^[\p{Z}\t-\r\u0085]+|[\p{Z}\t-\r\u0085]+$/gu;
const shown = (text: string): string => text.replace(LINE_BREAKS, " ").replace(EDGE_SPACE, "");

/** The accounts in the preference, or undefined when it is empty. */
function savedExport(): ExportContents | undefined {
  const text = yab.secrets.get(ACCOUNTS);
  try {
    if (text === null || text.trim() === "") return undefined;
    return readExport(text);
  } catch {
    // Reading never throws on purpose; if it did, its message stays here.
    throw new Error(yab.t("readFailed"));
  }
}

/** A row: the issuer over the account name, or whichever of them there is. */
function rowOf(account: Account): SourceRow {
  const issuer = shown(account.issuer);
  const name = shown(account.account);
  if (issuer !== "") return { id: account.id, title: issuer, subtitle: name || undefined };
  return { id: account.id, title: name || yab.t("unnamed") };
}

/** Rows in alphabetical order, as the app's language sorts them. */
function sorted(rows: SourceRow[], language: string): SourceRow[] {
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(language, { sensitivity: "base", numeric: true });
  } catch {
    collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  }
  return rows.sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.subtitle ?? "", b.subtitle ?? ""));
}

const locked = (message: string): SourceListing => ({ locked: true, message });

export const sources: Sources = {
  codes: {
    list(ctx) {
      const contents = savedExport();
      if (contents === undefined) return locked(yab.t("setUp"));
      if (contents.accounts.length > 0) return { rows: sorted(contents.accounts.map(rowOf), ctx.language) };
      if (contents.encrypted.length > 0) return locked(yab.t("encrypted", { app: contents.encrypted[0] }));
      return locked(yab.t(contents.skipped > 0 ? "noTotp" : "unrecognized"));
    },

    run(rowId, actionId) {
      if (actionId !== CODE) throw new Error(yab.t("noCode"));
      const contents = savedExport();
      if (contents === undefined) throw new Error(yab.t("setUp"));
      const account = contents.accounts.find((candidate) => candidate.id === rowId);
      if (account === undefined) throw new Error(yab.t("gone"));
      return { secret: codeToPaste(account, Date.now()) };
    },
  },
};
