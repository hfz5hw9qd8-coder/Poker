#!/usr/bin/env node
const { io } = require('socket.io-client');

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';

function delay(ms){ return new Promise(r=>setTimeout(r, ms)); }

(async function(){
  console.log('Starting headless simulation...');

  const a = io(BACKEND, { auth: { username: 'ClientA' } });
  const b = io(BACKEND, { auth: { username: 'ClientB' } });

  a.on('connect', ()=>console.log('A connected', a.id));
  b.on('connect', ()=>console.log('B connected', b.id));

  a.on('tableCreated', d=>console.log('A tableCreated', d));
  a.on('playerJoined', d=>console.log('A playerJoined', JSON.stringify(d)));
  b.on('playerJoined', d=>console.log('B playerJoined', JSON.stringify(d)));

  a.on('gameState', s=>console.log('A gameState', JSON.stringify(s)));
  b.on('gameState', s=>console.log('B gameState', JSON.stringify(s)));

  a.on('privateHand', p=>console.log('A privateHand', JSON.stringify(p)));
  b.on('privateHand', p=>console.log('B privateHand', JSON.stringify(p)));

  a.on('handComplete', h=>console.log('A handComplete', JSON.stringify(h)));
  b.on('handComplete', h=>console.log('B handComplete', JSON.stringify(h)));

  await new Promise(res => a.once('connect', res));
  await new Promise(res => b.once('connect', res));

  // A creates table
  a.emit('createTable', { name: 'table-sim', maxPlayers: 2 });

  // wait for table creation and then get tables
  await delay(500);

  // get tables via A
  a.emit('getTables', null, (tables) => {
    console.log('getTables callback, count=', tables.length);
    if (tables.length === 0) return;
    const tableId = tables[0].id;
    console.log('Joining tableId', tableId);
    a.emit('joinTable', { tableId });
    b.emit('joinTable', { tableId });
  });

  // wait for game start
  await delay(2000);

  // After game starts, perform some actions: call / fold etc by active player
  a.on('gameState', async (s) => {
    // if currentPlayer corresponds to A or B we attempt to call
    try {
      const cp = s.currentPlayer;
      const meApos = s.players.find(p=>p.username==='ClientA')?.position;
      const meBpos = s.players.find(p=>p.username==='ClientB')?.position;
      if (cp === meApos) {
        console.log('A taking action: call');
        a.emit('gameAction', { tableId: s.id, action: 'call' });
      } else if (cp === meBpos) {
        console.log('B taking action: call');
        b.emit('gameAction', { tableId: s.id, action: 'call' });
      }
    } catch(e){}
  });

  // let simulation run a bit
  await delay(10000);

  a.disconnect();
  b.disconnect();
  console.log('Simulation finished');
  process.exit(0);
})();
