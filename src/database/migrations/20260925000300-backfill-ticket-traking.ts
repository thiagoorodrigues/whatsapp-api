import { QueryInterface } from "sequelize";

/**
 * Repairs historical TicketTraking rows so reports and the dashboard count
 * them (see services/ReportService/trackingRules.ts):
 *
 * 1. queuedAt was only set for tickets that went through a queue, and the
 *    dashboard filters periods by it. Empty ones get startedAt, or the row
 *    creation time.
 * 2. Finished attendances without an attendant (closed straight from the
 *    queue, or returned to the queue before closing) get the user who
 *    logged "finalizou o atendimento" for that ticket within 5 minutes of
 *    finishedAt, the closest one winning. Attendances with no such log
 *    stay without an attendant: there is no reliable source for them.
 *
 * `down` is a no-op: the previous values were empty, and telling repaired
 * rows apart from rows written after this migration is not possible.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      update "TicketTraking"
      set "queuedAt" = coalesce("startedAt", "createdAt")
      where "queuedAt" is null
    `);

    await queryInterface.sequelize.query(`
      update "TicketTraking" tt
      set "userId" = sub."userId"
      from (
        select distinct on (tt2.id) tt2.id as "trakingId", l."userId"
        from "TicketTraking" tt2
        join "Logs" l
          on l."ticketId" = tt2."ticketId"
          and l."userId" is not null
          and l.observation ilike '%finalizou o atendimento%'
          and l."createdAt" between tt2."finishedAt" - interval '5 minutes'
                                and tt2."finishedAt" + interval '5 minutes'
        where tt2."userId" is null and tt2."finishedAt" is not null
        order by tt2.id, abs(extract(epoch from (l."createdAt" - tt2."finishedAt")))
      ) sub
      where tt.id = sub."trakingId"
    `);
  },

  down: async () => {
    // Intentionally empty, see header.
  }
};
