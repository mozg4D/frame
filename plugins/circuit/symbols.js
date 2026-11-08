// Authoring line symbols in local X/Z. No card, texture, billboard or simulation.
export function symbol(kind){
 const out=[],line=(a,b)=>out.push(a[0],0,a[1],b[0],0,b[1]),path=p=>p.slice(1).forEach((v,i)=>line(p[i],v)),circle=(x,z,r)=>{for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;line([x+r*Math.cos(a),z+r*Math.sin(a)],[x+r*Math.cos(b),z+r*Math.sin(b)]);}};
 if(['resistor','capacitor','inductor','diode','led','voltage','current'].includes(kind)){line([-10,0],[-5,0]);line([5,0],[10,0]);}
 if(kind==='resistor')path([[-5,0],[-4,2],[-2,-2],[0,2],[2,-2],[4,2],[5,0]]);
 else if(kind==='capacitor'){line([-5,0],[-1,0]);line([1,0],[5,0]);line([-1,-4],[-1,4]);line([1,-4],[1,4]);}
 else if(kind==='inductor'){const p=[];for(let i=0;i<=64;i++)p.push([-5+10*i/64,2*Math.sin(i*Math.PI/16)]);path(p);}
 else if(kind==='diode'||kind==='led'){path([[-5,-4],[-5,4],[4,0],[-5,-4]]);line([4,-4],[4,4]);if(kind==='led'){path([[0,6],[4,10],[1,9]]);line([4,10],[3,7]);path([[4,5],[8,9],[5,8]]);line([8,9],[7,6]);}}
 else if(kind==='voltage'||kind==='current'){circle(0,0,5);if(kind==='voltage'){line([-3,0],[-1,0]);line([-2,-1],[-2,1]);line([1,0],[3,0]);}else{path([[-3,0],[3,0],[1,2]]);line([3,0],[1,-2]);}}
 else if(kind==='bjt'){circle(0,0,8);line([-10,8],[-3,8]);line([-3,8],[-3,-5]);line([-3,3],[6,8]);line([-3,-2],[-10,-8]);line([6,8],[10,8]);path([[-8,-4],[-6,-5],[-8,-7]]);}
 else if(kind==='mosfet'){line([-10,8],[-4,8]);line([-4,8],[-4,-5]);line([-2,-6],[-2,6]);path([[-2,4],[7,4],[7,8],[10,8]]);path([[-2,-4],[-10,-4],[-10,-8]]);line([0,-8],[10,-8]);line([0,-8],[0,0]);}
 else{path([[-7,-6],[-7,6],[7,6],[7,-6],[-7,-6]]);for(const x of [-10,10])for(const z of [-8,8])line([x,z],[x*.7,z*.75]);}
 return new Float32Array(out);
}
export const bounds=kind=>kind==='circuit'?{min:[0,0,0],max:[0,0,0]}:{min:[-11,-.1,-10],max:[11,.1,11]};
