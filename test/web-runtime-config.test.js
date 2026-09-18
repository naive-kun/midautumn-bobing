import test from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl, resolveRoomServer } from '../web/runtime-config.js';

const local = { protocol: 'http:', host: 'localhost:5178' };
const pages = { protocol: 'https:', host: 'example.github.io' };

test('Pages public assets stay under the repository base', () => {
  assert.equal(assetUrl('models/bowl.glb', '/bobing/'), '/bobing/models/bowl.glb');
  assert.equal(assetUrl('/audio/ceramic-1.wav', '/bobing'), '/bobing/audio/ceramic-1.wav');
  assert.equal(assetUrl('', '/bobing/'), '/bobing/');
  assert.equal(assetUrl('models/die.glb', '/'), '/models/die.glb');
});

test('production never derives a WebSocket address from github.io', () => {
  assert.deepEqual(resolveRoomServer({ isProduction: true, location: pages }), {
    url: null, error: '联机服务尚未配置', reason: 'missing',
  });
  assert.equal(resolveRoomServer({ configuredUrl: '  ', isProduction: true, location: pages }).url, null);
});

test('development keeps same-origin proxy and production accepts explicit WSS', () => {
  assert.equal(resolveRoomServer({ location: local }).url, 'ws://localhost:5178/ws');
  assert.equal(resolveRoomServer({ location: pages }).url, 'wss://example.github.io/ws');
  assert.equal(resolveRoomServer({ configuredUrl: 'wss://room.example.test/ws', isProduction: true, location: pages }).url, 'wss://room.example.test/ws');
});

test('invalid or insecure production endpoints cannot start a connection', () => {
  for (const configuredUrl of ['/ws', 'https://room.example.test/ws', 'ws://room.example.test/ws', 'wss://user:secret@room.example.test/ws', 'wss://room.example.test/ws#fragment']) {
    assert.equal(resolveRoomServer({ configuredUrl, isProduction: true, location: pages }).url, null);
  }
});
