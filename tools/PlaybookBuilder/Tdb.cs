using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace PlaybookBuilder
{
    // EA "DB" (TDB) tables inside a Madden 27 FBCHUNKS save. Port of tools/tdb.mjs + tools/tdbcrc.mjs.
    public sealed class TdbTable
    {
        public string Name;
        public int Start, DataStart, RecordBytes, MaxRecords;
        public List<(int Type, int BitOffset, string Name, int Bits)> Fields = new List<(int, int, string, int)>();
        public List<Dictionary<string, long>> Rows = new List<Dictionary<string, long>>();
    }

    public static class Tdb
    {
        static readonly uint[] CrcTable = Enumerable.Range(0, 256).Select(n =>
        {
            uint c = (uint)n << 24;
            for (int k = 0; k < 8; k++) c = (c & 0x80000000) != 0 ? (c << 1) ^ 0x04c11db7 : c << 1;
            return c;
        }).ToArray();

        // CRC-32/MPEG-2: poly 04C11DB7, MSB-first, init FFFFFFFF, no final xor
        public static uint Crc(byte[] b, int from, int to)
        {
            uint c = 0xffffffff;
            for (int i = from; i < to; i++) c = CrcTable[((c >> 24) ^ b[i]) & 0xff] ^ (c << 8);
            return c;
        }

        static int U16(byte[] b, int p) => BitConverter.ToUInt16(b, p);
        static int U32(byte[] b, int p) => (int)BitConverter.ToUInt32(b, p);
        static void W16(byte[] b, int p, int v) { b[p] = (byte)v; b[p + 1] = (byte)(v >> 8); }
        static void W32(byte[] b, int p, uint v) { for (int i = 0; i < 4; i++) b[p + i] = (byte)(v >> (8 * i)); }

        public static int DbOffset(byte[] buf)
        {
            byte[] sig = { (byte)'D', (byte)'B', 0, 8 };
            for (int i = 0; i + 4 <= buf.Length; i++)
                if (buf[i] == sig[0] && buf[i + 1] == sig[1] && buf[i + 2] == sig[2] && buf[i + 3] == sig[3]) return i;
            throw new FormatException("not a playbook save (no DB header)");
        }

        public static Dictionary<string, TdbTable> Read(byte[] buf)
        {
            int db = DbOffset(buf), count = U32(buf, db + 16), p = db + 24;
            var index = new List<(string, int)>();
            for (int i = 0; i < count; i++, p += 8) index.Add((Encoding.ASCII.GetString(buf, p, 4), U32(buf, p + 4)));
            int dataStart = p + 4;
            var tables = new Dictionary<string, TdbTable>();
            foreach (var (name, offset) in index)
            {
                var t = new TdbTable { Name = name, Start = dataStart + offset };
                int q = t.Start;
                t.RecordBytes = U32(buf, q + 4);
                t.MaxRecords = U16(buf, q + 16);
                int records = U16(buf, q + 18), fieldCount = buf[q + 24];
                q += 36;
                for (int f = 0; f < fieldCount; f++, q += 16)
                    t.Fields.Add((U32(buf, q), U32(buf, q + 4), Encoding.ASCII.GetString(buf, q + 8, 4), U32(buf, q + 12)));
                t.DataStart = q;
                for (int r = 0; r < records; r++)
                {
                    int rec = q + r * t.RecordBytes;
                    if ((buf[rec + t.RecordBytes - 1] & 0x80) != 0) continue; // deleted row
                    var row = new Dictionary<string, long>();
                    foreach (var f in t.Fields) if (f.Type != 0) row[f.Name] = ReadBits(buf, rec, f.BitOffset, f.Bits);
                    t.Rows.Add(row);
                }
                tables[name] = t;
            }
            return tables;
        }

        // Rewrites one table in place (compacted, no deleted rows) and refreshes its two CRCs.
        public static void WriteTable(byte[] buf, TdbTable t, List<Dictionary<string, long>> rows)
        {
            if (rows.Count > t.MaxRecords) throw new InvalidOperationException($"{t.Name}: {rows.Count} rows exceeds capacity {t.MaxRecords}");
            Array.Clear(buf, t.DataStart, t.MaxRecords * t.RecordBytes);
            for (int r = 0; r < rows.Count; r++)
            {
                int rec = t.DataStart + r * t.RecordBytes;
                foreach (var f in t.Fields)
                {
                    if (f.Type == 0) throw new InvalidOperationException($"{t.Name}.{f.Name}: string fields not supported");
                    if (!rows[r].TryGetValue(f.Name, out long v)) throw new InvalidOperationException($"{t.Name}: row {r} missing {f.Name}");
                    WriteBits(buf, rec, f.BitOffset, f.Bits, v);
                }
            }
            W16(buf, t.Start + 18, rows.Count);
            W16(buf, t.Start + 20, 0);
            W16(buf, t.Start + 22, 0xffff);
            W32(buf, t.Start + 32, Crc(buf, t.Start, t.Start + 32));
            int end = t.DataStart + t.MaxRecords * t.RecordBytes;
            W32(buf, end, Crc(buf, t.Start + 36, end));
        }

        // Names of CRC slots whose stored value doesn't match (empty = valid save).
        public static List<string> BadCrcs(byte[] buf)
        {
            int db = DbOffset(buf), n = U32(buf, db + 16), idxEnd = db + 24 + n * 8;
            var slots = new List<(string, int, int, int)> { ("dbHeader", db + 20, db, db + 20), ("index", idxEnd, db + 24, idxEnd) };
            for (int i = 0; i < n; i++)
            {
                int p = db + 24 + i * 8, t = idxEnd + 4 + U32(buf, p + 4);
                string name = Encoding.ASCII.GetString(buf, p, 4);
                int data = t + 36 + buf[t + 24] * 16, end = data + U16(buf, t + 16) * U32(buf, t + 4);
                slots.Add((name + ".hdr", t + 32, t, t + 32));
                slots.Add((name + ".data", end, t + 36, end));
            }
            return slots.Where(s => s.Item2 + 4 > buf.Length || BitConverter.ToUInt32(buf, s.Item2) != Crc(buf, s.Item3, s.Item4)).Select(s => s.Item1).ToList();
        }

        // little-endian bit order: bit 0 is the LSB of byte 0
        static long ReadBits(byte[] b, int rec, int off, int bits)
        {
            long v = 0;
            for (int i = 0; i < bits; i++) { int bit = off + i; if (((b[rec + (bit >> 3)] >> (bit & 7)) & 1) != 0) v |= 1L << i; }
            return v;
        }

        static void WriteBits(byte[] b, int rec, int off, int bits, long v)
        {
            if (v < 0 || (bits < 63 && v >= 1L << bits)) throw new InvalidOperationException($"value {v} does not fit in {bits} bits");
            for (int i = 0; i < bits; i++)
            {
                int bit = off + i; byte mask = (byte)(1 << (bit & 7));
                if (((v >> i) & 1) != 0) b[rec + (bit >> 3)] |= mask; else b[rec + (bit >> 3)] &= (byte)~mask;
            }
        }
    }
}
