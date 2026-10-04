import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generate,validate,derive,checkMesh,volume,projectJSON,parseProject,bounds} from '../src/geometry.js';
import {stl,kit,makeZip,fingerprint} from '../src/export.js';

const close=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} ≠ ${b}`);
const m=generate();
test('default: 10 working / 2 samples / 3 reference models',()=>{
  assert.equal(m.parts.filter(p=>p.printable).length,10);
  assert.equal(m.parts.filter(p=>p.sample).length,2);
  assert.equal(m.parts.length,15);assert.equal(m.stats.allFit,true);
});
test('all default meshes are closed, oriented and non-degenerate',()=>{
  for(const p of m.parts){const c=checkMesh(p.mesh);assert.equal(c.watertight,true,`${p.id}: ${JSON.stringify(c)}`);assert.ok(c.volume>0,p.id);}
});
test('master matches diameter, height and cavity volume',()=>{
  const p=m.parts.find(p=>p.id==='master');assert.deepEqual(p.bounds.size,[150,150,270]);
  const exact=Math.PI*(75**2*270-50**2*260);close(volume(p.mesh)/exact,1,.0005);
});
test('dimensions preserve the internal 10 mm silicone gap',()=>{
  close(m.d.co,40);close(m.d.ri-m.d.co,10);close(m.d.coreBottom-(m.d.base+m.p.masterBottom),10);
  close(m.d.roof-m.d.lip,5);
});
test('broad plate spans the complete shell diameter',()=>{
  const p=m.parts.find(p=>p.id==='plate-1');assert.deepEqual(p.bounds.size,[176,176,5]);
  assert.ok(p.mesh.flat().every(v=>Math.hypot(v[0],v[1])>=m.d.co+.249));
  const fullAnnulus=Math.PI*(m.d.so**2-(m.d.co+.25)**2)*5;
  assert.ok(volume(p.mesh)<fullAnnulus*.98,'four actual fill openings must remove volume');
});
test('closed snap bottom has no through vent',()=>{
  const p=m.parts.find(p=>p.id==='core-bottom');
  close(p.bounds.min[2],25);close(p.bounds.size[2],13);
  assert.ok(p.mesh.some(t=>t.every(v=>v[2]===25)&&t.some(v=>Math.hypot(v[0],v[1])<1e-6)));
  assert.equal(checkMesh(p.mesh).watertight,true);
});
test('snap coupon uses the same bottom mesh as production',()=>{
  const a=m.parts.find(p=>p.id==='core-bottom'),b=m.parts.find(p=>p.id==='test-bottom');
  // Absolute coordinates differ; normalised printable triangle coordinates match.
  const aa=new DataView(stl(a).buffer),bb=new DataView(stl(b).buffer);
  assert.equal(aa.byteLength,bb.byteLength);
  for(let offset=84;offset<aa.byteLength;offset+=50){for(let j=0;j<12;j++)close(aa.getFloat32(offset+j*4,true),bb.getFloat32(offset+j*4,true),.00001);assert.equal(aa.getUint16(offset+48,true),bb.getUint16(offset+48,true));}
});
test('default segmentation includes sleeves within actual print bounds',()=>{
  assert.equal(m.d.shellTiers,2);assert.equal(m.d.coreTiers,2);
  for(const p of m.parts.filter(p=>p.printable))assert.ok(p.bounds.size.every((v,i)=>v<=m.d.safe[i]+1e-6),p.id);
});
test('larger diameter splits plates into quarters, with closed meshes',()=>{
  const large=generate({masterOuterD:230,masterInnerD:160});
  assert.equal(large.d.flatSectors,4);assert.equal(large.d.sectors,4);
  for(const p of large.parts){assert.ok(checkMesh(p.mesh).watertight,p.id);assert.ok(volume(p.mesh)>0,p.id);}
});
test('a 256 mm printer still splits the 275 mm wall vertically',()=>{
  const large=generate({printerX:256,printerY:256,printerZ:256});
  assert.equal(large.d.shellTiers,2);assert.equal(large.d.coreTiers,2);assert.equal(large.stats.allFit,true);
});
test('unprintable dimensions are not reported as fitting',()=>{
  const huge=generate({masterOuterD:650,masterInnerD:600});
  assert.equal(huge.stats.allFit,false);assert.ok(huge.warnings.length);assert.throws(()=>kit(huge),/помещаются/);
});
test('disabling auto split blocks default oversize kit',()=>{
  const unsplit=generate({autoSplit:false});assert.equal(unsplit.d.shellTiers,1);assert.equal(unsplit.stats.allFit,false);
});
test('silicone mesh volume agrees with analytic volume',()=>{
  const a=m.parts.find(p=>p.id==='silicone-outer'),b=m.parts.find(p=>p.id==='silicone-inner');
  close(volume(a.mesh)/1000/m.stats.outerMl,1,.0005);close(volume(b.mesh)/1000/m.stats.innerMl,1,.0005);
  close(m.stats.totalMl,2230.923483130452,.000001);
});
test('regeneration changes both the master and shell heights',()=>{
  const changed=generate({masterHeight:320});
  assert.equal(changed.parts.find(p=>p.id==='master').bounds.size[2],320);
  assert.notEqual(fingerprint(stl(m.parts[0])),fingerprint(stl(changed.parts[0])));
});
test('STL stores exact source triangles normalised to print origin',()=>{
  for(const part of m.parts.filter(p=>p.printable)){
    const raw=stl(part),dv=new DataView(raw.buffer);assert.equal(dv.getUint32(80,true),part.mesh.length);assert.equal(raw.length,84+50*part.mesh.length);
    for(let t=0;t<part.mesh.length;t+=Math.max(1,Math.floor(part.mesh.length/29)))for(let v=0;v<3;v++)for(let a=0;a<3;a++)close(dv.getFloat32(84+50*t+12+v*12+a*4,true),part.mesh[t][v][a]-part.bounds.min[a],.00004);
  }
});
function readZip(bytes){const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files={};let o=0;
  while(dv.getUint32(o,true)===0x04034b50){const n=dv.getUint16(o+26,true),x=dv.getUint16(o+28,true),size=dv.getUint32(o+18,true),name=new TextDecoder().decode(bytes.slice(o+30,o+30+n));files[name]=bytes.slice(o+30+n+x,o+30+n+x+size);o+=30+n+x+size;}
  assert.equal(dv.getUint32(o,true),0x02014b50);return files;
}
test('ZIP includes only printable parts and complete manifest',()=>{
  const files=readZip(kit(m));assert.equal(Object.keys(files).length,13);assert.ok(!files['master.stl']);assert.ok(!files['test-bottom.stl']);
  const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));assert.equal(manifest.units,'mm');assert.equal(manifest.parts.length,10);
  for(const p of manifest.parts){assert.equal(fingerprint(files[p.file]),p.fnv1a32);assert.deepEqual(p.assemblyTranslation,m.parts.find(x=>x.id===p.id).bounds.min);}
});
test('snap ZIP contains only two samples plus metadata',()=>{assert.equal(Object.keys(readZip(kit(m,{samples:true}))).length,5);});
test('ZIP supports Unicode filenames and deterministic export',()=>{
  const a=makeZip([{name:'пример.txt',data:'Проверка'}]);assert.equal(new TextDecoder().decode(readZip(a)['пример.txt']),'Проверка');assert.equal(fingerprint(kit(m)),fingerprint(kit(m)));
});
test('JSON round trip preserves parameters and units',()=>{assert.deepEqual(parseProject(JSON.stringify(projectJSON(m.p))),m.p);});
test('legacy parameter-only JSON is accepted but unknown keys excluded',()=>{
  const p=parseProject('{"masterHeight":300,"unknown":"x"}');assert.equal(p.masterHeight,300);assert.ok(!('unknown'in p));
});
test('bad numeric values fail before geometry generation',()=>{
  for(const v of [NaN,Infinity,-1,0,'150',null])assert.throws(()=>generate({masterOuterD:v}));
  assert.throws(()=>generate(null));assert.throws(()=>generate([]));
});
test('physically inconsistent dimensions are rejected',()=>{
  for(const p of [{masterInnerD:150},{masterBottom:99,masterHeight:40},{masterInnerD:20,siliconeInner:10},{segments:65},{autoSplit:1}])assert.ok(validate(p).errors.length,JSON.stringify(p));
});
test('invalid project files cannot inject arbitrary values or code',()=>{
  for(const raw of ['bad','null','[]','"test"','{"format":"alien","masterHeight":300}','{"units":"cm","masterHeight":300}','{"parameters":"string"}','{"masterHeight":null}','{}','x'.repeat(100001)])assert.throws(()=>parseProject(raw),raw.slice(0,70));
  assert.ok(!Object.hasOwn(parseProject('{"masterHeight":270,"__proto__":{"x":1}}'),'__proto__'));
});
test('parameter sweep: all generated surfaces remain watertight',()=>{
  const cases=[{masterHeight:70,masterOuterD:60,masterInnerD:40,siliconeInner:5},{masterHeight:799,printerZ:90},{masterOuterD:340,masterInnerD:200,shellWall:2,fitClearance:.6},{coreWall:8,siliconeInner:20,fitClearance:.15,snapDeflection:.45},{segments:64},{segments:256}];
  for(const parameters of cases){const current=generate(parameters);for(const p of current.parts){const c=checkMesh(p.mesh);assert.ok(c.watertight&&c.volume>0,`${JSON.stringify(parameters)} ${p.id} ${JSON.stringify(c)}`);}}
});
test('export does not mutate source meshes or assembly bounds',()=>{
  const part=m.parts[0],before=JSON.stringify(part);stl(part);kit(m);assert.equal(JSON.stringify(part),before);assert.deepEqual(bounds(part.mesh),part.bounds);
});
