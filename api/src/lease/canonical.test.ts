import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize } from './canonical';

test('canonicalize: primitive types', () => {
  assert.equal(canonicalize(null), 'null');
  assert.equal(canonicalize(undefined), 'null');
  assert.equal(canonicalize(123), '123');
  assert.equal(canonicalize(true), 'true');
  assert.equal(canonicalize(false), 'false');
  assert.equal(canonicalize('hello'), '"hello"');
});

test('canonicalize: sorts object keys deterministically', () => {
  const a = { z: 1, a: 2, m: 3 };
  const b = { a: 2, m: 3, z: 1 };
  assert.equal(canonicalize(a), '{"a":2,"m":3,"z":1}');
  assert.equal(canonicalize(a), canonicalize(b));
});

test('canonicalize: ignores undefined properties in objects', () => {
  const a = { a: 1, b: undefined, c: 3 };
  assert.equal(canonicalize(a), '{"a":1,"c":3}');
});

test('canonicalize: handles arrays preserving order', () => {
  const arr = [3, 1, 2];
  assert.equal(canonicalize(arr), '[3,1,2]');
});

test('canonicalize: nested structures', () => {
  const obj1 = {
    user: { id: 'u1', name: 'Ravi' },
    tags: ['admin', 'gym'],
  };
  const obj2 = {
    tags: ['admin', 'gym'],
    user: { name: 'Ravi', id: 'u1' },
  };
  assert.equal(canonicalize(obj1), canonicalize(obj2));
  assert.equal(canonicalize(obj1), '{"tags":["admin","gym"],"user":{"id":"u1","name":"Ravi"}}');
});

test('canonicalize: ignores functions and symbols and handles shared references and cycles', () => {
  const shared = { x: 1 };
  const dag = { a: shared, b: shared, fn: () => {}, sym: Symbol('test') };
  assert.equal(canonicalize(dag), '{"a":{"x":1},"b":{"x":1}}');

  const cyclic: any = { id: 1 };
  cyclic.self = cyclic;
  assert.throws(() => canonicalize(cyclic), TypeError);
});
