import test from 'node:test';
import assert from 'node:assert/strict';
import { clockAt, nextAction, deliveryText } from '../src/cloud-scheduler.mjs';
const at = time => new Date(`2026-09-08T${time}+08:00`);
const day = '2026-09-08';
test('Beijing midnight and 08:00 are independent of server timezone', () => {
  assert.deepEqual(clockAt(new Date('2026-09-07T16:00:00Z')), {day, minute:0});
  assert.deepEqual(clockAt(new Date('2026-09-08T00:00:00Z')), {day, minute:480});
});
test('prepares ahead, refreshes before eight, and never sends early', () => {
  assert.equal(nextAction(at('07:49:00'), {day}), 'idle');
  assert.equal(nextAction(at('07:50:00'), {day}), 'collect');
  const state = {day, lastAttempt:at('07:50:00').getTime(), candidate:{}};
  assert.equal(nextAction(at('07:56:00'), state), 'idle');
  assert.equal(nextAction(at('07:57:00'), state), 'collect');
  assert.equal(nextAction(at('08:00:00'), state), 'deliver');
});
test('restarts do not duplicate a sent or uncertain message', () => {
  for (const status of ['sent','pending','uncertain']) assert.equal(nextAction(at('08:01:00'), {day, delivery:{status}}), 'idle');
  assert.equal(nextAction(at('08:16:00'), {day}), 'idle');
});
test('yesterday, future and stale snapshots cannot become today report', () => {
  for (const candidate of [
    {day:'2026-09-07', checkedAt:at('07:59:00').getTime(),text:'old'},
    {day, checkedAt:at('07:40:00').getTime(),text:'stale'},
    {day, checkedAt:at('08:01:00').getTime(),text:'future'}
  ]) assert.equal(deliveryText(at('08:00:00'), {day,candidate}).kind, 'failure');
  assert.equal(deliveryText(at('08:00:00'), {day,candidate:{day, checkedAt:at('07:58:00').getTime(),text:'validated'}}).text, 'validated');
});
