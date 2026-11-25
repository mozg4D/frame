// Spalding's smooth-wall relation, y+ = F(u+). Solving u+ F(u+) =
// |Ut| y / nu returns tau / (rho |Ut|) in the caller's velocity units.
export const wallResistanceWGSL=`
  fn wallResistance(speed:f32,distance:f32,nu:f32)->f32{
    let d=max(distance,1e-12);let re=speed*d/nu;if(re<.001){return nu/d;}
    var lo=0.;var hi=min(sqrt(re),8.+log(1.+9.8*re)/.41);
    for(var it=0u;it<14u;it++){
      let up=.5*(lo+hi);let x=.41*up;
      let excess=max(0.,exp(min(x,80.))-1.-x-.5*x*x-x*x*x/6.);
      if(up*(up+excess/9.8)>re){hi=up;}else{lo=up;}
    }
    let up=.5*(lo+hi);return speed/(up*up);
  }
  fn tangentialSlip(relative:vec3f,normal:vec3f)->vec3f{return relative-dot(relative,normal)*normal;}`;
