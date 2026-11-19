// Sparse scalar samples of the completed solid. Uniform bricks have no sample allocation.
namespace unite_field {
using Sample=int16_t;
constexpr int B=8, count=B*B*B, full=4095;
struct Grid {
    using Brick=std::array<Sample,count>;
    int size[3],tiles[3];
    std::vector<int> map;
    std::vector<std::unique_ptr<Brick>> bricks;
    Grid(int x,int y,int z):size{x,y,z},tiles{(x+7)/8,(y+7)/8,(z+7)/8},
        map(size_t(tiles[0])*tiles[1]*tiles[2],-full){}
    size_t block(int x,int y,int z) const{return x+size_t(tiles[0])*(y+size_t(tiles[1])*z);}
    static int offset(int x,int y,int z){return (x&7)+8*(y&7)+64*(z&7);}
    int value(int x,int y,int z) const {
        if(unsigned(x)>=unsigned(size[0])||unsigned(y)>=unsigned(size[1])||unsigned(z)>=unsigned(size[2]))return -full;
        int m=map[block(x/8,y/8,z/8)];return m<32768?m:(*bricks[m-32768])[offset(x,y,z)];
    }
    Brick& writable(size_t k){
        int& m=map[k];
        if(m<32768){auto b=std::make_unique<Brick>();b->fill(Sample(m));m=32768+int(bricks.size());bricks.push_back(std::move(b));}
        return *bricks[m-32768];
    }
    void put(size_t k,Brick& data){
        const int v=data[0];
        if(std::all_of(data.begin()+1,data.end(),[&](int a){return a==v;})){map[k]=v;return;}
        writable(k)=data;
    }
    double sample(double x,double y,double z) const {
        int a=int(std::floor(x)),b=int(std::floor(y)),c=int(std::floor(z));
        x-=a;y-=b;z-=c;
        double v=0;
        for(int k=0;k<2;++k)for(int j=0;j<2;++j)
            v+=(k?z:1-z)*(j?y:1-y)*((1-x)*value(a,b+j,c+k)+x*value(a+1,b+j,c+k));
        return v;
    }
    bool different(int x,int y,int z,int width,int reach) const {
        int X=std::min(tiles[0]-1,(x+width-1+reach)/8),Y=std::min(tiles[1]-1,(y+width-1+reach)/8),Z=std::min(tiles[2]-1,(z+width-1+reach)/8);
        int start=map[block(x/8,y/8,z/8)];
        if(start>=32768)return true;
        if(start>0&&(x<reach||y<reach||z<reach||x+width+reach>=size[0]||y+width+reach>=size[1]||z+width+reach>=size[2]))return true;
        for(int c=std::max(0,z-reach)/8;c<=Z;++c)for(int b=std::max(0,y-reach)/8;b<=Y;++b)
            for(int a=std::max(0,x-reach)/8;a<=X;++a)if(map[block(a,b,c)]!=start)return true;
        return false;
    }
    size_t bytes() const{return map.size()*sizeof(int)+bricks.size()*(sizeof(Brick)+sizeof(void*));}
};
struct Volume {
    Grid raw;std::unique_ptr<Grid> filtered;
    std::unique_ptr<Grid> coarse,working;int step=1;
    const Grid& base() const{return coarse?*coarse:raw;}
    Volume(int x,int y,int z):raw(x,y,z){}
    const Grid& field() const{return filtered?*filtered:raw;}
};
static Sample quantize(double v){return Sample(std::clamp(std::round(v),-double(full),double(full)));}
// Three-sample full weighting conserves a planar cut's sub-cell phase on the coarser lattice.
static std::unique_ptr<Grid> half(const Grid& src){
    auto out=std::make_unique<Grid>((src.size[0]+1)/2,(src.size[1]+1)/2,(src.size[2]+1)/2);
    for(int z=0;z<out->size[2];z+=8)for(int y=0;y<out->size[1];y+=8)for(int x=0;x<out->size[0];x+=8){
        size_t k=out->block(x/8,y/8,z/8);
        if(!src.different(2*x,2*y,2*z,16,1)){out->map[k]=src.value(2*x,2*y,2*z);continue;}
        Grid::Brick data;
        for(int c=0;c<8;++c)for(int b=0;b<8;++b)for(int a=0;a<8;++a){
            int q=0;
            for(int j=-1;j<=1;++j)for(int i=-1;i<=1;++i){
                const int px=2*(a+x),py=2*(b+y)+i,pz=2*(c+z)+j;
                q+=(1+(!i))*(1+(!j))*(src.value(px-1,py,pz)+2*src.value(px,py,pz)+src.value(px+1,py,pz));
            }
            data[a+8*b+64*c]=Sample(q/64);
        }
        out->put(k,data);
    }
    return out;
}
static std::unique_ptr<Grid> restoreDetail(const Grid& raw,const Grid& base,const Grid& smoothed,int step){
    auto out=std::make_unique<Grid>(raw.size[0],raw.size[1],raw.size[2]);const double inv=1./step;
    for(int z=0;z<raw.size[2];z+=8)for(int y=0;y<raw.size[1];y+=8)for(int x=0;x<raw.size[0];x+=8){
        size_t k=out->block(x/8,y/8,z/8);
        if(!smoothed.different(x/step,y/step,z/step,8/step+2,1)&&!raw.different(x,y,z,8,1)){out->map[k]=smoothed.value(x/step,y/step,z/step);continue;}
        Grid::Brick data;
        for(int c=0;c<8;++c)for(int b=0;b<8;++b)for(int a=0;a<8;++a){
            int X=x+a,Y=y+b,Z=z+c;double px=X*inv,py=Y*inv,pz=Z*inv;
            double v=smoothed.sample(px,py,pz),low=base.sample(px,py,pz);
            int fine=raw.value(X,Y,Z);
            // Restore detail where a coarse footprint entirely missed the opposite
            // side of a narrow sheet. Fade the correction across the coarse band.
            double retain=std::clamp((std::abs(low)/full-.55)/.4,0.,1.);
            if(low*fine<0||std::abs(fine)<full)v+=retain*(double(fine)-low);
            data[a+8*b+64*c]=quantize(v);
        }
        out->put(k,data);
    }
    return out;
}
}
using unite_field::Volume;
API Volume* begin_volume(int x,int y,int z){return new Volume(x,y,z);}
API void end_volume(Volume* v){delete v;}
API void volume_slab(Volume* v,const int16_t* field,int first,int layers){
    auto& g=v->raw;int nx=g.size[0],ny=g.size[1];
    for(int z=first;z<first+layers;++z)for(int y=0;y<ny;++y)for(int x=0;x<nx;x+=8){
        const auto* src=field+x+nx*(y+ny*(z-first));int n=std::min(8,nx-x),val=src[0];
        size_t k=g.block(x/8,y/8,z/8);
        if(!(y&7)&&!(z&7))g.map[k]=val;
        if(g.map[k]==val&&std::all_of(src+1,src+n,[&](int s){return s==val;}))continue;
        auto& b=g.writable(k);std::copy_n(src,n,b.begin()+g.offset(x,y,z));
    }
}
API int begin_filter(Volume* v,double radius){
    v->filtered.reset();v->coarse.reset();v->working.reset();v->step=1;
    if(radius<=0)return 1;
    while(radius/v->step>8&&v->step<std::max({v->raw.size[0],v->raw.size[1],v->raw.size[2]})){
        v->coarse=unite_field::half(v->base());v->step*=2;
    }
    const auto& g=v->base();v->working=std::make_unique<unite_field::Grid>(g.size[0],g.size[1],g.size[2]);
    return v->step;
}
API int filter_tile(Volume* v,int x,int y,int z,int w,int h,int d,int pad,int16_t* dst){
    const auto& g=v->base();auto& out=*v->working;
    int maxX=std::min(g.tiles[0]-1,(x+w-1+pad)/8),maxY=std::min(g.tiles[1]-1,(y+h-1+pad)/8),maxZ=std::min(g.tiles[2]-1,(z+d-1+pad)/8);
    int flat=g.value(x,y,z);
    bool uniform=flat<0||(x>=pad&&y>=pad&&z>=pad&&x+w+pad<g.size[0]&&y+h+pad<g.size[1]&&z+d+pad<g.size[2]);
    for(int c=std::max(0,z-pad)/8;c<=maxZ&&uniform;++c)for(int b=std::max(0,y-pad)/8;b<=maxY&&uniform;++b)
    for(int a=std::max(0,x-pad)/8;a<=maxX;++a)if(g.map[g.block(a,b,c)]!=flat){uniform=false;break;}
    if(uniform){
        for(int c=z/8;c<std::min((z+d)/8,g.tiles[2]);++c)for(int b=y/8;b<std::min((y+h)/8,g.tiles[1]);++b)
        for(int a=x/8;a<std::min((x+w)/8,g.tiles[0]);++a)out.map[out.block(a,b,c)]=flat;
        return 0;
    }
    int nx=w+2*pad,ny=h+2*pad;
    for(int c=0;c<d+2*pad;++c)for(int b=0;b<ny;++b){
        const int Y=y+b-pad,Z=z+c-pad;auto* row=dst+nx*(b+ny*c);int i=0;
        while(i<nx){
            int X=x+i-pad,len=std::min(8-(X&7),nx-i),m=-unite_field::full;
            if(X>=0&&X<g.size[0]&&unsigned(Y)<unsigned(g.size[1])&&unsigned(Z)<unsigned(g.size[2])){
                len=std::min(len,g.size[0]-X);m=g.map[g.block(X/8,Y/8,Z/8)];
            }
            if(m<32768)std::fill_n(row+i,len,int16_t(m));else std::copy_n(g.bricks[m-32768]->data()+g.offset(X,Y,Z),len,row+i);
            i+=len;
        }
    }
    return 1;
}
API void accept_filter_tile(Volume* v,int x,int y,int z,int w,int h,int d,const int16_t* src){
    auto& g=*v->working;
    for(int c=0;c<d&&c+z<g.size[2];c+=8)for(int b=0;b<h&&b+y<g.size[1];b+=8)for(int a=0;a<w&&a+x<g.size[0];a+=8){
        unite_field::Grid::Brick brick;
        for(int k=0;k<8;++k)for(int j=0;j<8;++j)std::copy_n(src+(a+w*(b+j+h*(c+k))),8,brick.data()+8*j+64*k);
        g.put(g.block((a+x)/8,(b+y)/8,(c+z)/8),brick);
    }
}
API void finish_filter(Volume* v){
    if(v->step==1)v->filtered=std::move(v->working);
    else v->filtered=unite_field::restoreDetail(v->raw,*v->coarse,*v->working,v->step);
    v->coarse.reset();v->working.reset();
}

