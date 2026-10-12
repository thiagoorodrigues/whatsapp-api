const HOUR = 60 * 60 * 1000;

/**
 * Scheduled times a "PROGRAMADA" campaign may have to be started now. The
 * check runs every 20 s, so a campaign set for the current minute is already
 * in the past when it is first seen; one whose time fell while the api was
 * down is too. Both start, up to an hour late; older ones stay put.
 */
export const campaignWindow = (now: Date = new Date()): { from: Date; to: Date } => ({
  from: new Date(now.getTime() - HOUR),
  to: new Date(now.getTime() + HOUR)
});
