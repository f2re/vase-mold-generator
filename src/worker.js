import {generate} from './geometry.js';
self.onmessage=({data})=>{const {id,parameters}=data;try{const start=performance.now(),model=generate(parameters);self.postMessage({id,model,ms:performance.now()-start});}catch(error){self.postMessage({id,error:error.message,fields:error.fields||{}});}};
