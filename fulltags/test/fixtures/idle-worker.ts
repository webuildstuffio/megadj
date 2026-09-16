// idle-worker.ts — test fixture for analysis-worker.test.ts (#189).
// A worker that never announces ready and never exits: proves the kit's
// handshake-failure path (openWorkerSession → null, process reaped).
setInterval(() => {}, 1000);