API size_t volume_bytes(const Volume* v){return v->raw.bytes()+(v->filtered?v->filtered->bytes():0);}
API int contour_volume(Surface* s,const Volume* v,double ox,double oy,double oz,double pitch,unsigned optimization){
    const auto& g=v->field();
    int width=optimization?unite_contour::blockSize(optimization):16;
    int row=width+1;std::vector<int16_t> samples(row*row*row);
    Axes axes{{ox,oy,oz},pitch,{nullptr,nullptr,nullptr}};
    std::unique_ptr<unite_contour::Tile> tile;
    if(optimization){
        double t=optimization/100.;
        tile=std::make_unique<unite_contour::Tile>(*s,samples.data(),row,row,axes,width,.006+.64*t*t,optimization);
    }
    for(int z=0;z<g.size[2]-1;z+=width)for(int y=0;y<g.size[1]-1;y+=width)for(int x=0;x<g.size[0]-1;x+=width){
        if(!g.different(x,y,z,width+1,0))continue;
        int nx=std::min(row,g.size[0]-x),ny=std::min(row,g.size[1]-y),nz=std::min(row,g.size[2]-z);
        int stride=tile?row:nx,plane=stride*(tile?row:ny);
        for(int k=0;k<nz;++k)for(int j=0;j<ny;++j){
            auto* dst=samples.data()+k*plane+j*stride;
            for(int i=0;i<nx;){
                int X=x+i,len=std::min(8-(X&7),nx-i);
                int m=g.map[g.block(X/8,(y+j)/8,(z+k)/8)];
                if(m<32768)std::fill_n(dst+i,len,int16_t(m));
                else std::copy_n(g.bricks[m-32768]->data()+g.offset(X,y+j,z+k),len,dst+i);
                i+=len;
            }
        }
        if(tile){
            tile->first[0]=x;tile->first[1]=y;tile->first[2]=z;
            tile->size[0]=nx-1;tile->size[1]=ny-1;tile->size[2]=nz-1;
            if(!tile->emit())return 1;
        }else if(regular_grid(s,samples.data(),nx,ny,nz,x,y,z,axes))return 1;
    }
    return 0;
}
