import localforage from 'localforage';

export const OF = localforage.createInstance({ name: 'offline-chat', storeName: 'chat' });

export async function getClientId() {
  let id = await OF.getItem('clientId');
  if (!id) { id = crypto.randomUUID(); await OF.setItem('clientId', id); }
  return id;
}
export async function getLamport() {
  const v = await OF.getItem('lamport'); return typeof v === 'number' ? v : 0;
}
export async function setLamport(n) { await OF.setItem('lamport', n); }

export async function getOutbox(convId) {
  return (await OF.getItem(`outbox:${convId}`)) || [];
}
export async function setOutbox(convId, arr) {
  await OF.setItem(`outbox:${convId}`, arr || []);
}
export async function pushOutbox(convId, op) {
  const arr = (await getOutbox(convId));
  arr.push(op);
  await setOutbox(convId, arr);
}

export async function saveOps(convId, ops) { await OF.setItem(`ops:${convId}`, ops || []); }
export async function readOps(convId) { return (await OF.getItem(`ops:${convId}`)) || []; }

export async function saveMessages(convId, msgs) { await OF.setItem(`msgs:${convId}`, msgs || []); }
export async function readMessages(convId) { return (await OF.getItem(`msgs:${convId}`)) || []; }
