import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseJoinInput } from '../src/links.ts';

describe('parseJoinInput', () => {
  const cases: [string, { id: string; password: string | null } | null][] = [
    // full invite links
    ['https://chat.example.com/r/k7m2-qp4x#h3x9tw', { id: 'k7m2-qp4x', password: 'h3x9tw' }],
    ['http://localhost:3000/r/k7m2-qp4x#h3x9tw', { id: 'k7m2-qp4x', password: 'h3x9tw' }],
    ['https://chat.example.com/r/k7m2-qp4x', { id: 'k7m2-qp4x', password: null }],
    ['/r/K7M2-QP4X#H3X9TW', { id: 'k7m2-qp4x', password: 'h3x9tw' }],
    // typed by hand
    ['k7m2-qp4x', { id: 'k7m2-qp4x', password: null }],
    ['K7M2QP4X', { id: 'k7m2-qp4x', password: null }],
    ['  k7m2-qp4x  ', { id: 'k7m2-qp4x', password: null }],
    ['k7m2-qp4x h3x9tw', { id: 'k7m2-qp4x', password: 'h3x9tw' }],
    ['k7m2-qp4x#h3x9tw', { id: 'k7m2-qp4x', password: 'h3x9tw' }],
    // word names
    ['https://chat.example.com/r/limon3#h3x9tw', { id: 'limon3', password: 'h3x9tw' }],
    ['/r/Lemon42', { id: 'lemon42', password: null }],
    ['limon3', { id: 'limon3', password: null }],
    ['LİMON3', { id: 'limon3', password: null }],
    ['Limon 3', { id: 'limon3', password: null }],
    ['limon 3 h3x9tw', { id: 'limon3', password: 'h3x9tw' }],
    ['limon-3#h3x9tw', { id: 'limon3', password: 'h3x9tw' }],
    ['pancake3', { id: 'pancake3', password: null }],
    // not a room
    ['', null],
    ['hello', null],
    ['3limon', null],
    ['limon', null],
    ['k7m2-qp4', null],
    ['k7m2-qp4x9', null],
    ['https://example.com/somewhere', null],
  ];

  for (const [input, expected] of cases) {
    test(JSON.stringify(input), () => assert.deepEqual(parseJoinInput(input), expected));
  }
});
