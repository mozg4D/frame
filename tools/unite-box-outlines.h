// Exact faces of an orthogonal solid use the same boundary-only filler.
// Preserve a straight-edge sample if another incident face needs its corner.
API int exact_perimeters(Surface* surface,const double* xs,const double* ys,const double* zs,int nx,int ny,int nz,const uint8_t* inside){
    using namespace unite_outline;
    int dims[]={nx,ny,nz};int sx=nx+1,sy=ny+1;
    auto key=[&](const std::array<int,3>& p){return U(p[0]+sx*(p[1]+sy*p[2]));};
    auto pos=[&](U64 id){int x=int(id%sx);id/=sx;return V{float(xs[x]),float(ys[id%sy]),float(zs[id/sy])};};
    struct Face {Outline cap;std::vector<U> keys;int axis,sign;U cells;};
    std::vector<Face> faces;std::vector<unsigned char> keep(size_t(sx)*sy*(nz+1));
    for(int d=0;d<3;++d)for(int sign:{-1,1}){
        int u=(d+1)%3,v=(d+2)%3,w=dims[u],h=dims[v];
        auto point=[&](int a,int b,int c){std::array<int,3> p;p[u]=a;p[v]=b;p[d]=c;return p;};
        auto full=[&](int a,int b,int c){if(c<0||c>=dims[d])return false;auto p=point(a,b,c);return bool(inside[p[0]+nx*(p[1]+ny*p[2])]);};
        std::vector<unsigned char> mask(w*h);std::vector<int> group;std::vector<Side> sides;
        for(int c=0;c<dims[d];++c){
            for(int b=0;b<h;++b)for(int a=0;a<w;++a)mask[a+b*w]=full(a,b,c)&&!full(a,b,c+sign);
            for(int seed=0;seed<w*h;++seed)if(mask[seed]==1){
                group.clear();group.push_back(seed);mask[seed]=2;sides.clear();
                for(size_t q=0;q<group.size();++q){
                    int a=group[q]%w,b=group[q]/w,k=c+(sign>0);
                    U corners[]={key(point(a,b,k)),key(point(a+1,b,k)),key(point(a+1,b+1,k)),key(point(a,b+1,k))};
                    int x[]={a,a+1,a,a-1},y[]={b-1,b,b+1,b};
                    for(int j=0;j<4;++j){
                        int i=x[j]+w*y[j];
                        if(x[j]>=0&&x[j]<w&&y[j]>=0&&y[j]<h&&mask[i]){
                            if(mask[i]==1){mask[i]=2;group.push_back(i);}
                        }else{
                            U start=corners[j],end=corners[(j+1)%4];if(sign<0)std::swap(start,end);sides.push_back({start,end});
                        }
                    }
                }
                faces.push_back({{}, {},d,sign,U(group.size())});auto& face=faces.back();
                if(!face.cap.trace(sides,[&](U64 a){face.keys.push_back(U(a));return pos(a);}))return 0;
                for(const auto& ring:face.cap.rings)for(size_t j=0;j<ring.size();++j){
                    auto a=val(face.cap.points[ring[(j+ring.size()-1)%ring.size()]]),b=val(face.cap.points[ring[j]]),e=val(face.cap.points[ring[(j+1)%ring.size()]]);
                    D bend=cross(sub(b,a),sub(e,b));if(dot(bend,bend)>0)keep[face.keys[ring[j]]]=1;
                }
            }
        }
    }
    Surface result;
    for(auto& f:faces){
        U border=f.keys.size(),holes=U(f.cap.rings.size()-1);
        for(auto& ring:f.cap.rings){
            ring.erase(std::remove_if(ring.begin(),ring.end(),[&](U v){return !keep[f.keys[v]];}),ring.end());
            if(ring.size()<3)return 0;
        }
        if(!f.cap.fill(f.axis,f.sign))return 0;
        f.cap.emit(result);++result.perimeterPatches;result.perimeterCells+=f.cells;result.perimeterHoles+=holes;
        int interior=int(f.cells)+1-int(border/2)-int(holes);if(interior<0)return 0;
        result.perimeterInterior+=U(interior);result.referenceFaces+=2*f.cells;
        for(const auto& ring:f.cap.rings)border-=ring.size();result.perimeterRimSkipped+=border;
    }
    if(!closedLinks(result,{}))return 0;
    *surface=std::move(result);return 1;
}
