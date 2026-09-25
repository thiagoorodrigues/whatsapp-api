import { QueryTypes } from "sequelize";
import sequelize from "../../database";
import { ENTRY_DATE_SQL } from "./trackingRules";

// Business timezone for "today" and the hour buckets (Brazil has no DST).
const TIMEZONE = "America/Sao_Paulo";

export interface HourlyRow {
  hour: number;
  amount: number;
}

/**
 * Attendances that entered the system on `date` (YYYY-MM-DD, local time),
 * grouped by local hour. Counts TicketTraking rows, so a returning contact
 * counts on the day they came back, not on their first-ever contact.
 */
const HourlyAttendancesService = async (
  companyId: number | string,
  date: string
): Promise<HourlyRow[]> => {
  const localEntry = `(${ENTRY_DATE_SQL} at time zone '${TIMEZONE}')`;

  const rows: any[] = await sequelize.query(
    `
      select extract(hour from ${localEntry})::int as hour, count(*)::int as amount
      from "TicketTraking" tt
      where tt."companyId" = :companyId
        and ${localEntry}::date = :date::date
      group by 1
      order by 1
    `,
    { replacements: { companyId: Number(companyId), date }, type: QueryTypes.SELECT }
  );

  return rows.map(r => ({ hour: Number(r.hour), amount: Number(r.amount) }));
};

export default HourlyAttendancesService;
