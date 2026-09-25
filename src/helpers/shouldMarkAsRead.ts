/**
 * Loading a ticket's messages marks them as read (and sends the blue ticks
 * to the customer). The admin "peek" dialog must not do that, so it passes
 * `markAsRead=false`; every other caller keeps the original behavior.
 */
const shouldMarkAsRead = (
  query?: { markAsRead?: string | boolean } | null
): boolean => {
  const value = query?.markAsRead;
  return !(value === false || value === "false");
};

export default shouldMarkAsRead;
