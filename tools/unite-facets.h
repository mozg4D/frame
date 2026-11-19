// A single, closed, embedded source shell already bounds its unsmoothed
// material. Prove that property before reusing any triangular facet.
namespace unite_facets {
using namespace unite_outline;
using unite_surface::unit;using unite_surface::add;using unite_surface::scale;
static bool compatible(const Geometry& g,U i,U j){
    auto a=g.f[i],b=g.f[j];U common[3],n=0;
    for(U u:a.v)for(U v:b.v)if(u==v)common[n++]=u;
    if(!n)return !touch(g.tri(i),g.tri(j),true);
    if(n==3)return false;
    D o=val(g.p[common[0]]);std::array<D,4> rays;int k=0;
    for(U v:a.v)if(v!=common[0]&&(n==1||v!=common[1]))rays[k++]=unit(sub(val(g.p[v]),o));
    for(U v:b.v)if(v!=common[0]&&(n==1||v!=common[1]))rays[k++]=unit(sub(val(g.p[v]),o));
    if(n==2){
        D edge=unit(sub(val(g.p[common[1]]),o));D l=unit(cross(edge,rays[0])),r=unit(cross(edge,rays[1]));
        return dot(l,r)<-1.e-10||std::abs(dot(cross(l,r),edge))>1.e-10;
    }
    // A strictly separating plane through the common vertex separates both
    // triangle cones. Its normal is the closest feature of the tetrahedron
    // of signed directions to the origin (a vertex, edge or face).
    rays[2]=scale(rays[2],-1);rays[3]=scale(rays[3],-1);
    auto separates=[&](D n){double len=std::sqrt(dot(n,n));if(len<1.e-12)return false;
        for(D v:rays)if(dot(v,n)<=len*1.e-10)return false;return true;};
    for(int i=0;i<4;++i){
        if(separates(rays[i]))return true;
        for(int j=i+1;j<4;++j){
            D d=sub(rays[j],rays[i]);double dd=dot(d,d);
            if(dd>0&&separates(sub(rays[i],scale(d,dot(rays[i],d)/dd))))return true;
            for(int k=j+1;k<4;++k){D n=cross(d,sub(rays[k],rays[i]));if(separates(n)||separates(scale(n,-1)))return true;}
        }
    }
    return false;
}
static bool embedded(const Geometry& g){
    Shell shell;shell.faces.resize(g.f.size());std::iota(shell.faces.begin(),shell.faces.end(),0u);Tree tree(g,shell);
    U visits=0;
    auto check=[&](auto& self,U id,U f,const Box& box)->bool{
        const auto& node=tree.nodes[id];if(!node.box.overlaps(box))return true;
        if(node.left!=none)return self(self,node.left,f,box)&&self(self,node.right,f,box);
        for(U i=node.start;i<node.end;++i){
            U other=tree.ids[i];if(other<=f||!g.box(other).overlaps(box))continue;
            if(++visits>1000000||!compatible(g,f,other))return false;
        }
        return true;
    };
    for(U f=0;f<g.f.size();++f)if(!check(check,0,f,g.box(f)))return false;
    return true;
}
}
API int faceted_perimeters(Surface* surface,const V* soup,U count,double pitch){
    using namespace unite_facets;
    if(!count||count>16384||!(pitch>0))return 0;
    Surface original;std::vector<F> faces(count);
    for(U i=0;i<count;++i)for(int j=0;j<3;++j){
        U v=original.vertices.insert(soup[3*i+j]);faces[i].v[j]=v;original.indices.push_back(v);
    }
    Geometry geometry{original.vertices.points,faces};
    if(!closedLinks(original,{}))return 0;
    std::vector<U> mate(3*count,none);std::unordered_map<U64,U> edges;
    std::vector<D> normals(count);std::vector<double> area(count);std::vector<U> order(count),owner(count,none);
    std::iota(order.begin(),order.end(),0u);
    double magnitude=0;for(V p:geometry.p)magnitude=std::max({magnitude,std::abs(double(p.x)),std::abs(double(p.y)),std::abs(double(p.z))});
    double ulp=std::nextafter(float(magnitude),std::numeric_limits<float>::infinity())-float(magnitude);
    const double eps=std::min(.001*pitch,std::max(1.e-8*pitch,3*ulp));
    for(U i=0;i<count;++i){auto t=geometry.tri(i);D n=cross(sub(t[1],t[0]),sub(t[2],t[0]));area[i]=dot(n,n);normals[i]=unit(n);}
    std::sort(order.begin(),order.end(),[&](U a,U b){return area[a]>area[b]||(area[a]==area[b]&&a<b);});
    unite_surface::Components shells(count);
    for(U c=0;c<mate.size();++c){
        U f=c/3,j=c%3,a=faces[f].v[j],b=faces[f].v[(j+1)%3];auto [it,fresh]=edges.emplace(edgeKey(a,b),c);
        if(!fresh){U e=it->second;mate[c]=e;mate[e]=c;shells.join(f,e/3);}
    }
    if(shells.parent[shells.root(0)]!=-int(count)||!embedded(geometry))return 0;
    // Compare the entire region to one well-conditioned source plane. STL
    // decimals rounded to Float32 can split an otherwise flat facet.
    std::vector<std::vector<U>> components(count);
    for(U seed:order)if(owner[seed]==none){
        auto& patch=components[seed];patch.push_back(seed);owner[seed]=seed;
        D n=normals[seed],o=geometry.tri(seed)[0];
        for(size_t i=0;i<patch.size();++i)for(U j=0;j<3;++j){
            U f=mate[3*patch[i]+j]/3;if(owner[f]!=none||dot(n,normals[f])<.99999)continue;
            auto t=geometry.tri(f);
            if(!std::all_of(t.begin(),t.end(),[&](D v){return std::abs(dot(sub(v,o),n))<=eps;}))continue;
            owner[f]=seed;patch.push_back(f);
        }
    }
    double totalArea=0,broadArea=0;
    for(const auto& patch:components){
        double twice=0;for(U f:patch)twice+=std::sqrt(area[f]);totalArea+=twice;
        if(twice>=80*pitch*pitch)broadArea+=twice;
    }
    if(broadArea<.5*totalArea)return 0;
    struct Patch {Outline cap;std::vector<U> ids;int axis,sign;};
    std::vector<Patch> patches;std::vector<unsigned char> keep(geometry.p.size());std::vector<F> isolated;
    U skipped=0;
    for(U root=0;root<count;++root){
        const auto& fs=components[root];if(fs.empty())continue;
        if(fs.size()==1){auto f=faces[fs[0]];for(U v:f.v)keep[v]=1;isolated.push_back(f);continue;}
        std::vector<Side> sides;int d=0;D n=normals[fs[0]];
        for(int k=1;k<3;++k)if(std::abs(at(n,k))>std::abs(at(n,d)))d=k;
        for(U f:fs)for(int j=0;j<3;++j){
            U a=faces[f].v[j];
            if(owner[mate[3*f+j]/3]!=root)sides.push_back({a,faces[f].v[(j+1)%3]});
        }
        patches.push_back({{}, {},d,at(n,d)>0?1:-1});auto& patch=patches.back();
        if(!patch.cap.trace(sides,[&](U64 id){patch.ids.push_back(U(id));return geometry.p[id];}))return 0;
        for(const Ring& ring:patch.cap.rings){
            const int m=ring.size();auto id=[&](int k){return patch.ids[ring[k%m]];};auto p=[&](int k){return val(geometry.p[id(k)]);};
            int a=0,b=0;double bend=-1,length=0;
            for(int j=0;j<m;++j){
                D l=unit(sub(p(j),p((j+m-1)%m))),r=unit(sub(p(j+1),p(j)));
                double angle=1-dot(l,r);if(angle>bend){bend=angle;a=j;}
            }
            for(int j=0;j<m;++j){D d=sub(p(j),p(a));double l=dot(d,d);if(l>length){length=l;b=j;}}
            if(!length)return 0;
            if(b<a)b+=m;
            std::vector<std::array<int,2>> arcs{{a,b},{b,a+m}};
            while(!arcs.empty()){
                auto [i,j]=arcs.back();arcs.pop_back();keep[id(i)]=keep[id(j)]=1;
                D o=p(i),d=sub(p(j),o);double size=dot(d,d),worst=eps*eps;int split=-1;
                for(int k=i+1;k<j;++k){
                    D v=sub(p(k),o);D gap=sub(v,scale(d,size?std::clamp(dot(v,d)/size,0.,1.):0.));double err=dot(gap,gap);
                    if(err>worst){worst=err;split=k;}
                }
                if(split>=0){arcs.push_back({i,split});arcs.push_back({split,j});}
            }
        }
        int inner=(3*int(fs.size())-int(sides.size()))/2-int(fs.size())+2-int(patch.cap.rings.size());
        if(inner<0)return 0;
        skipped+=U(inner);
    }
    Surface result;result.perimeterPatches=isolated.size()+patches.size();result.referenceFaces=count;
    result.perimeterInterior=skipped;
    for(F f:isolated)for(U v:f.v)result.indices.push_back(result.vertices.insert(geometry.p[v]));
    for(auto& patch:patches){
        for(Ring& ring:patch.cap.rings){
            size_t old=ring.size();ring.erase(std::remove_if(ring.begin(),ring.end(),[&](U v){return !keep[patch.ids[v]];}),ring.end());
            if(ring.size()<3)return 0;result.perimeterRimSkipped+=old-ring.size();
        }
        if(!patch.cap.fill(patch.axis,patch.sign))return 0;
        result.perimeterHoles+=patch.cap.rings.size()-1;patch.cap.emit(result);
    }
    if(!closedLinks(result,{}))return 0;
    if(!patches.empty()){
        std::vector<F> check(result.indices.size()/3);
        for(U i=0;i<check.size();++i)std::copy_n(result.indices.begin()+3*i,3,check[i].v);
        if(!embedded({result.vertices.points,check}))return 0;
    }
    *surface=std::move(result);return 1;
}
