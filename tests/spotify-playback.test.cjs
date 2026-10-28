const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaybackMonitor } = require('../spotify-playback.js');

test('a Pause icon alone never confirms audio playback; real progress confirms it', () => {
	const m = createPlaybackMonitor();
	assert.equal(m.sample({ state: 'playing', position: 0, now: 0 }), 'buffering');
	assert.equal(m.sample({ state: 'playing', position: 0, now: 5000 }), 'buffering');
	assert.equal(m.sample({ state: 'playing', position: 0, now: 12000 }), 'stalled');
	assert.equal(m.sample({ state: 'playing', position: 1000, now: 13000 }), 'playing');
});

test('a mid-song stall is detected, and resuming real progress recovers without a new track', () => {
	const m = createPlaybackMonitor();
	m.sample({ state: 'playing', position: 5000, now: 0 });
	assert.equal(m.sample({ state: 'playing', position: 6000, now: 1000 }), 'playing');
	assert.equal(m.sample({ state: 'playing', position: 6000, now: 12000 }), 'playing');
	assert.equal(m.sample({ state: 'playing', position: 6000, now: 13000 }), 'stalled');
	assert.equal(m.sample({ state: 'playing', position: 7000, now: 14000 }), 'playing');
	assert.equal(m.sample({ state: 'paused', position: 7000, now: 15000 }), 'paused');
	assert.equal(m.sample({ state: 'playing', position: 7000, now: 16000 }), 'buffering');
});

test('seeking does not fake playback, and reaching the end is not a stalled song to restart', () => {
	const m = createPlaybackMonitor();
	m.sample({ state: 'playing', position: 0, now: 0 });
	assert.equal(m.sample({ state: 'playing', position: 120000, now: 1000 }), 'buffering');
	assert.equal(m.sample({ state: 'playing', position: 121000, duration: 122000, now: 2000 }), 'playing');
	assert.equal(m.sample({ state: 'playing', position: 122000, duration: 122000, now: 3000 }), 'ended');
	m.reset();
	assert.equal(m.sample({ state: 'playing', position: null, now: 4000 }), 'buffering');
	assert.equal(m.sample({ state: 'playing', position: null, now: 16000 }), 'stalled');
});

test('natural completion is detected when Spotify pauses and resets a coarse progress slider to zero', () => {
	const m = createPlaybackMonitor();
	m.sample({ state: 'playing', position: 160000, duration: 167580, now: 0 });
	m.sample({ state: 'playing', position: 165000, duration: 167580, now: 5000 });
	assert.equal(m.sample({ state: 'paused', position: 0, duration: 167580, now: 7580 }), 'ended');
	assert.equal(m.sample({ state: 'paused', position: 0, duration: 167580, now: 8000 }), 'ended', 'metadata samples retain the terminal state');
	m.reset(); assert.equal(m.sample({ state: 'playing', position: 0, duration: 167580, now: 9000 }), 'buffering');
});

test('the last half-second is not skipped, and pausing or seeking near the end does not invent completion', () => {
	const m = createPlaybackMonitor();
	m.sample({ state: 'playing', position: 9500, duration: 10000, now: 0 });
	assert.equal(m.sample({ state: 'playing', position: 9600, duration: 10000, now: 100 }), 'playing');
	assert.equal(m.sample({ state: 'paused', position: 9600, duration: 10000, now: 500 }), 'paused');
	m.sample({ state: 'playing', position: 5000, duration: 10000, now: 1000 });
	m.sample({ state: 'playing', position: 6000, duration: 10000, now: 2000 });
	assert.equal(m.sample({ state: 'paused', position: 0, duration: 10000, now: 2100 }), 'paused', 'a seek to EOF is not elapsed playback');
});

test('one-second monitoring does not mistake five-second slider updates for seeking', () => {
	const m = createPlaybackMonitor();
	for (let second = 0; second < 5; second++) m.sample({ state: 'playing', position: 160000, duration: 167580, now: second * 1000 });
	assert.equal(m.sample({ state: 'playing', position: 165000, duration: 167580, now: 5000 }), 'playing');
	m.sample({ state: 'playing', position: 165000, duration: 167580, now: 6000 });
	m.sample({ state: 'playing', position: 165000, duration: 167580, now: 7000 });
	assert.equal(m.sample({ state: 'paused', position: 0, duration: 167580, now: 7580 }), 'ended');
});
