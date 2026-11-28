import assert from 'node:assert/strict';
import { competitionPhoto } from '../../app/src/main/assets/photo.js';
import { photoPayload } from '../../app/src/main/assets/profile-api.js';

function riff(chunks) {
  const records = chunks.map(([name, payload]) => {
    const bytes = Buffer.from(payload);
    const header = Buffer.alloc(8);
    header.write(name, 0);
    header.writeUInt32LE(bytes.length, 4);
    return Buffer.concat([header, bytes, Buffer.alloc(bytes.length % 2)]);
  });
  const body = Buffer.concat([Buffer.from('WEBP'), ...records]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export async function run({ check }) {
  // The canvas encoder is a platform boundary. Inspect the bytes returned by the real metadata stripper.
  const canvas = window.HTMLCanvasElement.prototype,
    getContext = canvas.getContext,
    encode = canvas.toBlob;
  const image = globalThis.Image,
    reader = globalThis.FileReader;
  let encoded, drawing;
  globalThis.Image = class {
    naturalWidth = 800;
    naturalHeight = 400;
    set src(value) {
      assert.ok(value.startsWith('blob:'));
      queueMicrotask(() => this.onload());
    }
  };
  canvas.getContext = function () {
    return {
      fillRect() {},
      drawImage: (_, x, y, w, h) => {
        drawing = [x, y, w, h];
      },
    };
  };
  canvas.toBlob = function (done, type) {
    done(new Blob([encoded], { type }));
  };
  globalThis.FileReader = window.FileReader;
  try {
    for (const length of [3, 4])
      for (const meta of ['none', 'before', 'after', 'both']) {
        await check('strip-metadata/' + length + '/' + meta, async () => {
          const frame = Buffer.from([4, 3, 2, 1]).subarray(0, length);
          const chunks = [['VP8 ', frame]];
          if (meta === 'before' || meta === 'both') chunks.unshift(['ICCP', 'PRIVATE profile']);
          if (meta === 'after' || meta === 'both') chunks.push(['EXIF', 'PRIVATE location']);
          encoded = riff(chunks);
          const output = await competitionPhoto(new Blob(['local photo']), 320);
          assert.deepEqual(drawing, [0, 0, 320, 160]);
          assert.equal(output.type, 'image/webp');
          assert.deepEqual(Buffer.from(await output.arrayBuffer()), riff([['VP8 ', frame]]));
        });
      }
    for (const kind of ['magic', 'truncated', 'no-frame']) {
      await check('reject-encoder/' + kind, async () => {
        encoded = riff([[kind === 'no-frame' ? 'EXIF' : 'VP8 ', 'payload']]);
        if (kind === 'magic') encoded[0] = 0;
        if (kind === 'truncated') encoded = encoded.subarray(0, encoded.length - 3);
        await assert.rejects(competitionPhoto(new Blob(['input']), 64), /WebP/);
      });
    }
    for (const [label, lengths, expected] of [
      ['exact', [8], [320]],
      ['shrink', [9, 10, 8], [320, 256, 204]],
      ['too-large', [20], [128]],
    ]) {
      await check('bridge-size/' + label, async () => {
        const edges = [];
        const pending = photoPayload(new Blob(['input']), expected[0], 8, async (_file, edge) => {
          edges.push(edge);
          return new window.Blob([new Uint8Array(lengths[edges.length - 1])], { type: 'image/jpeg' });
        });
        if (label === 'too-large') await assert.rejects(pending, /photo/);
        else assert.deepEqual(Buffer.from(await pending, 'base64'), Buffer.alloc(8));
        assert.deepEqual(edges, expected);
      });
    }
    await check('renewal/carries-owner-epoch', async () => {
      const previous = window.Device.subjectId;
      const key = 'journal.sync.v1.photo-fixture.epoch';
      const calls = [];
      try {
        window.Device.subjectId = () => 'photo-fixture';
        localStorage.setItem(key, 'current-consent');
        localStorage.setItem('journal.sync.v1.photo-fixture.enabled', '1');
        window.Device.profileRequest = (id, op, body) => {
          calls.push([op, JSON.parse(body)]);
          window.profileReply(id, 200, { renewed: true });
        };
        const { photoRequest } = await import('../../app/src/main/assets/journal-sync.js?photo-contract');
        assert.deepEqual(await photoRequest('photo_renew', { id: 'photo', cycle: 2 }), { renewed: true });
        assert.deepEqual(calls, [
          ['journal_sync', { op: 'photo_renew', args: { epoch: 'current-consent', id: 'photo', cycle: 2 } }],
        ]);
      } finally {
        window.Device.subjectId = previous;
        localStorage.removeItem(key);
        localStorage.removeItem('journal.sync.v1.photo-fixture.enabled');
      }
    });
  } finally {
    globalThis.Image = image;
    globalThis.FileReader = reader;
    canvas.getContext = getContext;
    canvas.toBlob = encode;
  }
}
