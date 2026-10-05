// M24 set alignments (Normal) from a BE DB: setAlign(db, setl) -> [{poso, epos, x, y, stance(anm), dir}]
export function makeSetReader(db) {
  const f32 = u => { const b = Buffer.alloc(4); b.writeUInt32BE(u >>> 0); return +b.readFloatBE(0).toFixed(3); };
  const setp = new Map(); for (const r of db.SETP.rows) { if (!setp.has(r.SETL)) setp.set(r.SETL, []); setp.get(r.SETL).push(r); }
  const sgff = new Map(db.SGFF.rows.map(r => [r.SGF_, r]));
  const setg = new Map(); for (const r of db.SETG.rows) { if (!setg.has(r.SETP)) setg.set(r.SETP, []); setg.get(r.SETP).push(r); }
  return function setAlign(setl, pkg = "Norm") {
    return (setp.get(setl) || []).map(p => {
      const g = (setg.get(p.SETP) || []).find(g => sgff.get(g.SGF_)?.name === pkg);
      return { poso: p.poso, epos: p.EPos, dpos: p.DPos, x: g ? f32(g.x___) : null, y: g ? f32(g.y___) : null, anm: g?.anm_, dir: g?.dir_ };
    }).sort((a, b) => a.poso - b.poso);
  };
}
export const EPOS = ["QB","HB","FB","WR","TE","LT","LG","C","RG","RT"];
