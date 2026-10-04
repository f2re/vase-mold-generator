import {normal,bounds} from './geometry.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const minus=(a,b)=>a.map((v,i)=>v-b[i]);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const hex=c=>c.match(/\w\w/g).map(v=>parseInt(v,16)/255);
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const STAGES={all:()=>true,outer:p=>['shell','base','master'].includes(p.type)||p.id==='silicone-outer',inner:p=>!p.sample,casting:p=>!p.sample&&p.id!=='master'};
export class Viewer {
  constructor(canvas,{onSelect=()=>{},onMode=()=>{}}={}){
    this.canvas=canvas;this.onSelect=onSelect;this.onMode=onMode;this.parts=[];this.hidden=new Set();this.selected=null;this.mode='explode';this.stage='all';this.explode=.58;this.slice=0;this.yaw=-1.06;this.pitch=.42;this.zoom=1;this.target=[0,0,150];this.pan=[0,0];this.reference={master:false,silicone:false,sample:false};this.transparent=false;this.isolated=null;this.pointer=new Map();this.frame=0;this.transitions=null;this.framesDrawn=0;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    try{this.gl=canvas.getContext('webgl',{alpha:false,antialias:true,preserveDrawingBuffer:true});if(this.gl)this.setupGL();}catch(e){this.gl=null;}
    if(!this.gl){this.ctx=canvas.getContext('2d');if(!this.ctx)throw new Error('Браузер не поддерживает Canvas.');}
    this.backend=this.gl?'WebGL':'CPU / Canvas';
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;canvas.dispatchEvent(new CustomEvent('viewerror',{detail:'Контекст 3D потерян. Перезагрузите страницу; параметры сохранены.'}));});
    canvas.addEventListener('webglcontextrestored',()=>{this.lost=false;this.setupGL();this.prepare();this.invalidate();});
    this.ro=new ResizeObserver(()=>this.resize());this.ro.observe(canvas);this.bind();this.resize();
  }
  basis(){const {yaw:a,pitch:b}=this;return {right:[-Math.sin(a),Math.cos(a),0],up:[-Math.sin(b)*Math.cos(a),-Math.sin(b)*Math.sin(a),Math.cos(b)],eye:[Math.cos(b)*Math.cos(a),Math.cos(b)*Math.sin(a),Math.sin(b)]};}
  project(p){const b=this.basis(),q=minus(p,this.target),s=this.scale*this.zoom;return [this.width/2+this.pan[0]+dot(q,b.right)*s,this.height/2+this.pan[1]-dot(q,b.up)*s,dot(q,b.eye)];}
  resize(){const r=this.canvas.getBoundingClientRect();this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);if(!this.scale)this.scale=1;this.invalidate();}
  setModel(model){const first=!this.model;this.model=model;this.parts=model.parts;const ids=new Set(this.parts.map(p=>p.id));this.hidden=new Set([...this.hidden].filter(id=>ids.has(id)));if(!ids.has(this.selected))this.selected=null;if(!ids.has(this.isolated))this.isolated=null;this.transitions=null;this.prepare();if(first)this.fit();else this.invalidate();}
  prepare(){if(!this.gl)return;const gl=this.gl;for(const p of this.buffers||[]){gl.deleteBuffer(p.buffer);}this.buffers=this.parts.map(p=>{const data=new Float32Array(p.mesh.length*18);let k=0;for(const t of p.mesh){const n=normal(t);for(const v of t)for(const x of [...v,...n])data[k++]=x;}const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return {id:p.id,buffer,count:p.mesh.length*3};});}
  visible(p){if(this.isolated)return p.id===this.isolated;if(this.hidden.has(p.id))return false;if(!STAGES[this.stage](p))return false;if(p.sample)return this.reference.sample;if(p.type==='master')return this.reference.master;if(p.type==='silicone')return this.reference.silicone;return p.printable;}
  shift(p,mode=this.mode){const d=this.model.d,H=this.model.p.masterHeight,e=this.explode;
    if(mode==='layout'){const visible=this.parts.filter(x=>this.visible(x));const i=visible.indexOf(p),cols=Math.ceil(Math.sqrt(visible.length)),cell=Math.max(...visible.map(x=>Math.max(...x.bounds.size.slice(0,2))))+30;return [(i%cols-(cols-1)/2)*cell-(p.bounds.min[0]+p.bounds.max[0])/2,Math.floor(i/cols)*cell-(p.bounds.min[1]+p.bounds.max[1])/2,-p.bounds.min[2]];}
    if(mode!=='explode')return [0,0,0];
    if(p.type==='shell')return [Math.cos(p.angle-Math.PI/4)*d.so*2.4*e,Math.sin(p.angle-Math.PI/4)*d.so*2.4*e,(p.tier*H*.26)*e];
    if(p.type==='base')return [Math.cos(p.angle)*d.so*.3*e,Math.sin(p.angle)*d.so*.3*e,-H*.24*e];
    if(p.type==='lid')return [Math.cos(p.angle||0)*d.so*.3*e,-H*.15*e,H*.72*e];
    if(p.id==='core-bottom')return [0,0,-H*.1*e];
    if(p.id==='core-cap')return [H*.36*e,0,H*1.2*e];
    if(p.type==='core')return [0,0,(H*.17+H*.27*p.tier)*e];
    if(p.id==='master')return [-H*.9*e,0,0];
    if(p.type==='silicone')return [H*.9*e,0,p.stage===2?H*.25*e:0];
    if(p.sample)return [p.id==='test-bottom'?d.co*1.4*e:0,0,p.id==='test-socket'?H*.14*e:0];
    return [0,0,0];
  }
  offset(p){if(!this.transitions)return this.shift(p);const now=performance.now(),t=clamp((now-this.transitions.start)/220,0,1),s=1-Math.pow(1-t,3);return lerp(this.transitions.from[p.id]||[0,0,0],this.shift(p),s);}
  setMode(mode,{animate=true}={}){if(!['assembly','explode','section','layout'].includes(mode))return;const from=Object.fromEntries(this.parts.map(p=>[p.id,this.offset(p)]));this.mode=mode;if(mode==='layout'){this.pitch=1.1;this.yaw=-Math.PI/2;}if(mode==='section'){this.reference.master=true;this.reference.silicone=true;}
    if(animate&&!this.reduced.matches&&mode!=='layout')this.transitions={from,start:performance.now()};else this.transitions=null;this.fit();this.onMode(mode);this.invalidate();}
  setStage(stage){this.stage=stage;this.isolated=null;if(stage!=='all'){this.reference.master=stage!=='casting';this.reference.silicone=true;this.setMode('section',{animate:false});this.reference.master=stage!=='casting';}this.fit();}
  setReference(type,val){this.reference[type]=val;this.isolated=null;this.fit();}
  setVisible(id,val){val?this.hidden.delete(id):this.hidden.add(id);this.isolated=null;this.invalidate();}
  select(id){this.selected=id;this.onSelect(id);this.invalidate();}
  isolate(id){this.isolated=id;this.fit();}
  showAll(){this.isolated=null;this.hidden.clear();this.fit();}
  fit(){if(!this.parts.length)return;const b=this.basis();let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const p of this.parts.filter(p=>this.visible(p))){const s=this.shift(p);for(const x of [p.bounds.min[0],p.bounds.max[0]])for(const y of [p.bounds.min[1],p.bounds.max[1]])for(const z of [p.bounds.min[2],p.bounds.max[2]]){const q=[x+s[0],y+s[1],z+s[2]];for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],q[i]);hi[i]=Math.max(hi[i],q[i]);}}}if(!Number.isFinite(lo[0])){this.invalidate();return;}
    this.target=lo.map((x,i)=>(x+hi[i])/2);let ex=0,ey=0;for(const x of [lo[0],hi[0]])for(const y of [lo[1],hi[1]])for(const z of [lo[2],hi[2]]){const q=minus([x,y,z],this.target);ex=Math.max(ex,Math.abs(dot(q,b.right)));ey=Math.max(ey,Math.abs(dot(q,b.up)));}this.scale=Math.min((this.width-90)/(2*ex||1),(this.height-95)/(2*ey||1));this.scale=Math.max(.03,this.scale);this.zoom=1;this.pan=[0,0];this.depthRange=Math.max(2000,Math.hypot(...hi.map((x,i)=>x-lo[i]))*4);this.invalidate();}
  camera(name){if(name==='top'){this.pitch=Math.PI/2-.001;this.yaw=-Math.PI/2;}else if(name==='front'){this.pitch=0;this.yaw=-Math.PI/2;}else{this.pitch=.42;this.yaw=-1.06;}this.fit();}
  invalidate(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.render();if(this.transitions){if(performance.now()-this.transitions.start>=220)this.transitions=null;else this.invalidate();}});}
  clipped(t,s){let poly=t.map(p=>add(p,s));if(this.mode!=='section')return [poly];const plane=this.model.d.so*this.slice;
    const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ina=a[1]>=plane,inb=b[1]>=plane;if(ina)out.push(a);if(ina!==inb){const u=(plane-a[1])/(b[1]-a[1]);out.push(lerp(a,b,u));}}if(out.length<3)return [];return Array.from({length:out.length-2},(_,i)=>[out[0],out[i+1],out[i+2]]);}
  pick(x,y){let best=-Infinity,id=null;for(const p of this.parts.filter(p=>this.visible(p))){const s=this.offset(p);for(const t of p.mesh)for(const clip of this.clipped(t,s)){const a=clip.map(v=>this.project(v)),[A,B,C]=a;const den=(B[1]-C[1])*(A[0]-C[0])+(C[0]-B[0])*(A[1]-C[1]);if(Math.abs(den)<1e-8)continue;const u=((B[1]-C[1])*(x-C[0])+(C[0]-B[0])*(y-C[1]))/den,v=((C[1]-A[1])*(x-C[0])+(A[0]-C[0])*(y-C[1]))/den,w=1-u-v;if(u<0||v<0||w<0)continue;const z=u*A[2]+v*B[2]+w*C[2];if(z>best){best=z;id=p.id;}}}this.select(id);return id;}
  bind(){const c=this.canvas;c.addEventListener('contextmenu',e=>e.preventDefault());
    c.addEventListener('pointerdown',e=>{c.focus({preventScroll:true});c.setPointerCapture(e.pointerId);this.pointer.set(e.pointerId,[e.clientX,e.clientY]);this.drag={x:e.clientX,y:e.clientY,moved:0,pan:e.shiftKey||e.button===2};});
    c.addEventListener('pointermove',e=>{if(!this.pointer.has(e.pointerId))return;const old=this.pointer.get(e.pointerId),dx=e.clientX-old[0],dy=e.clientY-old[1];this.pointer.set(e.pointerId,[e.clientX,e.clientY]);if(this.pointer.size===2){const values=[...this.pointer.values()],dist=Math.hypot(values[0][0]-values[1][0],values[0][1]-values[1][1]);if(this.pinch)this.zoom=clamp(this.zoom*dist/this.pinch,.2,10);this.pinch=dist;}else if(this.drag?.pan){this.pan[0]+=dx;this.pan[1]+=dy;}else{this.yaw-=dx*.007;this.pitch=clamp(this.pitch+dy*.007,-1.5,1.55);}if(this.drag)this.drag.moved+=Math.abs(dx)+Math.abs(dy);this.invalidate();});
    const release=e=>{this.pointer.delete(e.pointerId);this.pinch=null;if(e.type==='pointerup'&&this.drag&&this.drag.moved<5&&e.button!==2){const r=c.getBoundingClientRect();this.pick(e.clientX-r.left,e.clientY-r.top);}this.drag=null;};c.addEventListener('pointerup',release);c.addEventListener('pointercancel',release);
    c.addEventListener('wheel',e=>{e.preventDefault();this.zoom=clamp(this.zoom*Math.exp(-e.deltaY*.0015),.2,12);this.invalidate();},{passive:false});
    c.addEventListener('keydown',e=>{let acted=true;if(e.key==='ArrowLeft')this.yaw-=.13;else if(e.key==='ArrowRight')this.yaw+=.13;else if(e.key==='ArrowUp')this.pitch=clamp(this.pitch+.13,-1.5,1.55);else if(e.key==='ArrowDown')this.pitch=clamp(this.pitch-.13,-1.5,1.55);else if(['+','='].includes(e.key))this.zoom=clamp(this.zoom*1.15,.2,12);else if(e.key==='-')this.zoom=clamp(this.zoom/1.15,.2,12);else if(e.key.toLowerCase()==='f')this.fit();else if(e.key==='Escape')this.select(null);else acted=false;if(acted){e.preventDefault();this.transitions=null;this.invalidate();}});
  }
  grid(){const lines=[],r=this.mode==='layout'?Math.max(this.model.d.so*4,400):Math.max(this.model.d.so*1.9,150),step=r>500?100:25;for(let t=-Math.floor(r/step)*step;t<=r;t+=step){lines.push([[-r,t,-3],[r,t,-3]],[[t,-r,-3],[t,r,-3]]);}return lines;}
  outline(){const p=this.parts.find(p=>p.id===this.selected);if(!p||!this.visible(p))return [];const s=this.offset(p),b=p.bounds,c=[];for(let i=0;i<8;i++)c.push([0,1,2].map(j=>(i&(1<<j)?b.max[j]:b.min[j])+s[j]));const lines=[];for(let i=0;i<8;i++)for(let j=0;j<3;j++)if(!(i&(1<<j)))lines.push([c[i],c[i|(1<<j)]]);return lines;}
  render(){if(!this.model||this.lost)return;this.framesDrawn++;if(this.gl)this.renderGL();else this.renderCPU();}
  renderCPU(){
    // A true per-pixel depth buffer: a painter sort cannot resolve coincident
    // silicone/master interfaces or overlapping long, narrow wall triangles.
    const ctx=this.ctx,w=Math.max(1,Math.round(this.width)),h=Math.max(1,Math.round(this.height));
    if(!this.cpuCanvas){this.cpuCanvas=document.createElement('canvas');this.cpuContext=this.cpuCanvas.getContext('2d');}
    if(this.cpuCanvas.width!==w||this.cpuCanvas.height!==h){this.cpuCanvas.width=w;this.cpuCanvas.height=h;this.depth=new Float32Array(w*h);this.image=this.cpuContext.createImageData(w,h);}
    const color=this.image.data,depth=this.depth;color.fill(0);depth.fill(-Infinity);
    const triangles=[],lightDir=[.45,-.48,.76];
    for(const p of this.parts.filter(p=>this.visible(p))){
      const shift=this.offset(p),rgb=hex(p.color),alpha=this.transparent&&p.type==='shell'?.2:1;
      for(const t of p.mesh){const n=normal(t),light=.55+.32*Math.abs(dot(n,lightDir))+.13*Math.max(0,n[2]);
        const fill=rgb.map(v=>Math.round(clamp(v*light,0,1)*255));
        for(const clip of this.clipped(t,shift))triangles.push({screen:clip.map(v=>this.project(v)),fill,alpha});
      }
    }
    // Transparent shells are inspection aids, drawn after opaque solids.
    triangles.sort((a,b)=>b.alpha-a.alpha || (a.alpha<1 ? a.screen.reduce((s,v)=>s+v[2],0)-b.screen.reduce((s,v)=>s+v[2],0):0));
    for(const t of triangles){
      let [a,b,c]=t.screen;
      let den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-9)continue;
      const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(w-1,Math.ceil(Math.max(a[0],b[0],c[0])));
      const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(h-1,Math.ceil(Math.max(a[1],b[1],c[1])));
      const ux=(b[1]-c[1])/den,uy=(c[0]-b[0])/den,vx=(c[1]-a[1])/den,vy=(a[0]-c[0])/den;
      for(let y=y0;y<=y1;y++){
        let u=ux*(x0+.5-c[0])+uy*(y+.5-c[1]),v=vx*(x0+.5-c[0])+vy*(y+.5-c[1]);
        for(let x=x0;x<=x1;x++,u+=ux,v+=vx){
          const q=1-u-v;if(u< -1e-7||v< -1e-7||q< -1e-7)continue;
          const z=u*a[2]+v*b[2]+q*c[2],i=y*w+x;if(z<=depth[i]+.00003)continue;
          const k=i*4;
          if(t.alpha===1){depth[i]=z;color[k]=t.fill[0];color[k+1]=t.fill[1];color[k+2]=t.fill[2];color[k+3]=255;}
          else{const old=color[k+3]/255,na=t.alpha+old*(1-t.alpha);for(let j=0;j<3;j++)color[k+j]=(t.fill[j]*t.alpha+color[k+j]*old*(1-t.alpha))/na;color[k+3]=Math.round(na*255);}
        }
      }
    }
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.fillStyle='#f4f5ef';ctx.fillRect(0,0,this.width,this.height);this.drawLines2D(this.grid(),'#dce1d5',.65);
    this.cpuContext.putImageData(this.image,0,0);ctx.drawImage(this.cpuCanvas,0,0,w,h);this.drawLines2D(this.outline(),'#a34925',1.2);
  }
  drawLines2D(lines,color,width){const c=this.ctx;c.strokeStyle=color;c.lineWidth=width;c.beginPath();for(const line of lines){const [a,b]=line.map(v=>this.project(v));c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);}c.stroke();}
  setupGL(){const gl=this.gl;const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const vs=shader(gl.VERTEX_SHADER,'attribute vec3 aPosition;attribute vec3 aNormal;uniform mat4 uMatrix;uniform vec3 uShift;varying vec3 vNormal;varying vec3 vPoint;void main(){vPoint=aPosition+uShift;vNormal=aNormal;gl_Position=uMatrix*vec4(vPoint,1.0);}');
    const fs=shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform vec4 uColor;uniform float uCut;uniform float uPlane;uniform float uFlat;varying vec3 vNormal;varying vec3 vPoint;void main(){if(uCut>0.5&&vPoint.y<uPlane)discard;float light=uFlat>0.5?1.0:0.52+0.35*abs(dot(normalize(vNormal),normalize(vec3(0.45,-0.48,0.76))))+0.13*max(0.0,vNormal.z);gl_FragColor=vec4(uColor.rgb*light,uColor.a);}');
    const pg=gl.createProgram();gl.attachShader(pg,vs);gl.attachShader(pg,fs);gl.linkProgram(pg);if(!gl.getProgramParameter(pg,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(pg));gl.deleteShader(vs);gl.deleteShader(fs);this.program=pg;gl.useProgram(pg);this.loc={};for(const n of ['uMatrix','uShift','uColor','uCut','uPlane','uFlat'])this.loc[n]=gl.getUniformLocation(pg,n);for(const n of ['aPosition','aNormal'])this.loc[n]=gl.getAttribLocation(pg,n);this.lineBuffer=gl.createBuffer();gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  }
  matrix(){const {right:r,up:u,eye:e}=this.basis(),s=this.scale*this.zoom,sx=2*s/this.width,sy=2*s/this.height,sz=-2/(this.depthRange||2000),t=this.target;return new Float32Array([r[0]*sx,u[0]*sy,e[0]*sz,0,r[1]*sx,u[1]*sy,e[1]*sz,0,r[2]*sx,u[2]*sy,e[2]*sz,0,-dot(t,r)*sx+this.pan[0]*2/this.width,-dot(t,u)*sy-this.pan[1]*2/this.height,-dot(t,e)*sz,1]);}
  attrs(){const g=this.gl;g.enableVertexAttribArray(this.loc.aPosition);g.vertexAttribPointer(this.loc.aPosition,3,g.FLOAT,false,24,0);g.enableVertexAttribArray(this.loc.aNormal);g.vertexAttribPointer(this.loc.aNormal,3,g.FLOAT,false,24,12);}
  linesGL(lines,color){if(!lines.length)return;const g=this.gl,data=new Float32Array(lines.flatMap(line=>line.flatMap(v=>[...v,0,0,1])));g.bindBuffer(g.ARRAY_BUFFER,this.lineBuffer);g.bufferData(g.ARRAY_BUFFER,data,g.DYNAMIC_DRAW);this.attrs();g.uniform3f(this.loc.uShift,0,0,0);g.uniform4f(this.loc.uColor,...hex(color),1);g.uniform1f(this.loc.uFlat,1);g.uniform1f(this.loc.uCut,0);g.drawArrays(g.LINES,0,data.length/6);}
  renderGL(){const g=this.gl;g.viewport(0,0,this.canvas.width,this.canvas.height);g.clearColor(...hex('#f4f5ef'),1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);g.useProgram(this.program);g.uniformMatrix4fv(this.loc.uMatrix,false,this.matrix());g.depthMask(true);this.linesGL(this.grid(),'#dce1d5');
    const list=this.parts.filter(p=>this.visible(p)).sort((a,b)=>Number(this.transparent&&a.type==='shell')-Number(this.transparent&&b.type==='shell'));
    for(const p of list){const buf=this.buffers.find(x=>x.id===p.id);g.bindBuffer(g.ARRAY_BUFFER,buf.buffer);this.attrs();g.uniform3f(this.loc.uShift,...this.offset(p));g.uniform4f(this.loc.uColor,...hex(p.color),this.transparent&&p.type==='shell'?.2:1);g.uniform1f(this.loc.uFlat,0);g.uniform1f(this.loc.uCut,this.mode==='section'?1:0);g.uniform1f(this.loc.uPlane,this.model.d.so*this.slice);g.depthMask(!(this.transparent&&p.type==='shell'));g.drawArrays(g.TRIANGLES,0,buf.count);}g.depthMask(false);g.disable(g.DEPTH_TEST);this.linesGL(this.outline(),'#a34925');g.enable(g.DEPTH_TEST);g.depthMask(true);
  }
  snapshot(){this.render();return new Promise(resolve=>this.canvas.toBlob(resolve,'image/png'));}
  destroy(){this.ro.disconnect();if(this.frame)cancelAnimationFrame(this.frame);if(this.gl){for(const b of this.buffers||[])this.gl.deleteBuffer(b.buffer);this.gl.deleteBuffer(this.lineBuffer);this.gl.deleteProgram(this.program);}}
}
