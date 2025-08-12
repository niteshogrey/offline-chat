const mongoose = require('mongoose');

const OperationSchema = new mongoose.Schema({
  opId: { type: String, required: true, unique: true },
  type: { type: String, enum: ['create','edit','delete'], required: true },
  messageId: { type: String, required: true },
  content: { type: String },
  clientId: { type: String, required: true },
  lamport: { type: Number, required: true }
}, { _id: false });

const ConversationSchema = new mongoose.Schema({
  convId: { type: String, required: true, unique: true },
  ops: { type: [OperationSchema], default: [] },
  cachedMessages: { type: Object, default: {} }
});

const conversationModel = mongoose.model('Conversation', ConversationSchema);

module.exports = conversationModel
