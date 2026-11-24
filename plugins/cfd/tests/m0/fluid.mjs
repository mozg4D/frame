// U.S. Standard Atmosphere 1976, lower-atmosphere layer bases, hydrostatic
// pressure and Sutherland viscosity. Input elevation is geometric metres.
// https://ntrs.nasa.gov/citations/19770009539
export function mediumProperties(medium,altitude){
  if(medium==='Water')return {rho:998.2,nu:.001002/998.2,temperatureK:293.15,pressurePa:101325,soundSpeedMps:1482,atmosphereInRange:true};
  const radius=6356766,limits=[0,11000,20000,32000,47000,51000,71000,84852],lapse=[-.0065,0,.001,.0028,0,-.0028,-.002];
  const z=Math.max(-5000,Math.min(86000,altitude)),height=z*radius/(radius+z),R=287.05287,g=9.80665;
  let t=288.15,p=101325;
  for(let i=0;i<lapse.length;i++){
    const dh=Math.min(height,limits[i+1])-limits[i],rate=lapse[i],next=t+dh*rate;
    p*=rate===0?Math.exp(-g*dh/(R*t)):(next/t)**(-g/(R*rate));t=next;
    if(height<=limits[i+1])break;
  }
  const rho=p/(R*t),mu=1.458e-6*t**1.5/(t+110.4);
  return {rho,nu:mu/rho,temperatureK:t,pressurePa:p,soundSpeedMps:Math.sqrt(1.4*R*t),atmosphereInRange:z===altitude};
}
