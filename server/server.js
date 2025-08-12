const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv').config()

const syncRoutes = require('./src/routes/sync');
const conversationModel = require('./src//models/conversation');
const { compare } = require('./src/utils/lamport');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use('/sync', syncRoutes);

// socket handlers: accept ops and broadcast canonical messages back
io.on('connection', (socket) => {
  const username = socket.handshake.query?.user || 'Unknown';
  console.log(`socket connected ${socket.id} user=${username}`);

  socket.on('join', (convId) => {
    socket.join(convId);
    console.log(`${username} joined ${convId}`);
  });

  // receive a single op (client emits op objects)
  socket.on('sendOp', async ({ convId, op }) => {
    try {
      let conv = await conversationModel.findOne({ convId });
      if (!conv) conv = new conversationModel({ convId, ops: [], cachedMessages: {} });

      // dedupe
      const exists = conv.ops.some(o => o.opId === op.opId);
      if (!exists) conv.ops.push(op);

      conv.ops.sort((a,b) => compare(a,b));
      // apply ops to compute messages
      const messages = (function applyOpsToState(ops) {
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
      })(conv.ops);

      conv.cachedMessages = messages.reduce((acc,m)=> { acc[m.id]=m; return acc; }, {});
      await conv.save();

      // broadcast canonical messages & ops to the room
      io.to(convId).emit('opsUpdate', { ops: conv.ops, messages });
    } catch (err) {
      console.error('sendOp error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
  });
});

// DB + start
const MONGO = process.env.MONGO ;
mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('mongo connected');
    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => console.log('server listening on', PORT));
  })
  .catch(err => { console.error(err); process.exit(1); });
