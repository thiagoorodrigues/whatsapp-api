import { QueryInterface } from "sequelize";

// Campaigns are enabled only by the plan (Plans.useCampaigns); the per-company
// "campaignsEnabled" setting is gone. `down` cannot know the old values.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.bulkDelete("Settings", { key: "campaignsEnabled" });
  },

  down: async () => {}
};
