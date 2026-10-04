import {mkdir,writeFile} from 'node:fs/promises';
import {generate,checkMesh,projectJSON} from '../src/geometry.js';
import {stl,kit} from '../src/export.js';
const model=generate();
const out=new URL('../output/',import.meta.url);await mkdir(out,{recursive:true});
for(const part of model.parts){const c=checkMesh(part.mesh);if(!c.watertight||c.volume<=0)throw new Error(`Некорректная сетка: ${part.id}`);await writeFile(new URL(part.filename,out),stl(part));}
await writeFile(new URL('vase_150x100x270_tooling.zip',out),kit(model));
await writeFile(new URL('snap_test.zip',out),kit(model,{samples:true}));
await writeFile(new URL('parameters.json',out),JSON.stringify(projectJSON(model.p),null,2));
console.log(`${model.parts.length} STL проверены; ${model.stats.printCount} рабочих деталей в ZIP; силикон ${(model.stats.totalMl/1000).toFixed(3)} л.`);
