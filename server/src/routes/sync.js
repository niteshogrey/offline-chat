const express = require('express');
const router = express.Router();
const conversationModel = require('../models/conversation');
const { compare } = require('../utils/lamport');

// apply op log deterministically to produce message list
function applyOpsToState(ops) {
  const messages = {};
  for (const op of ops) {
    const mid = op.messageId;
    if (!messages[mid]) messages[mid] = { id: mid, content: '', deleted: false, lastLamport: -1, lastClientId: null, lastOpId: '' };
    const m = messages[mid];
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
  return Object.values(messages).filter(x => !x.deleted);
}

// POST /sync/:convId
// body: { clientId, ops: [op,...] }
router.post('/:convId', async (req, res) => {
  try {
    const convId = req.params.convId;
    const incomingOps = Array.isArray(req.body.ops) ? req.body.ops : [];
    const clientId = req.body.clientId;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    let conv = await conversationModel.findOne({ convId });
    if (!conv) conv = new conversationModel({ convId, ops: [], cachedMessages: {} });

    // dedupe and append new ops
    const existingOpIds = new Set(conv.ops.map(o => o.opId));
    const ackedOpIds = [];
    for (const op of incomingOps) {
      if (!existingOpIds.has(op.opId)) {
        conv.ops.push(op);
        existingOpIds.add(op.opId);
        ackedOpIds.push(op.opId);
      } else {
        // already present -> still ack it
        ackedOpIds.push(op.opId);
      }
    }

    // sort deterministically & recompute cachedMessages
    conv.ops.sort((a,b) => compare(a,b));
    const mergedMessages = applyOpsToState(conv.ops);
    conv.cachedMessages = mergedMessages.reduce((acc,m) => { acc[m.id] = m; return acc; }, {});

    await conv.save();

    res.json({ ok: true, ops: conv.ops, messages: mergedMessages, ackedOpIds });
  } catch (err) {
    console.error('sync error', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /history/:convId
router.get('/history/:convId', async (req, res) => {
  try {
    const convId = req.params.convId;
    const conv = await conversationModel.findOne({ convId });
    if (!conv) return res.json({ messages: [], ops: [] });
    const messages = Object.values(conv.cachedMessages || {});
    res.json({ messages, ops: conv.ops });
  } catch (err) {
    console.error('history error', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
