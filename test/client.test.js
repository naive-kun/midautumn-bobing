import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { RoomClient } from '../shared/client.js';

function storage(initial = '') {
  const values = new Map(initial ? [['bobing-token', initial]] : []);
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
}
function next(client, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { off(); reject(new Error(`Timeout waiting for ${event}`)); }, 5000);
    const off = client.on(event, data => { clearTimeout(timeout); off(); resolve(data); });
  });
}
async function setup(t) {
  const app = await createServer({ mysqlUrl: '' });
  const address = await app.listen(0, '127.0.0.1');
  const clients = [];
  t.after(async () => { clients.forEach(client => client.disconnect()); await app.close(); });
  return localStorage => {
    const client = new RoomClient({ url: `ws://127.0.0.1:${address.port}/ws`, storage: localStorage || storage(), socketFactory: url => new WebSocket(url) });
    clients.push(client); return client;
  };
}
test('actual shared client signs in without a token and sends valid clock pings', async t => {
  const make = await setup(t), client = make(), errors = [];
  client.on('error', error => errors.push(error));
  const welcome = next(client, 'welcome'), pong = next(client, 'pong');
  client.connect(); await welcome; await pong;
  await client.send('create', { name: '明月', rounds: 1 });
  assert.match(client.state.room.code, /^\d{6}$/);
  assert.equal(client.state.room.players[0].name, '明月');
  assert.equal(errors.length, 0);
  await client.send('leave'); assert.equal(client.state.room, null);
});
test('expired credentials recover to a fresh identity without an endless error loop', async t => {
  const make = await setup(t), old = '0'.repeat(64), localStorage = storage(old), client = make(localStorage);
  const welcome = next(client, 'welcome'); client.connect(); await welcome;
  assert.equal(client.state.connected, true);
  assert.match(localStorage.getItem('bobing-token'), /^[a-f0-9]{64}$/);
  assert.notEqual(localStorage.getItem('bobing-token'), old);
  assert.equal(client.state.room, null);
});
test('a session taken over by another window stops reconnecting itself', async t => {
  const make = await setup(t), localStorage = storage(), first = make(localStorage);
  let welcome = next(first, 'welcome'); first.connect(); await welcome;
  const second = make(localStorage); welcome = next(second, 'welcome');
  const closed = next(first, 'connection'); second.connect(); await welcome; await closed;
  assert.equal(first.closed, true);
  assert.equal(first.state.connected, false);
  assert.equal(second.state.connected, true);
  assert.equal(first.state.selfId, second.state.selfId);
});
