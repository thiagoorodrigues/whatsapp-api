/**
 * Ticket list previews saved before mentions got names show "@1407...":
 * rewrites them with the names (see BackfillMentionPreviewsService). Uses
 * the application's models, so it loads the app database connection and
 * closes it at the end.
 *
 * `down` is a no-op: the preview is only a copy of the last message text.
 */
module.exports = {
  up: async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const sequelize = require("../index").default;
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const backfill = require("../../services/MessageServices/BackfillMentionPreviewsService").default;
    try {
      await backfill();
    } finally {
      await sequelize.close();
    }
  },

  down: async () => {}
};
