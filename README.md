Run instructions
Start MongoDB locally (or point MONGO env var).

Server:

cd server

npm install

npm run dev (or npm start)

Client:

cd client

npm install

npm run dev

Open two tabs:

http://localhost:5173/?user=Alice

http://localhost:5173/?user=Bob

Test offline flow:

In browser DevTools, set network to Offline.

Send messages and perform edits/deletes — they’ll persist locally.

Turn network back Online — the client will auto-flush outbox and messages will appear in the other tab.
