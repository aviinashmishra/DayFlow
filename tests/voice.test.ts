// Run with: npm test   (Node 22+ runs this TypeScript directly)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterWake, looksLikeStory, stripEnd } from '../lib/voice.ts';

test('wake phrase: the words after it are the task', () => {
  assert.equal(afterWake('Hey Dayflow fix the login crash'), 'fix the login crash');
  assert.equal(afterWake('hey day flow, send the invoice by Friday'), 'send the invoice by Friday');
  assert.equal(afterWake('okay they flow call the vendor'), 'call the vendor');
  assert.equal(afterWake('Hey Defs plan the offsite'), 'plan the offsite');
  assert.equal(afterWake('हे डेफ्लो कल वेंडर को कॉल करना है'), 'कल वेंडर को कॉल करना है');
});

test('wake phrase: chatter before it is dropped, and just the name waits for more', () => {
  assert.equal(afterWake('so anyway I told him hey Dayflow review the deck'), 'review the deck');
  assert.equal(afterWake('Hey Dayflow'), '');
  assert.equal(afterWake('hey dayflow.'), '');
});

test('wake phrase: ordinary speech does not trigger it', () => {
  assert.equal(afterWake('the day flows by so fast'), null);
  assert.equal(afterWake('hey David can you check this'), null);
  assert.equal(afterWake('dayflow is a nice app'), null);
  assert.equal(afterWake('they flowed into the room'), null);
});

test('closing phrase ends the recording and is removed', () => {
  assert.deepEqual(stripEnd('fix the login crash that\'s it'), { text: 'fix the login crash', ended: true });
  assert.deepEqual(stripEnd('send invoice, bas itna'), { text: 'send invoice', ended: true });
  assert.deepEqual(stripEnd('mark login crash as done'), { text: 'mark login crash as done', ended: false });
});

test('story detection: single tasks stay with the local parser', () => {
  assert.equal(looksLikeStory('Fix checkout bug, urgent, by Friday'), false);
  assert.equal(looksLikeStory('mark login crash as done'), false);
  assert.equal(looksLikeStory('Fix login crash urgent in progress next task Send invoice by Friday next task Design review blocked by missing specs'), false);
});

test('story detection: a narrated day goes to Gemini', () => {
  assert.equal(looksLikeStory('This morning I fixed the login crash and sent the invoice to Acme, now I am working on the pricing page and tomorrow I need to call the vendor'), true);
  assert.equal(looksLikeStory('aaj maine login bug fix kar diya, abhi pricing page pe kaam kar raha hoon, kal vendor ko call karna hai'), true);
  assert.equal(looksLikeStory('I finished the report. Then I reviewed Priya\'s PR. Also need to book flights.'), true);
});
