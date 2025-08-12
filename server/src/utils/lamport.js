// deterministic comparator used by server & (mirrored in client)
module.exports = {
  compare: (a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport;
    if (a.clientId !== b.clientId) return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
    if (a.opId !== b.opId) return a.opId < b.opId ? -1 : 1;
    return 0;
  }
};
