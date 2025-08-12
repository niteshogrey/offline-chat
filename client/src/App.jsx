import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { compare } from './utils/lamport';
import { getClientId, getLamport, setLamport, getOutbox, setOutbox, pushOutbox, saveOps, readOps, saveMessages, readMessages } from './services/db';
import { v4 as uuidv4 } from 'uuid';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
const CONV_ID = 'room1';

function applyOps(allOps) {
  const sorted = [...allOps].sort(compare);
  const msgs = {};
  for (const op of sorted) {
    if (!msgs[op.messageId]) msgs[op.messageId] = { id: op.messageId, content: '', deleted: false, lastLamport: -1, lastClientId: null, lastOpId: '' };
    const m = msgs[op.messageId];
    const incoming = { lamport: op.lamport, clientId: op.clientId, opId: op.opId };
    const currentMeta = { lamport: m.lastLamport, clientId: m.lastClientId || '', opId: m.lastOpId || '' };
    const cmp = compare(incoming, currentMeta);
    if (cmp >= 0) {
      if (op.type === 'create') { m.content = op.content || ''; m.deleted = false; }
      else if (op.type === 'edit') { m.content = op.content || m.content; }
      else if (op.type === 'delete') { m.deleted = true; }
      m.lastLamport = op.lamport;
      m.lastClientId = op.clientId;
      m.lastOpId = op.opId;
    }
  }
  return Object.values(msgs).filter(x => !x.deleted);
}

export default function App() {
  const [clientId, setClientIdState] = useState(null);
  const [lamport, setLam] = useState(0);
  const [ops, setOpsState] = useState([]);
  const [messages, setMessagesState] = useState([]);
  const [text, setText] = useState('');
  const socketRef = useRef(null);
  const user = new URLSearchParams(window.location.search).get('user') || 'Guest';

  useEffect(() => {
    (async () => {
      const cid = await getClientId();
      setClientIdState(cid);
      const l = await getLamport(); setLam(l);

      const savedOps = await readOps(CONV_ID);
      const savedMsgs = await readMessages(CONV_ID);
      setOpsState(savedOps);
      setMessagesState(savedMsgs);

      // connect socket if online
      if (navigator.onLine) connectSocket();
      // flush on online events
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      // initial attempt to flush outbox if online
      if (navigator.onLine) await flushOutbox();
    })();

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  function onOnline() {
    connectSocket();
    flushOutbox();
  }
  function onOffline() {
    // nothing special needed; we keep storing locally
  }

  function nextLamport() {
    const next = lamport + 1;
    setLam(next);
    setLamport(next);
    return next;
  }

  function dedupeOps(lists) {
    const map = new Map();
    for (const lst of lists) {
      for (const o of lst) map.set(o.opId, o);
    }
    return Array.from(map.values());
  }

  async function connectSocket() {
    if (socketRef.current && socketRef.current.connected) return;
    const s = io(SERVER, { query: { user } });
    socketRef.current = s;
    s.on('connect', () => {
      s.emit('join', CONV_ID);
    });
    s.on('opsUpdate', async (payload) => {
      // payload = { ops, messages }
      const serverOps = payload.ops || [];
      const merged = dedupeOps([ops, serverOps]);
      await saveOps(CONV_ID, merged);
      const mergedMessages = applyOps(merged);
      await saveMessages(CONV_ID, mergedMessages);
      setOpsState(merged);
      setMessagesState(mergedMessages);
    });
    s.on('disconnect', () => { console.log('socket disconnected'); });
  }

  // flush outbox -> try to send all pending ops to server via socket or HTTP sync
  async function flushOutbox() {
    const outbox = await getOutbox(CONV_ID);
    if (!outbox.length) return;
    if (socketRef.current && socketRef.current.connected) {
      // send ops one by one (server will dedupe)
      for (const op of outbox) {
        socketRef.current.emit('sendOp', { convId: CONV_ID, op });
      }
      // clear outbox
      await setOutbox(CONV_ID, []);
    } else {
      // fallback: HTTP POST to /sync
      try {
        const res = await fetch(`${SERVER}/sync/${CONV_ID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, ops: outbox })
        });
        const data = await res.json();
        if (data.ok) {
          // persist server ops and messages
          const merged = dedupeOps([ops, data.ops || []]);
          await saveOps(CONV_ID, merged);
          const mergedMessages = applyOps(merged);
          await saveMessages(CONV_ID, mergedMessages);
          setOpsState(merged);
          setMessagesState(mergedMessages);
          // remove acked opIds from outbox
          const acked = new Set((data.ackedOpIds || []).map(x => x));
          const remaining = outbox.filter(o => !acked.has(o.opId));
          await setOutbox(CONV_ID, remaining);
        }
      } catch (err) {
        console.error('flush outbox http failed', err);
      }
    }
  }

  // create local op and store it (and put into outbox)
  async function createOp(type, content, messageId) {
    const op = {
      opId: uuidv4(),
      clientId,
      lamport: nextLamport(),
      type,
      content,
      messageId: messageId || uuidv4()
    };
    const newOps = [...ops, op];
    const newMessages = applyOps(newOps);
    setOpsState(newOps);
    setMessagesState(newMessages);
    await saveOps(CONV_ID, newOps);
    await saveMessages(CONV_ID, newMessages);
    // push to outbox
    await pushOutbox(CONV_ID, op);

    // immediately try to deliver if online
    if (navigator.onLine) await flushOutbox();
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: 20 }}>
      <h3>Offline-first Chat — {user}</h3>
      <div style={{ border: '1px solid #ddd', height: 360, padding: 8, overflowY: 'auto' }}>
        {messages.map(m => (
          <div key={m.id} style={{ padding: 6, borderBottom: '1px solid #f0f0f0' }}>
            <div>{m.content}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <button onClick={() => {
                const newText = prompt('Edit message', m.content);
                if (newText !== null) createOp('edit', newText, m.id);
              }}>Edit</button>
              <button onClick={() => { if (confirm('Delete?')) createOp('delete', '', m.id); }}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <input style={{ width: '75%', padding: 8 }} value={text} onChange={e => setText(e.target.value)} />
        <button style={{ padding: 8, marginLeft: 8 }} onClick={async () => { if (!text.trim()) return; await createOp('create', `${user}: ${text}`); setText(''); }}>Send</button>
      </div>
      <div style={{ marginTop: 8, color: '#555' }}>
        Status: {navigator.onLine ? 'online' : 'offline'} — clientId: {clientId}
      </div>
    </div>
  );
}
