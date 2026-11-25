// Integrate the existing tetrahedral cut and aperture moments on 4^3
// subcells. The pressure and velocity unknowns stay on the coarse grid.
// Integrals preserve faces that contain both sides of a thin solid.
export const subcellMetricWGSL=`
  struct IntegratedCut{metric:vec4f,centers:FaceCenters,representative:vec4f}
  fn subcellCut(p:vec3i)->IntegratedCut{
    var result:IntegratedCut;let base=cutVertex(p,0u);let w=cellWidths(p);
    var samples:array<f32,125>;var best=-3e38;var far=base;
    for(var z=0u;z<=4u;z++){for(var y=0u;y<=4u;y++){for(var x=0u;x<=4u;x++){
      let v=base+.25*w*vec3f(f32(x),f32(y),f32(z));let s=surfaceDistance(v);
      samples[x+5u*(y+5u*z)]=s;if(s>best){best=s;far=v;}
    }}}
    for(var z=0u;z<4u;z++){for(var y=0u;y<4u;y++){for(var x=0u;x<4u;x++){
      let low=vec3u(x,y,z);var q:array<f32,8>;
      for(var k=0u;k<8u;k++){let j=low+vec3u(k&1u,(k>>1u)&1u,k>>2u);q[k]=samples[j.x+5u*(j.y+5u*j.z)];}
      let m=cutMetric(q);result.metric.w+=m.w/64.;
      if(any(low==vec3u(3))){let center=cutFaceCenters(q,m);
        for(var a=0u;a<3u;a++){if(low[a]!=3u){continue;}let b=(a+1u)%3u;let c=(a+2u)%3u;
          let area=m[a]/16.;let t=.25*(vec2f(f32(low[b]),f32(low[c]))+.5+center.t[a])-.5;
          result.metric[a]+=area;result.centers.t[a]+=area*t;
        }
      }
    }}}
    for(var a=0u;a<3u;a++){let area=result.metric[a];
      if(area>0.){result.centers.t[a]/=area;}
    }
    let mid=cellCenters(p);result.representative=vec4f(mid,select(0.,1.,best>0.));
    if(surfaceDistance(mid)<=0.&&best>0.){
      var lo=mid;var hi=far;
      for(var j=0u;j<8u;j++){let v=.5*(lo+hi);if(surfaceDistance(v)>0.){hi=v;}else{lo=v;}}
      let interior=.5*(hi+far);result.representative=vec4f(select(far,interior,surfaceDistance(interior)>0.),1.);
    }
    return result;
  }`;
