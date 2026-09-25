import { QueryInterface } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.sequelize.transaction(t => {
      return Promise.all([
        queryInterface.bulkInsert(
          "Plans",
          [
            {
              name: "SwEasy Omni Envios",
              users: 1,
              connections: 1,
              queues: 0,
              value: 99,
              createdAt: new Date(),
              updatedAt: new Date()
            }          
          ],
          { transaction: t }
        ),
        queryInterface.bulkInsert(
          "Companies",
          [
            {
              name: "SwEasy OmniChannel",
              planId: 1,
              dueDate: "2093-03-14 04:00:00+01",
              createdAt: new Date(),
              updatedAt: new Date()
            }
          ],
          { transaction: t }
        )
      ]);
    });
  },

  down: async (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.bulkDelete("Companies", {}),
      queryInterface.bulkDelete("Plans", {})
    ]);
  }
};
