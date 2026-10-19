#include <stdint.h>
#include <wasm_simd128.h>
__attribute__((export_name("affine")))
void affine(uint32_t input,uint32_t output,uint32_t vertices,uint32_t matrix,uint32_t doubles){
  const float *src=(float*)(uintptr_t)input;const double *m=(double*)(uintptr_t)matrix;
  float *f=(float*)(uintptr_t)output;double *d=(double*)(uintptr_t)output;
  v128_t a=wasm_v128_load(m),b=wasm_v128_load(m+4),c=wasm_v128_load(m+8),t=wasm_v128_load(m+12);
  for(uint32_t i=0;i<vertices;i++){
    double x=src[i*3],y=src[i*3+1],z=src[i*3+2];
    v128_t xy=wasm_f64x2_add(wasm_f64x2_add(wasm_f64x2_add(wasm_f64x2_mul(a,wasm_f64x2_splat(x)),wasm_f64x2_mul(b,wasm_f64x2_splat(y))),wasm_f64x2_mul(c,wasm_f64x2_splat(z))),t);
    double zz=m[2]*x+m[6]*y+m[10]*z+m[14];
    if(doubles){wasm_v128_store(d+i*3,xy);d[i*3+2]=zz;}else{f[i*3]=wasm_f64x2_extract_lane(xy,0);f[i*3+1]=wasm_f64x2_extract_lane(xy,1);f[i*3+2]=zz;}
  }
}
// Caller supplies one temporary arena. Coordinates retain their exact Float32 bits.
__attribute__((export_name("stl")))
uint32_t stl(uint32_t input,uint32_t triangles,uint32_t output,uint32_t indices,uint32_t table,uint32_t mask,uint32_t initialCount){
  uint8_t *src=(uint8_t*)(uintptr_t)input;
  uint32_t *pos=(uint32_t*)(uintptr_t)output,*ix=(uint32_t*)(uintptr_t)indices,*hashes=(uint32_t*)(uintptr_t)table;
  uint32_t count=initialCount,corner=0;
  v128_t sign=wasm_i32x4_make(0,0,(int32_t)0x80000000,0),zero=wasm_i32x4_splat(0),negativeZero=wasm_i32x4_splat((int32_t)0x80000000),exponent=wasm_i32x4_splat(0x7f800000);
  for(uint32_t t=0;t<triangles;t++)for(uint32_t k=0;k<3;k++,corner++){
    v128_t v=wasm_v128_load(src+96+t*50+k*12);
    v=wasm_i32x4_shuffle(v,v,0,2,1,3);v=wasm_v128_xor(v,sign);
    v=wasm_v128_bitselect(zero,v,wasm_i32x4_eq(v,negativeZero));
    if(wasm_i32x4_bitmask(wasm_i32x4_eq(wasm_v128_and(v,exponent),exponent))&7)return 0xffffffff;
    uint32_t x=wasm_i32x4_extract_lane(v,0),y=wasm_i32x4_extract_lane(v,1),z=wasm_i32x4_extract_lane(v,2);
    if(count>(mask+1u)*7u/10u)return 0xfffffffe;
    uint32_t h=x*0x8da6b343u^y*0xd8163841u^z*0xcb1ab31fu;h=(h^(h>>16))*0x85ebca6bu;uint32_t slot=(h^(h>>13))&mask;
    for(;;){uint32_t entry=hashes[slot];if(!entry){uint32_t base=count*3;pos[base]=x;pos[base+1]=y;pos[base+2]=z;ix[corner]=count;hashes[slot]=++count;break;}
      uint32_t i=entry-1,base=i*3;if(pos[base]==x&&pos[base+1]==y&&pos[base+2]==z){ix[corner]=i;break;}slot=(slot+1)&mask;}
  }
  return count;
}
