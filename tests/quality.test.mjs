import test from 'node:test';
import assert from 'node:assert/strict';
import {generate,checkMesh,parseProject} from '../src/geometry.js';
import {segmentsForRadius,DETAIL_PRESETS} from '../src/resolution.js';
import {validateSTLSettings} from '../src/stl-settings.js';
import {stl} from '../src/export.js';
import {parseSTL} from '../src/stl.js';

test('arc error is bounded for small, medium and large radii in every quality',()=>{
 for(const radius of [.5,2,40,88,400])for(const error of [.005,...Object.values(DETAIL_PRESETS),.2]){
  const n=segmentsForRadius(radius,error);assert.ok(n%8===0&&n>=32);assert.ok(radius*(1-Math.cos(Math.PI/n))<=error+1e-12);
 }
});
test('vase fine profile increases real mesh detail, not just shading',()=>{
 const a=generate({detail:'draft'}),b=generate({detail:'fine'});
 assert.ok(b.resolution.segments>a.resolution.segments);assert.ok(b.parts[0].mesh.length>a.parts[0].mesh.length);
 assert.ok(b.resolution.maxDeviationMm<=.01);
 assert.deepEqual(a.parts[0].bounds.size,b.parts[0].bounds.size);
});
test('every fine vase STL round trips as a closed oriented mesh',()=>{
 for(const part of generate({detail:'fine'}).parts){const q=checkMesh(parseSTL(stl(part)));assert.equal(q.watertight,true,part.id);}
});
test('analytic silicone volume bounds converge as chord error decreases',()=>{
 let error=Infinity;
 for(const detail of ['draft','standard','fine']){
  const m=generate({detail});const current=m.stats.totalMl-m.stats.meshTotalMl;
  assert.ok(current>=0&&current<error);error=current;
 }
});
test('legacy projects with segment count preserve that exact count',()=>{
 const p=parseProject('{"masterHeight":270,"segments":64}');assert.equal(p.detail,'manual');assert.equal(generate(p).resolution.segments,64);
});
test('unknown detail and excessive tolerance fail validation',()=>{
 for(const p of [{detail:'smooth-magic'},{chordTolerance:0},{chordTolerance:.5},{segments:63,detail:'manual'}])assert.throws(()=>generate(p));
});
test('inactive negative settings do not block enclosure',()=>{
 const p=validateSTLSettings({kind:'box',padding:999,sprueX:NaN},{activeOnly:true});assert.equal(p.padding,10);assert.equal(p.sprueX,null);
});
test('inactive enclosure settings do not block negative',()=>{
 assert.equal(validateSTLSettings({kind:'negative',clearance:NaN},{activeOnly:true}).clearance,10);
});
test('complete project validation is atomic and strict, including inactive settings',()=>{
 for(const p of [null,[],{kind:'alien'},{scale:true},{units:'m'},{vents:[[0,0],[0,0]]},{chordTolerance:.001},{padding:999},{sprueX:2000,sprueY:0}])assert.throws(()=>validateSTLSettings(p));
});
test('valid project ignores unknown properties without changing geometry parameters',()=>{
 const p=validateSTLSettings(JSON.parse('{"scale":2,"__proto__":{"polluted":true},"unknown":4}'));assert.equal(p.scale,2);assert.ok(!Object.hasOwn(p,'unknown'));assert.ok(!Object.hasOwn(p,'__proto__'));
});
