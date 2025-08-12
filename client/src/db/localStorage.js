import localforage from 'localforage';

export const OF_STORE = localforage.createInstance({ name: 'offline-chat' });

// Keys:
// clientId -> string
// lamport -> number
// outbox:<convId> -> array of ops to send
// applied:<convId> -> array of ops already applied locally (for idempotency)
// messages:<convId> -> derived messages map for UI

export async function getClientId() {
  let id = await OF_STORE.getItem('clientId');
  if (!id) { id = crypto.randomUUID(); await OF_STORE.setItem('clientId', id); }
  return id;
}

export async function getLamport() {
  const v = await OF_STORE.getItem('lamport');
  return typeof v === 'number' ? v : 0;
}
export async function setLamport(n) { await OF_STORE.setItem('lamport', n); }

export async function pushOutbox(convId, op) {
  const key = `outbox:${convId}`;
  const arr = (await OF_STORE.getItem(key)) || [];
  arr.push(op);
  await OF_STORE.setItem(key, arr);
}
export async function drainOutbox(convId) {
  const key = `outbox:${convId}`;
  const arr = (await OF_STORE.getItem(key)) || [];
  await OF_STORE.setItem(key, []);
  return arr;
}
export async function readOutbox(convId) { return (await OF_STORE.getItem(`outbox:${convId}`)) || []; }

export async function saveMessages(convId, messages) {
  await OF_STORE.setItem(`messages:${convId}`, messages);
}
export async function readMessages(convId) { return (await OF_STORE.getItem(`messages:${convId}`)) || []; }

export async function saveAppliedOps(convId, ops) {
  await OF_STORE.setItem(`applied:${convId}`, ops);
}
export async function readAppliedOps(convId) { return (await OF_STORE.getItem(`applied:${convId}`)) || []; }