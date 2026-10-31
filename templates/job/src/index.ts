import type { Actions } from "@yabbistir/api";

export const actions: Actions = {
  // A job runs where the person can watch it: yabbistir shows a card with the progress and a cancel button.
  checksum: {
    async run(item, ctx) {
      const text = item?.text ?? "";
      yab.job.progress(null, yab.t("working"));
      // Only the tools named in the manifest's requires.tools can run, and no shell is involved.
      const result = await yab.exec("shasum", ["-a", "256"], { input: text, signal: ctx.signal });
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || yab.t("failed"));
      yab.job.progress(1, yab.t("done"));
      return { text: result.stdout.trim().split(/\s+/)[0] };
    },
  },
};
