import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeCapacity,
  describeDurability,
  parseReplication,
  readTopology,
  topologyNeedsAttention,
  type RawTopology,
} from '../src/lib/object-topology.ts';

// The EXACT shape the deployed store returned on 2026-08-05, so the parser is tested against reality
// rather than against my idea of the format.
const LIVE: RawTopology = {
  Topology: {
    Max: 130,
    Free: 109,
    DataCenters: [
      {
        Id: 'DefaultDataCenter',
        Racks: [
          { Id: 'DefaultRack', DataNodes: [{ Url: '192.168.117.4:8080', Volumes: 21, EcShards: 0, Max: 130 }] },
        ],
      },
    ],
    Layouts: [
      { replication: '000', collection: 'media', diskType: 'hdd' },
      { replication: '000', collection: '', diskType: 'hdd' },
      { replication: '000', collection: 'provit', diskType: 'hdd' },
    ],
  },
  Version: '30GB 3.80 7b3c0e937',
};

test('THE REAL DEPLOYMENT HAS ONE COPY OF EVERY FILE, and the surface must say so', () => {
  // The capability gap was that the console only PROBED the endpoint — it could say the store was up,
  // which is the least interesting thing about it. The operator's question is "if a disk dies, what do
  // I lose?" and on this deployment the answer is everything on that disk.
  const view = readTopology(LIVE);
  assert.equal(view.risk, 'no-redundancy');
  assert.equal(view.replication?.copies, 1);
  assert.match(describeDurability(view), /ONE copy of every file/);
  assert.match(describeDurability(view), /that file is gone/);
  // And it must be surfaced as something to act on, not rendered as a green tick.
  assert.equal(topologyNeedsAttention(view), true);
});

test('the real report parses into the real numbers', () => {
  const view = readTopology(LIVE);
  assert.equal(view.dataCentres, 1);
  assert.equal(view.racks, 1);
  assert.equal(view.nodes.length, 1);
  assert.equal(view.volumesUsed, 21);
  assert.equal(view.volumesMax, 130);
  assert.equal(view.volumesFree, 109);
  assert.equal(view.version, '30GB 3.80 7b3c0e937');
});

test('THE WEAKEST replication governs, so one exposed collection cannot hide behind a safe one', () => {
  const mixed = readTopology({
    ...LIVE,
    Topology: {
      ...LIVE.Topology,
      Layouts: [{ replication: '200' }, { replication: '000' }, { replication: '010' }],
    },
  });
  assert.equal(mixed.replication?.code, '000');
  assert.equal(mixed.risk, 'no-redundancy');
});

test('replication is PARSED, so an unfamiliar code is read rather than assumed safe', () => {
  assert.deepEqual(parseReplication('000'), { code: '000', copies: 1, otherDataCentres: 0, otherRacks: 0, sameRack: 0 });
  assert.deepEqual(parseReplication('001'), { code: '001', copies: 2, otherDataCentres: 0, otherRacks: 0, sameRack: 1 });
  assert.equal(parseReplication('010')?.copies, 2);
  assert.equal(parseReplication('200')?.copies, 3);
  // Anything that is not a three-digit code is null, and null becomes UNKNOWN — never "safe".
  for (const bad of ['', 'abc', '00', '0000', 'xyz']) assert.equal(parseReplication(bad), null);
});

test('UNKNOWN durability is stated as unknown, never as confirmed safe', () => {
  const view = readTopology({ Topology: { Layouts: [{ replication: 'garbage' }] } });
  assert.equal(view.risk, 'unknown');
  assert.match(describeDurability(view), /UNKNOWN — not confirmed safe/);
  assert.equal(topologyNeedsAttention(view), true);
});

test('erasure coding IS redundancy the replication code does not show', () => {
  // One replica plus EC shards survives a disk loss. Calling that "no redundancy" would send an
  // operator chasing a problem they do not have.
  const ec = readTopology({
    Topology: {
      Max: 10, Free: 5,
      DataCenters: [{ Racks: [{ DataNodes: [{ Url: 'n1', Volumes: 5, Max: 10, EcShards: 14 }] }] }],
      Layouts: [{ replication: '000' }],
    },
  });
  assert.equal(ec.erasureCoded, true);
  assert.equal(ec.risk, 'same-rack-only');
  assert.match(describeDurability(ec), /can be repaired/);
});

test('rack and site redundancy are described as what they survive', () => {
  const racks = readTopology({ Topology: { Layouts: [{ replication: '010' }] } });
  assert.equal(racks.risk, 'across-racks');
  assert.match(describeDurability(racks), /losing one rack does not lose data/);

  const sites = readTopology({ Topology: { Layouts: [{ replication: '100' }] } });
  assert.equal(sites.risk, 'across-sites');
  assert.match(describeDurability(sites), /losing a whole site does not lose data/);
  assert.equal(topologyNeedsAttention(sites), false);
});

test('A FULL STORE IS AN OUTAGE THAT REPORTS AS HEALTHY', () => {
  // Running out of volume slots stops WRITES while every liveness check still passes. That is the
  // outage nobody expects, so the sentence has to name it.
  const full = readTopology({
    Topology: {
      Max: 10, Free: 0,
      DataCenters: [{ Racks: [{ DataNodes: [{ Url: 'n', Volumes: 10, Max: 10, EcShards: 0 }] }] }],
      Layouts: [{ replication: '010' }],
    },
  });
  assert.match(describeCapacity(full), /new files will be REFUSED even though the store is running/);
  assert.equal(topologyNeedsAttention(full), true);

  const nearly = readTopology({
    Topology: {
      Max: 10, Free: 1,
      DataCenters: [{ Racks: [{ DataNodes: [{ Url: 'n', Volumes: 9, Max: 10, EcShards: 0 }] }] }],
      Layouts: [{ replication: '010' }],
    },
  });
  assert.match(describeCapacity(nearly), /Nearly full/);
  assert.equal(topologyNeedsAttention(nearly), true);
});

test('an empty or unreadable report does not throw or invent numbers', () => {
  const empty = readTopology({});
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.risk, 'unknown');
  assert.match(describeCapacity(empty), /could not be read/);
  assert.equal(readTopology({ Topology: {} }).volumesMax, 0);
});
