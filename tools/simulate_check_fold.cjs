#!/usr/bin/env node
const { io } = require('socket.io-client');

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';

function delay(ms){ return new Promise(r=>setTimeout(r, ms)); }

(async function(){
  console.log('Starting check/fold simulation...');

  const a = io(BACKEND, { auth: { username: 'SimA' } });
  const b = io(BACKEND, { auth: { username: 'SimB' } });

  await Promise.all([new Promise(r=>a.once('connect', r)), new Promise(r=>b.once('connect', r))]);
  console.log('connected', a.id, b.id);

  a.emit('createTable', { name: 'sim-check', maxPlayers: 2 });
  await delay(400);

  a.emit('getTables', null, (tables) => {
    const tableId = tables[0].id;
    a.emit('joinTable', { tableId });
    b.emit('joinTable', { tableId });
    console.log('joined', tableId);
  });

  a.on('gameState', async (s) => {
    // attempt to check if it's our turn
    const myPos = s.players.find(p => p.id === a.id)?.position;
    if (myPos === s.currentPlayer) {
      console.log('A attempts CHECK');
      a.emit('gameAction', { tableId: s.id, action: 'check' });
      await delay(200);
      console.log('A attempts FOLD');
      a.emit('gameAction', { tableId: s.id, action: 'fold' });
    }
  });

  b.on('gameState', async (s) => {
    const myPos = s.players.find(p => p.id === b.id)?.position;
    if (myPos === s.currentPlayer) {
      console.log('B attempts CHECK');
      b.emit('gameAction', { tableId: s.id, action: 'check' });
      await delay(200);
      console.log('B attempts FOLD');
      b.emit('gameAction', { tableId: s.id, action: 'fold' });
    }
  });

  await delay(8000);
  a.disconnect(); b.disconnect();
  console.log('done');
  process.exit(0);
})();
