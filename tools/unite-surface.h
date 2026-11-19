// Final material component filter for both exact and sampled Unite surfaces.
// Positions are local millimetres. Error budgets are fractions of the original cell.
namespace unite_surface {
static D add(D a,D b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
static D scale(D a,double k){return {a.x*k,a.y*k,a.z*k};}
static V vertex(D a){return {float(a.x),float(a.y),float(a.z)};}
static D normal(V a,V b,V c){return cross(sub(val(b),val(a)),sub(val(c),val(a)));}
static D unit(D v){double l=std::sqrt(dot(v,v));return l>0?scale(v,1/l):D{};}
static void compact(std::vector<V>& points,std::vector<U>& faces){
    std::vector<U> index(points.size(),none);
    for(U v:faces)if(v!=none)index[v]=0;
    U nv=0;
    for(U i=0;i<points.size();++i)if(index[i]!=none){index[i]=nv;points[nv++]=points[i];}
    size_t ni=0;
    for(U v:faces)if(v!=none)faces[ni++]=index[v];
    points.resize(nv);faces.resize(ni);
}

struct Components {
    std::vector<int> parent;
    explicit Components(size_t n):parent(n,-1){}
    U root(U v){
        U r=v;while(parent[r]>=0)r=U(parent[r]);
        while(v!=r){U next=U(parent[v]);parent[v]=int(r);v=next;}
        return r;
    }
    void join(U a,U b){
        a=root(a);b=root(b);if(a==b)return;
        if(parent[a]>parent[b])std::swap(a,b);
        parent[a]+=parent[b];parent[b]=int(a);
    }
};
struct Island {
    Box bounds;U sample;bool large=false,discard=false;double sixVolume=0;
    std::vector<U> faces;
    explicit Island(U vertex):sample(vertex){}
};
static bool encloses(const Island& s,D point,const std::vector<V>& p,const std::vector<U>& t){
    double angle=0;
    for(U i:s.faces){
        D a=sub(val(p[t[i]]),point),b=sub(val(p[t[i+1]]),point),c=sub(val(p[t[i+2]]),point);
        double x=std::sqrt(dot(a,a)),y=std::sqrt(dot(b,b)),z=std::sqrt(dot(c,c));
        angle+=std::atan2(dot(a,cross(b,c)),x*y*z+dot(a,b)*z+dot(b,c)*x+dot(c,a)*y);
    }
    return std::abs(angle)>3.141592653589793;
}
static U dropSpecks(std::vector<V>& p,std::vector<U>& t,double pitch){
    if(t.empty())return 0;
    Components sets(p.size());
    for(size_t i=0;i<t.size();i+=3){sets.join(t[i],t[i+1]);sets.join(t[i],t[i+2]);}
    std::vector<Island> islands;
    for(U i=0;i<p.size();++i)if(sets.parent[i]<0){
        islands.emplace_back(i);sets.parent[i]=-int(islands.size());
    }
    auto group=[&](U i){return U(-sets.parent[sets.root(i)]-1);};
    for(U i=0;i<p.size();++i){
        auto& s=islands[group(i)];
        if(!s.large){s.bounds.add(val(p[i]));s.large=s.bounds.span()>=pitch;}
    }
    if(std::all_of(islands.begin(),islands.end(),[](const Island& s){return s.large;}))return 0;
    for(U i=0;i<t.size();i+=3){
        auto& s=islands[group(t[i])];if(s.large)continue;
        s.sixVolume+=dot(sub(val(p[t[i]]),val(p[s.sample])),normal(p[t[i]],p[t[i+1]],p[t[i+2]]));
        s.faces.push_back(i);
    }
    std::vector<U> solids;
    for(U i=0;i<islands.size();++i)if(!islands[i].large&&islands[i].sixVolume>0){islands[i].discard=true;solids.push_back(i);}
    if(solids.empty())return 0;
    std::sort(solids.begin(),solids.end(),[&](U a,U b){return islands[a].bounds.lo.x<islands[b].bounds.lo.x;});
    // Cavities belong to the enclosing material. Keep a small void in a large
    // body, but remove all its boundary sheets when that material is discarded.
    for(auto& hole:islands)if(!hole.large&&!hole.discard){
        auto i=std::lower_bound(solids.begin(),solids.end(),hole.bounds.lo.x-pitch,[&](U a,double x){return islands[a].bounds.lo.x<x;});
        for(;i!=solids.end()&&islands[*i].bounds.lo.x<=hole.bounds.lo.x;++i){
            auto& solid=islands[*i];
            if(solid.bounds.contains(hole.bounds)&&encloses(solid,val(p[hole.sample]),p,t)){hole.discard=true;break;}
        }
    }
    for(const auto& s:islands)if(s.discard)for(U i:s.faces)t[i]=t[i+1]=t[i+2]=none;
    compact(p,t);return U(solids.size());
}

}

API void resize_surface(Surface* s,U points,U indices){s->vertices.points.resize(points);s->indices.resize(indices);}
API void finish_surface(Surface* s,double pitch,U* stats){
    std::vector<U>().swap(s->vertices.slots);
    if(s->fallbackTiles)unite_surface::compact(s->vertices.points,s->indices);
    stats[0]=s->referenceFaces?s->referenceFaces:U(s->indices.size()/3);
    stats[1]=unite_surface::dropSpecks(s->vertices.points,s->indices,pitch);
    stats[2]=s->patches;stats[3]=s->fittedCells;stats[4]=s->omittedCrossings;stats[5]=s->fallbackTiles;
}
