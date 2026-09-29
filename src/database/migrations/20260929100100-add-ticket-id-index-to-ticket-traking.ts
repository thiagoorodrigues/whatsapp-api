import { QueryInterface } from "sequelize";

// Os crons e o fechamento de ticket buscam TicketTraking por ticketId;
// sem índice era varredura sequencial (112 mil em um dia de produção).
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addIndex("TicketTraking", ["ticketId"], { name: "idx_ticket_traking_ticket_id" });
  },
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("TicketTraking", "idx_ticket_traking_ticket_id");
  }
};
