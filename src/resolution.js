// Chord deviation describes newly generated arcs, not accuracy of imported STL.
export const DETAIL_PRESETS=Object.freeze({draft:.10,standard:.03,fine:.01});
export function segmentsForRadius(radius,error,multiple=8){
 if(!Number.isFinite(radius)||radius<=0||!Number.isFinite(error)||error<=0)throw new Error('Некорректные параметры детализации.');
 const required=Math.max(32,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-error/radius))));
 const n=Math.ceil(required/multiple)*multiple;
 if(n>4096)throw new Error('Слишком высокая детализация.');
 return n;
}
export function vaseResolution(p){
 const radius=p.masterOuterD/2+p.siliconeOuter+p.shellWall;
 const tolerance=DETAIL_PRESETS[p.detail]??p.chordTolerance;
 const n=p.detail==='manual'?p.segments:segmentsForRadius(radius,tolerance,16);
 return {detail:p.detail,segments:n,chordToleranceMm:p.detail==='manual'?null:tolerance,
  maxDeviationMm:radius*(1-Math.cos(Math.PI/n)),sourcePreserved:true};
}
