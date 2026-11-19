// Source facets propose supporting planes. Only the completed material field
// decides which cells belong to them, including overlaps, slits and cavities.
namespace unite_planes {
using UV=std::array<double,2>;
using PlaneKey=std::array<int,4>;
struct PlaneHash {
    size_t operator()(const PlaneKey& k)const{return hash3(k[0],k[1],k[2])^mix(U(k[3]));}
};
struct Footprint {UV p[3];};
struct Support {
    PlaneKey key;
    D n,origin;
    Box bounds;
    U64 weight=0;
    double largest=0;
    int axis=0;
    std::vector<Footprint> facets;
};
static std::vector<Support> supports;
static bool precedes(D a,D b){
    return a.x<b.x||(a.x==b.x&&(a.y<b.y||(a.y==b.y&&a.z<b.z)));
}
static U pointHash(V p){
    return bits(p.x)*0x9e3779b1u^bits(p.y)*0x85ebca77u^bits(p.z)*0xc2b2ae3du;
}
static void propose(const V* soup,U count,D origin,double pitch){
    supports.clear();if(!(pitch>0)||!count)return;
    std::unordered_map<PlaneKey,U,PlaneHash> bins;std::vector<Support> list;
    const U step=std::max(1u,count/12000);const double h2=pitch*pitch;
    for(U f=0;f<count;++f){
        const V* tri=soup+3*f;D a=val(tri[0]),b=val(tri[1]),c=val(tri[2]);
        D n=cross(sub(b,a),sub(c,a));double area2=dot(n,n);
        bool large=area2>4096*h2*h2;
        // Imported GPU triangles can arrive in a different order on each
        // open. Sample by geometry and choose the same plane representative.
        if(!large&&step>1){
            U hash=pointHash(tri[0])^pointHash(tri[1])^pointHash(tri[2]);
            hash=(hash^(hash>>16))*0x7feb352du;
            if((hash^(hash>>15))%step)continue;
        }
        if(precedes(b,a))std::swap(a,b);
        if(precedes(c,a))std::swap(a,c);
        if(precedes(c,b))std::swap(b,c);
        n=cross(sub(b,a),sub(c,a));double area=std::sqrt(dot(n,n));if(!area)continue;
        n={n.x/area,n.y/area,n.z/area};
        PlaneKey key{int(std::round(n.x*2000)),int(std::round(n.y*2000)),int(std::round(n.z*2000)),0};
        int d=0;
        for(int k=1;k<3;++k)if(std::abs(key[k])>std::abs(key[d]))d=k;
        if(key[d]<0){
            n={-n.x,-n.y,-n.z};
            for(int k=0;k<3;++k)key[k]=-key[k];
        }
        key[3]=int(std::round(dot(n,sub(a,origin))*16/pitch));
        auto [it,fresh]=bins.emplace(key,U(list.size()));
        if(fresh)list.push_back({key,n,a,{},0,0,d,{}});
        auto& plane=list[it->second];
        if(area>plane.largest||(area==plane.largest&&(precedes(a,plane.origin)||
           (!precedes(plane.origin,a)&&precedes(n,plane.n))))){
            plane.largest=area;plane.n=n;plane.origin=a;
        }
        // Integer weights keep near ties reproducible when adding many facets.
        plane.weight+=U64(std::round(.5*area*(large?1:step)*1024/h2));
        plane.bounds.add(a);plane.bounds.add(b);plane.bounds.add(c);
        if(large){
            int u=(d+1)%3,v=(d+2)%3;
            plane.facets.push_back({{{at(a,u),at(a,v)},{at(b,u),at(b,v)},{at(c,u),at(c,v)}}});
        }
    }
    std::sort(list.begin(),list.end(),[](const Support& a,const Support& b){
        return a.weight!=b.weight?a.weight>b.weight:a.key<b.key;
    });
    for(auto& plane:list){
        if(plane.weight<48*1024)break;
        int d=plane.axis,u=(d+1)%3,v=(d+2)%3;D span=sub(plane.bounds.hi,plane.bounds.lo);
        if(std::min(at(span,u),at(span,v))>=4*pitch)supports.push_back(std::move(plane));
    }
}
}
