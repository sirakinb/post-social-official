// A minimal, valid MP4 built in code for tests: just the boxes that describe one video
// track (width, height, length) plus one empty sample. Real players can't show it, but
// mediainfo reads it like any MP4, and it needs no fixture file.
const box = (type: string, ...parts: Uint8Array[]) => {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(new TextEncoder().encode(type), 4);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const u32 = (...values: number[]) => {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
  return out;
};
const u16 = (...values: number[]) => {
  const out = new Uint8Array(values.length * 2);
  values.forEach((v, i) => new DataView(out.buffer).setUint16(i * 2, v));
  return out;
};
const bytes = (n: number) => new Uint8Array(n);
const text = (s: string) => new TextEncoder().encode(s);
const MATRIX = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

export function tinyMp4({ width = 640, height = 360, seconds = 2 } = {}): Uint8Array {
  const timescale = 1000;
  const duration = seconds * timescale;
  const mdatPayload = bytes(16);
  const ftyp = box("ftyp", text("isom"), u32(0x200), text("isomiso2avc1mp41"));
  const avc1 = box("avc1", bytes(6), u16(1), bytes(16), u16(width, height), u32(0x480000, 0x480000, 0), u16(1), bytes(32), u16(0x18, 0xffff),
    box("avcC", new Uint8Array([1, 0x42, 0xc0, 0x1e, 0xff, 0xe0, 0x00])));
  const stbl = (chunkOffset: number) => box("stbl",
    box("stsd", u32(0, 1), avc1),
    box("stts", u32(0, 1, 1, duration)),
    box("stsc", u32(0, 1, 1, 1, 1)),
    box("stsz", u32(0, mdatPayload.length, 1)),
    box("stco", u32(0, 1, chunkOffset)));
  const moov = (chunkOffset: number) => box("moov",
    box("mvhd", u32(0, 0, 0, timescale, duration, 0x10000), u16(0x100), bytes(10), MATRIX, bytes(24), u32(2)),
    box("trak",
      box("tkhd", u32(3, 0, 0, 1, 0, duration), bytes(8), u16(0, 0, 0), u16(0), MATRIX, u32(width << 16, height << 16)),
      box("mdia",
        box("mdhd", u32(0, 0, 0, timescale, duration), u16(0x55c4, 0)),
        box("hdlr", u32(0, 0), text("vide"), bytes(12), text("Video\0")),
        box("minf",
          box("vmhd", u32(1), bytes(8)),
          box("dinf", box("dref", u32(0, 1), box("url ", u32(1)))),
          stbl(chunkOffset)))));
  const moovLength = moov(0).length;
  const chunkOffset = ftyp.length + moovLength + 8; // mdat payload starts after its header
  const parts = [ftyp, moov(chunkOffset), box("mdat", mdatPayload)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
