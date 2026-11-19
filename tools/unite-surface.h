// Final processing of the indexed Unite boundary in its owning worker.
// Positions are local millimetres. Error budgets are fractions of the original cell.
namespace unite_surface {
static D add(D a,D b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
static D scale(D a,double k){return {a.x*k,a.y*k,a.z*k};}
static V vertex(D a){return {float(a.x),float(a.y),float(a.z)};}
static D normal(V a,V b,V c){return cross(sub(val(b),val(a)),sub(val(c),val(a)));}
static D unit(D v){double l=std::sqrt(dot(v,v));return l>0?scale(v,1/l):D{};}
static U nextCorner(U c){return c%3==2?c-2:c+1;}
static U prevCorner(U c){return c%3==0?c+2:c-1;}

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

struct Rings {
    std::vector<U> head,next;
    explicit Rings(size_t n,const std::vector<U>& t):head(n,none),next(t.size()){
        for(U i=0;i<t.size();++i){next[i]=head[t[i]];head[t[i]]=i;}
    }
};
struct Features {
    std::vector<V> face;
    std::vector<unsigned char> sharp;
    Features(const std::vector<V>& p,const std::vector<U>& t):face(t.size()/3),sharp(p.size()){measure(p,t);}
    void measure(const std::vector<V>& p,const std::vector<U>& t){
        // Preserve original feature locks if simplification remeasures a smoothed surface.
        std::vector<V> axis(p.size());
        for(U i=0;i<t.size();i+=3){
            D n=unit(normal(p[t[i]],p[t[i+1]],p[t[i+2]]));face[i/3]=vertex(n);
            for(int j=0;j<3;++j){auto& a=axis[t[i+j]];a=vertex(add(val(a),n));}
        }
        for(auto& a:axis)a=vertex(unit(val(a)));
        // A cone of half the native 44-degree crease threshold cannot contain
        // both normals of a hard edge. Lock its corners during smoothing.
        constexpr double cone=0.9271838545667874; // cos(22 degrees)
        for(U i=0;i<t.size();++i)if(dot(val(face[i/3]),val(axis[t[i]]))<cone)sharp[t[i]]=1;
    }
};
static U smooth(std::vector<V>& p,const std::vector<U>& t,const Rings& ring,const Features& f,double pitch,double strength){
    const auto original=p;std::vector<V> next(p.size());
    const double limit=.45*pitch*strength;
    const double steps[]={.48,.48,.48};
    for(double step:steps){
        for(U i=0;i<p.size();++i){
            next[i]=p[i];if(f.sharp[i])continue;
            D center=val(p[i]),total{};U count=0;
            for(U c=ring.head[i];c!=none;c=ring.next[c]){
                total=add(total,sub(val(p[t[nextCorner(c)]]),center));++count;
            }
            if(!count)continue;
            D displacement=add(sub(center,val(original[i])),scale(total,step*strength/count));
            double length2=dot(displacement,displacement);
            if(length2>limit*limit)displacement=scale(displacement,limit/std::sqrt(length2));
            next[i]=vertex(add(val(original[i]),displacement));
        }
        // Rolling back a failed face can affect its neighbours. Publish the pass
        // only after every surviving face has passed with its final positions.
        for(int retry=0;retry<5;++retry){
            bool valid=true;
            for(U i=0;i<t.size();i+=3){
                U a=t[i],b=t[i+1],c=t[i+2];
                D old=normal(p[a],p[b],p[c]),now=normal(next[a],next[b],next[c]);
                if(dot(old,now)>1.e-5*dot(old,old))continue;
                next[a]=p[a];next[b]=p[b];next[c]=p[c];valid=false;
            }
            if(valid){p.swap(next);break;}
        }
    }
    U moved=0;for(U i=0;i<p.size();++i)if(std::memcmp(&original[i],&p[i],sizeof(V))!=0)++moved;
    return moved;
}

// Plane quadrics in units of one cell, stored about each surviving endpoint.
// Moving a quadric's origin when merging avoids cancellation far from world zero.
struct Quadric {
    float xx=0,yy=0,zz=0,xy=0,xz=0,yz=0,bx=0,by=0,bz=0,c=0,w=0;
    void plane(D n){
        xx+=float(n.x*n.x);yy+=float(n.y*n.y);zz+=float(n.z*n.z);
        xy+=float(n.x*n.y);xz+=float(n.x*n.z);yz+=float(n.y*n.z);w+=1;
    }
    D product(D d) const {return {xx*d.x+xy*d.y+xz*d.z,xy*d.x+yy*d.y+yz*d.z,xz*d.x+yz*d.y+zz*d.z};}
    double error(D d) const {return dot(d,product(d))+2*(bx*d.x+by*d.y+bz*d.z)+c;}
    void absorb(const Quadric& q,D displacement){
        D ad=q.product(displacement);
        c+=float(q.error(displacement));bx+=q.bx+float(ad.x);by+=q.by+float(ad.y);bz+=q.bz+float(ad.z);
        xx+=q.xx;yy+=q.yy;zz+=q.zz;xy+=q.xy;xz+=q.xz;yz+=q.yz;w+=q.w;
    }
};
static U optimize(std::vector<V>& p,std::vector<U>& t,Rings& rings,const Features& f,double pitch,unsigned percent){
    size_t remaining=t.size()/3;
    const size_t target=std::max<size_t>(4,remaining-remaining*uint64_t(percent)/100);
    if(remaining<target+2)return 0;
    std::vector<Quadric> quadrics(p.size());std::vector<U> degree(p.size()),marked(p.size(),none);
    for(U i=0;i<t.size();++i){quadrics[t[i]].plane(val(f.face[i/3]));++degree[t[i]];}
    const double inv=1/pitch,tolerance=.02+.28*percent/100.,tolerance2=tolerance*tolerance;
    U collapsed=0,stamp=0;
    for(U pass=0;pass<10&&remaining>=target+2;++pass){
        U previous=collapsed;
        for(U k=0;k<p.size()&&remaining>=target+2;++k){
            U a=pass%2?U(p.size()-1-k):k;
            if(degree[a]<3||degree[a]>40)continue;
            D point=val(p[a]);U b=none;double best=INFINITY;
            for(U edge=rings.head[a];edge!=none;edge=rings.next[edge]){
                if(t[edge]==none)continue;
                U candidate=t[nextCorner(edge)];if(degree[candidate]>40||f.sharp[a]&&!f.sharp[candidate])continue;
                D d=scale(sub(val(p[candidate]),point),inv);
                double error=std::max(0.,quadrics[a].error(d))/quadrics[a].w;
                // Sharp endpoints can disappear only along the intersection of
                // all their incident planes, preserving corners and straight ridges.
                if(error>(f.sharp[a]?1.e-12:tolerance2))continue;
                double score=error+1.e-5*dot(d,d);
                if(score<best){best=score;b=candidate;}
            }
            if(b==none)continue;
            U opposite[2]{},removed[2]{},uses=0;bool safe=true;++stamp;
            for(U edge=rings.head[a];edge!=none;edge=rings.next[edge]){
                if(t[edge]==none)continue;
                U u=t[nextCorner(edge)],v=t[prevCorner(edge)];marked[u]=marked[v]=stamp;
                if(u==b||v==b){
                    if(uses==2){safe=false;break;}
                    opposite[uses]=u==b?v:u;removed[uses++]=edge-edge%3;continue;
                }
                D old=normal(p[a],p[u],p[v]),now=normal(p[b],p[u],p[v]);
                const double alignment=dot(old,now);
                if(alignment<=1.e-4*dot(old,old)||alignment*alignment<.25*dot(old,old)*dot(now,now)){safe=false;break;}
                D d=sub(val(p[b]),point);
                if(std::pow(dot(old,d),2)>dot(old,old)*pitch*pitch*(f.sharp[a]?1.e-12:tolerance2)){safe=false;break;}
            }
            if(!safe||uses!=2||opposite[0]==opposite[1]||(degree[a]==3&&degree[b]==3))continue;
            // The edge link must contain exactly the two opposite vertices.
            for(U edge=rings.head[b];edge!=none;edge=rings.next[edge])if(t[edge]!=none){
                U v=t[nextCorner(edge)];if(marked[v]==stamp&&v!=opposite[0]&&v!=opposite[1]){safe=false;break;}
            }
            if(!safe)continue;
            for(U i:removed)t[i]=t[i+1]=t[i+2]=none;
            for(U edge=rings.head[a];edge!=none;){
                U next=rings.next[edge];
                if(t[edge]!=none){t[edge]=b;rings.next[edge]=rings.head[b];rings.head[b]=edge;}
                edge=next;
            }
            rings.head[a]=none;degree[b]=degree[b]+degree[a]-4;degree[a]=0;--degree[opposite[0]];--degree[opposite[1]];
            quadrics[b].absorb(quadrics[a],scale(sub(val(p[b]),point),inv));remaining-=2;++collapsed;
        }
        if(previous==collapsed)break;
    }
    if(collapsed)compact(p,t);
    return collapsed;
}
}

API void resize_surface(Surface* s,U points,U indices){s->vertices.points.resize(points);s->indices.resize(indices);}
API void finish_surface(Surface* s,double pitch,unsigned smoothing,unsigned optimization,U* stats){
    using namespace unite_surface;
    auto& p=s->vertices.points;auto& t=s->indices;
    std::vector<U>().swap(s->vertices.slots);
    stats[0]=U(t.size()/3);stats[2]=stats[3]=0;
    if(!t.empty()&&(smoothing||optimization)){
        Rings rings(p.size(),t);Features features(p,t);
        if(smoothing)stats[2]=smooth(p,t,rings,features,pitch,smoothing/100.);
        if(optimization){
            if(stats[2])features.measure(p,t);
            stats[3]=optimize(p,t,rings,features,pitch,optimization);
        }
    }
    stats[1]=dropSpecks(p,t,pitch);
}
