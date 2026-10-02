// Unread counter of a conversation in the cache. Per connection: the same
// number on two connections keeps one ticket (and one counter) on each.
export const unreadsKey = (contactId: number, whatsappId: number): string =>
  `contacts:${contactId}:${whatsappId}:unreads`;
