// Performance profiles + benchmark maths for the local Feed library run.
import assert from 'assert';
import { imp } from './harness.mjs';
const P = await imp('modules/libraryPresets.js');

assert.equal(P.presetOf({ libraryBatch: 20, requestsPerTick: 3, autoProcessMinutes: 30 }), 'balanced');
assert.equal(P.presetOf({ libraryBatch: 10, requestsPerTick: 1, autoProcessMinutes: 60 }), 'eco');
assert.equal(P.presetOf({ libraryBatch: 40, requestsPerTick: 6, autoProcessMinutes: 15 }), 'power');
assert.equal(P.presetOf({ libraryBatch: 40, requestsPerTick: 3, autoProcessMinutes: 15 }), 'custom', 'a hand-changed mix is custom');
assert.equal(P.presetOf({}), 'balanced', 'defaults are the balanced profile');
assert.deepEqual(P.presetSettings('power'), { libraryBatch: 40, requestsPerTick: 6, autoProcessMinutes: 15 });
assert.equal(P.presetSettings('custom'), null);
assert.equal(P.cleanRequests(5), 3, 'unknown request counts fall back to the default');
assert.equal(P.cleanRequests(6), 6);

// Classes and projections from a measured 20-item batch.
assert.equal(P.classOf(6), 'power'); assert.equal(P.classOf(30), 'balanced'); assert.equal(P.classOf(100), 'eco'); assert.equal(P.classOf(400), 'slow');
const pr = P.projection(10, 'balanced');
assert.equal(pr.tickSec, 30, '3 requests x 10 s at batch 20');
assert.equal(pr.itemsPerHour, 120, '3 x 20 items every 30 min');
assert.equal(P.projection(10, 'power').tickSec, 120, 'batch 40 takes about twice as long per request: 6 x 20 s');
assert.equal(P.recommend(5), 'power'); assert.equal(P.recommend(10), 'power', 'a 2 min run is the limit'); assert.equal(P.recommend(15), 'balanced'); assert.equal(P.recommend(60), 'eco');
assert.equal(P.recommend(500), 'eco', 'even when nothing fits, the gentlest profile is the answer');
assert.equal(P.benchItems().length, P.BENCH_COUNT);
assert(P.benchItems().every(i => i.title && i.id));
console.log('ok');
