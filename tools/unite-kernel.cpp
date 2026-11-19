// Prepare polygon soup for directional solid rasterization. Vertex equality is
// exact in STL precision. An edge with more than two uses is not an orientation constraint.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <numeric>
#include <vector>

#define API extern "C"
using U = uint32_t;
using U64 = uint64_t;
constexpr U none = ~U(0);
struct V { float x,y,z; };
struct D { double x,y,z; };
struct F { U v[3]; };
static D val(V a) { return {a.x,a.y,a.z}; }
static D sub(D a,D b) { return {a.x-b.x,a.y-b.y,a.z-b.z}; }
static D cross(D a,D b) { return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x}; }
static double dot(D a,D b) { return a.x*b.x+a.y*b.y+a.z*b.z; }
static double at(D a,int k) { return k==0?a.x:(k==1?a.y:a.z); }
static U bits(float x) { U b; std::memcpy(&b,&x,4); return x==0 ? 0 : b; }
static U64 mix(U64 v) {
    v ^= v>>30; v *= 0xbf58476d1ce4e5b9ULL;
    v ^= v>>27; v *= 0x94d049bb133111ebULL; return v ^ (v>>31);
}
static size_t capacity(size_t n) { size_t s=16; while(s < n) s*=2; return s; }
static U64 hash3(U a,U b,U c) { return mix((U64(a)<<32)|b) ^ mix(c); }
struct Vertices {
    std::vector<V> points;
    std::vector<U> slots;
    explicit Vertices(size_t guess):slots(capacity(guess*2),none) {points.reserve(guess);}
    static U64 hash(V p) {return hash3(bits(p.x),bits(p.y),bits(p.z));}
    U insert(V p) {
        if(points.size()*4 >= slots.size()*3) {
            slots.assign(slots.size()*2,none);
            for(U j=0;j<points.size();++j) {
                size_t k=hash(points[j])&(slots.size()-1);
                while(slots[k]!=none) k=(k+1)&(slots.size()-1);
                slots[k]=j;
            }
        }
        size_t k=hash(p)&(slots.size()-1);
        for(;;k=(k+1)&(slots.size()-1)) {
            U j=slots[k];
            if(j==none) { slots[k]=U(points.size()); points.push_back(p); return slots[k]; }
            auto q=points[j];
            if(p.x==q.x && p.y==q.y && p.z==q.z) return j;
        }
    }
};
struct ParitySets {
    std::vector<U> parent,size;
    std::vector<uint8_t> parity;
    explicit ParitySets(U n):parent(n),size(n,1),parity(n,0) {std::iota(parent.begin(),parent.end(),0u);}
    U find(U x) {
        if(parent[x]!=x) {
            U p=parent[x]; parent[x]=find(p); parity[x]^=parity[p];
        }
        return parent[x];
    }
    bool join(U a,U b,uint8_t rel) {
        U p=find(a),q=find(b);
        rel ^= parity[a]^parity[b];
        if(p==q) return rel==0;
        if(size[p]<size[q]) std::swap(p,q);
        parent[q]=p; parity[q]=rel; size[p]+=size[q]; return true;
    }
};
struct Edge { U64 key; U faceDir; };
struct Box {
    D lo{INFINITY,INFINITY,INFINITY},hi{-INFINITY,-INFINITY,-INFINITY};
    void add(D q) {
        lo={std::min(lo.x,q.x),std::min(lo.y,q.y),std::min(lo.z,q.z)};
        hi={std::max(hi.x,q.x),std::max(hi.y,q.y),std::max(hi.z,q.z)};
    }
    double span() const {return std::max({hi.x-lo.x,hi.y-lo.y,hi.z-lo.z});}
    bool contains(const Box& b) const {
        return lo.x<=b.lo.x && lo.y<=b.lo.y && lo.z<=b.lo.z && hi.x>=b.hi.x && hi.y>=b.hi.y && hi.z>=b.hi.z;
    }
    bool overlaps(const Box& b) const {
        return lo.x<=b.hi.x && lo.y<=b.hi.y && lo.z<=b.hi.z && b.lo.x<=hi.x && b.lo.y<=hi.y && b.lo.z<=hi.z;
    }
};
struct Shell {
    Box box; std::vector<U> faces;
    double sixVolume=0,alignedArea=0; U broken=0,depth=0; bool reversed=false;
};
using Triangle=std::array<D,3>;
struct Geometry {
    const std::vector<V>& p; const std::vector<F>& f;
    Triangle tri(U id) const { auto t=f[id];return {val(p[t.v[0]]),val(p[t.v[1]]),val(p[t.v[2]])}; }
    Box box(U id) const {Box b;for(auto q:tri(id)) b.add(q);return b;}
};
// Conservative triangle SAT, including in-plane separating axes for coplanar faces.
static bool touch(const Triangle& a,const Triangle& b) {
    auto sep=[&](D axis) {
        double amin=INFINITY,amax=-INFINITY,bmin=INFINITY,bmax=-INFINITY;
        for(auto p:a) {double s=dot(sub(p,a[0]),axis);amin=std::min(amin,s);amax=std::max(amax,s);}
        for(auto p:b) {double s=dot(sub(p,a[0]),axis);bmin=std::min(bmin,s);bmax=std::max(bmax,s);}
        return amax<bmin || bmax<amin;
    };
    D e[3],f[3];for(int i=0;i<3;++i){e[i]=sub(a[(i+1)%3],a[i]);f[i]=sub(b[(i+1)%3],b[i]);}
    D n=cross(e[0],e[1]),m=cross(f[0],f[1]);
    if(sep(n)||sep(m)) return false;
    for(auto i:e){if(sep(cross(n,i)))return false;for(auto j:f)if(sep(cross(i,j)))return false;}
    for(auto j:f)if(sep(cross(m,j)))return false;
    return true;
}
struct Node {Box box; U start=0,end=0,left=none,right=none;};
struct Tree {
    const Geometry& g; std::vector<U> ids; std::vector<Node> nodes;
    Tree(const Geometry& g_,const Shell& s):g(g_),ids(s.faces) {nodes.reserve(ids.size()/3+8);build(0,U(ids.size()));}
    U build(U l,U r) {
        U i=U(nodes.size()); nodes.push_back({});Box b;
        for(U k=l;k<r;++k){auto t=g.box(ids[k]);b.add(t.lo);b.add(t.hi);}
        nodes[i].box=b;nodes[i].start=l;nodes[i].end=r;
        if(r-l<=12)return i;
        D d=sub(b.hi,b.lo);int axis=d.x>d.y && d.x>d.z?0:(d.y>d.z?1:2);
        auto center=[&](U j){auto t=g.tri(j);return at(t[0],axis)+at(t[1],axis)+at(t[2],axis);};
        U h=l+(r-l)/2;std::nth_element(ids.begin()+l,ids.begin()+h,ids.begin()+r,[&](U a,U c){return center(a)<center(c);});
        U left=build(l,h),right=build(h,r);nodes[i].left=left;nodes[i].right=right;return i;
    }
    bool hits(U i,const Triangle& t,const Box& b) const {
        auto& n=nodes[i];if(!n.box.overlaps(b))return false;
        if(n.left!=none)return hits(n.left,t,b)||hits(n.right,t,b);
        for(U k=n.start;k<n.end;++k)if(touch(t,g.tri(ids[k])))return true;
        return false;
    }
    // Half-open projected triangle rule counts a shared edge once.
    int ray(U i,D p) const {
        auto& n=nodes[i];auto b=n.box;
        if(b.hi.x<=p.x || p.y<b.lo.y || p.y>b.hi.y || p.z<b.lo.z || p.z>b.hi.z)return 0;
        if(n.left!=none)return ray(n.left,p)+ray(n.right,p);
        int count=0;
        for(U k=n.start;k<n.end;++k) {
            auto t=g.tri(ids[k]);
            auto edge=[](D a,D b,D q){return (b.y-a.y)*(q.z-a.z)-(b.z-a.z)*(q.y-a.y);};
            double area=edge(t[0],t[1],t[2]);if(area==0)continue;
            if(area<0){std::swap(t[1],t[2]);area=-area;}
            double w[3];bool in=true;
            for(int j=0;j<3;++j){
                D a=t[(j+1)%3],b=t[(j+2)%3];w[j]=edge(a,b,p);
                if(w[j]<0 || (w[j]==0 && !(b.z>a.z || (b.z==a.z && b.y<a.y)))){in=false;break;}
            }
            if(in && w[0]*(t[0].x-p.x)+w[1]*(t[1].x-p.x)+w[2]*(t[2].x-p.x)>0) ++count;
        }
        return count;
    }
    bool inside(const Shell& inner) const {
        auto first=g.tri(inner.faces.front());
        D p{(first[0].x+first[1].x+first[2].x)/3,(first[0].y+first[1].y+first[2].y)/3,(first[0].z+first[1].z+first[2].z)/3};
        return (ray(0,p)&1)!=0;
    }
    bool contacts(const Shell& other) const {
        for(U j:other.faces){auto t=g.tri(j);Box b;for(auto q:t)b.add(q);if(hits(0,t,b))return true;}
        return false;
    }
};
// stats: retained, duplicates, degenerate, open edges, multi edges, orientation
// conflicts, patches, closed patches, cavity patches, changed winding, nested
// comparisons, discarded sub-cell solid clusters and discarded input triangles.
API int prepare(V* soup,U n,U* levels,U* stats,U resolution,double* cellSize) {
        *cellSize=0;
        Vertices vt(n/2+8);std::vector<F> faces,keys;faces.reserve(n);keys.reserve(n);
        std::vector<U> seen(capacity(size_t(n)*2+1),none);
        for(U i=0;i<n;++i){
            V* a=soup+size_t(i)*3;
            for(int j=0;j<3;++j)if(!std::isfinite(a[j].x)||!std::isfinite(a[j].y)||!std::isfinite(a[j].z))return -2;
            auto normal=cross(sub(val(a[1]),val(a[0])),sub(val(a[2]),val(a[0])));
            if(dot(normal,normal)==0){++stats[2];continue;}
            F f{{vt.insert(a[0]),vt.insert(a[1]),vt.insert(a[2])}},key=f;
            std::sort(key.v,key.v+3);size_t k=hash3(key.v[0],key.v[1],key.v[2])&(seen.size()-1);
            while(seen[k]!=none && std::memcmp(keys[seen[k]].v,key.v,12)!=0) k=(k+1)&(seen.size()-1);
            if(seen[k]!=none){++stats[1];continue;}
            seen[k]=U(faces.size());faces.push_back(f);keys.push_back(key);
        }
        std::vector<U>().swap(seen);std::vector<F>().swap(keys);std::vector<U>().swap(vt.slots);
        U count=U(faces.size());stats[0]=count;if(!count)return 0;
        std::vector<Edge> edges;edges.reserve(size_t(count)*3);
        for(U i=0;i<count;++i)for(int j=0;j<3;++j){
            U a=faces[i].v[j],b=faces[i].v[(j+1)%3];U dir=a<b;
            edges.push_back({(U64(std::min(a,b))<<32)|std::max(a,b),i*2+dir});
        }
        std::sort(edges.begin(),edges.end(),[](Edge a,Edge b){return a.key<b.key;});
        ParitySets sets(count);std::vector<uint8_t> broken(count,0);
        for(size_t i=0;i<edges.size();){
            size_t j=i+1;while(j<edges.size()&&edges[j].key==edges[i].key)++j;
            U a=edges[i].faceDir;
            if(j==i+2){U b=edges[i+1].faceDir;if(!sets.join(a/2,b/2,1^(a&1)^(b&1))){broken[a/2]=1;++stats[5];}}
            else {++stats[j==i+1?3:4];for(size_t k=i;k<j;++k)broken[edges[k].faceDir/2]=1;}
            i=j;
        }
        std::vector<Edge>().swap(edges);Geometry g{vt.points,faces};std::vector<U> shellOf(count,none);
        std::vector<Shell> shells;
        for(U i=0;i<count;++i){
            U parent=sets.find(i);if(shellOf[parent]==none){shellOf[parent]=U(shells.size());shells.emplace_back();}
            Shell& s=shells[shellOf[parent]];auto t=g.tri(i);
            D base=s.faces.empty()?t[0]:val(vt.points[faces[s.faces[0]].v[0]]);
            auto normal=cross(sub(t[1],t[0]),sub(t[2],t[0]));double sign=sets.parity[i]?-1.0:1.0;
            s.sixVolume+=sign*dot(sub(t[0],base),normal);s.alignedArea+=sign*std::sqrt(dot(normal,normal));
            for(auto q:t)s.box.add(q);s.broken+=broken[i];s.faces.push_back(i);
        }
        stats[6]=shells.size();std::vector<size_t> closed;
        for(size_t i=0;i<shells.size();++i)if(!shells[i].broken){++stats[7];closed.push_back(i);}
        // Touching/intersecting shells form one union. Only isolated, strictly
        // contained boundary clusters alternate solid/void, across all children.
        ParitySets clusters(U(shells.size()));
        std::vector<std::unique_ptr<Tree>> trees(shells.size());
        auto tree=[&](U i)->Tree&{if(!trees[i])trees[i]=std::make_unique<Tree>(g,shells[i]);return *trees[i];};
        std::vector<std::pair<U,U>> enclosed;
        std::sort(closed.begin(),closed.end(),[&](size_t a,size_t b){return shells[a].box.lo.x<shells[b].box.lo.x;});
        for(size_t k=0;k<closed.size();++k)for(size_t l=k+1;l<closed.size();++l){
            U a=U(closed[k]),b=U(closed[l]);
            if(shells[b].box.lo.x>shells[a].box.hi.x)break;
            if(!shells[a].box.overlaps(shells[b].box))continue;
            if(shells[a].faces.size()<shells[b].faces.size())std::swap(a,b);
            if(tree(a).contacts(shells[b])){clusters.join(a,b,0);continue;}
            auto nest=[&](U outer,U inner){
                if(!shells[outer].box.contains(shells[inner].box))return;
                ++stats[10];
                if(tree(outer).inside(shells[inner]))enclosed.emplace_back(outer,inner);
            };
            nest(a,b);nest(b,a);
        }
        std::vector<std::vector<U>> children(shells.size());
        std::vector<U> indegree(shells.size(),0),depth(shells.size(),0),queue;
        for(auto [a,b]:enclosed){
            U outer=clusters.find(a),inner=clusters.find(b);
            if(outer!=inner){children[outer].push_back(inner);++indegree[inner];}
        }
        for(U i=0;i<shells.size();++i)if(!indegree[i])queue.push_back(i);
        for(size_t i=0;i<queue.size();++i)for(U child:children[queue[i]]){
            depth[child]=std::max(depth[child],depth[queue[i]]+1);
            if(--indegree[child]==0)queue.push_back(child);
        }
        if(queue.size()!=shells.size())return -3;
        std::vector<Box> bounds(shells.size()),openBounds;Box inputBounds;
        for(U i=0;i<shells.size();++i){
            U root=clusters.find(i);const auto& b=shells[i].box;
            bounds[root].add(b.lo);bounds[root].add(b.hi);inputBounds.add(b.lo);inputBounds.add(b.hi);
            if(shells[i].broken)openBounds.push_back(b);
            shells[i].depth=depth[root];
        }
        *cellSize=inputBounds.span()/resolution;
        std::vector<bool> discard(shells.size(),false);
        for(U root:queue){
            if(clusters.find(root)!=root)continue;
            if(!discard[root]&&!shells[root].broken&&depth[root]%2==0&&bounds[root].span()<*cellSize){
                // Defer uncertain open-chart contacts to the output component test.
                bool uncertain=std::any_of(openBounds.begin(),openBounds.end(),[&](const Box& b){return b.overlaps(bounds[root]);});
                if(!uncertain){discard[root]=true;++stats[11];}
            }
            if(discard[root])for(U child:children[root])discard[child]=true;
        }
        for(U i=0;i<shells.size();++i){auto& s=shells[i];
            if(discard[clusters.find(i)]){for(U j:s.faces)levels[j]=none;stats[12]+=U(s.faces.size());continue;}
            bool cavity=(s.depth%2)!=0;if(cavity)++stats[8];
            // Open charts have no intrinsic solid volume. Preserve their area-majority
            // source winding after local repair. The six independent ray votes resolve gaps.
            s.reversed=s.broken ? s.alignedArea<0 : s.sixVolume<0;
            for(U j:s.faces){
                levels[j]=s.depth;
                bool flip=bool(sets.parity[j])!=s.reversed;if(flip)++stats[9];
                auto f=faces[j];if(flip)std::swap(f.v[1],f.v[2]);
                for(int k=0;k<3;++k)soup[size_t(j)*3+k]=vt.points[f.v[k]];
            }
        }
        if(stats[12]){
            U kept=0;
            for(U j=0;j<count;++j)if(levels[j]!=none){
                if(kept!=j){std::memcpy(soup+size_t(kept)*3,soup+size_t(j)*3,3*sizeof(V));levels[kept]=levels[j];}
                ++kept;
            }
            stats[0]=kept;
        }
        return 0;
}

constexpr int corners[8][3]={{0,0,0},{1,0,0},{1,1,0},{0,1,0},
                              {0,0,1},{1,0,1},{1,1,1},{0,1,1}};
constexpr int edges[12][2]={{0,1},{3,2},{4,5},{7,6},{0,3},{1,2},{4,7},{5,6},{0,4},{1,5},{2,6},{3,7}};
// Counterclockwise when seen from outside the cube.
constexpr int sides[6][4]={{0,3,2,1},{4,5,6,7},{0,1,5,4},{3,7,6,2},{0,4,7,3},{1,2,6,5}};
struct Pattern { int count=0; int loop[12]{}; bool simple=false; };
struct Tables {
    int sideEdges[6][4]{};
    Pattern patterns[256];
    Tables(){
        for(int s=0;s<6;++s)for(int j=0;j<4;++j){
            int a=sides[s][j],b=sides[s][(j+1)%4];
            for(int e=0;e<12;++e)if((a==edges[e][0]&&b==edges[e][1])||(a==edges[e][1]&&b==edges[e][0]))sideEdges[s][j]=e;
        }
        for(int mask=1;mask<255;++mask){
            int next[12];std::fill(next,next+12,-1);
            bool ambiguous=false;int segmentCount=0,first=-1;
            for(int s=0;s<6;++s){
                int enter=-1,exit=-1,hits=0;
                for(int j=0;j<4;++j){
                    bool a=mask&(1<<sides[s][j]),b=mask&(1<<sides[s][(j+1)%4]);
                    if(a==b)continue;
                    ++hits;int edge=sideEdges[s][j];
                    if(b)enter=edge;else exit=edge;
                }
                if(hits==4){ambiguous=true;break;}
                if(hits==2){next[enter]=exit;first=enter;++segmentCount;}
            }
            if(ambiguous || first<0)continue;
            auto& p=patterns[mask];int edge=first;
            do {p.loop[p.count++]=edge;edge=next[edge];}while(edge!=first && edge>=0 && p.count<12);
            p.simple=edge==first && p.count==segmentCount;
        }
    }
};
const Tables tables;
struct Surface {
    Vertices vertices{4096};
    std::vector<U> indices;
    U regular=0,ambiguous=0;
};
#include "unite-surface.h"
static double fraction(double a,double b){
    return std::clamp(std::abs(a)/(std::abs(a)+std::abs(b)),1.0/96,95.0/96);
}
struct Cell {
    int x,y,z; double h; D origin;
    int f[8]; V cut[12], spoke[8]; bool ready[12]{}, spokeReady[8]{};
    Surface& layer; bool invalid=false;
    V world(double dx,double dy,double dz) const {
        return {float(origin.x+h*(x+dx)),float(origin.y+h*(y+dy)),float(origin.z+h*(z+dz))};
    }
    V crossing(int e){
        if(!ready[e]){
            int a=edges[e][0],b=edges[e][1];double t=fraction(f[a],f[b]);
            cut[e]=world(corners[a][0]+t*(corners[b][0]-corners[a][0]),
                         corners[a][1]+t*(corners[b][1]-corners[a][1]),
                         corners[a][2]+t*(corners[b][2]-corners[a][2]));ready[e]=true;
        }return cut[e];
    }
    V radial(int a,double center){
        if(!spokeReady[a]){
            double t=fraction(center,f[a]);
            spoke[a]=world(.5+t*(corners[a][0]-.5),.5+t*(corners[a][1]-.5),.5+t*(corners[a][2]-.5));spokeReady[a]=true;
        }return spoke[a];
    }
    void tri(V a,V b,V c){
        auto n=cross(sub(val(b),val(a)),sub(val(c),val(a)));
        if(!(dot(n,n)>0)){invalid=true;return;}
        for(V p:{a,b,c})layer.indices.push_back(layer.vertices.insert(p));
    }
    void polygon(const V* v,int count,bool forward){
        for(int i=2;i<count;++i){
            if(forward)tri(v[0],v[i-1],v[i]);else tri(v[0],v[i],v[i-1]);
        }
    }
    void build(int mask){
        auto& p=tables.patterns[mask];
        if(p.simple){
            ++layer.regular;V a=crossing(p.loop[0]),b=crossing(p.loop[1]);
            for(int j=2;j<p.count;++j){V c=crossing(p.loop[j]);tri(a,b,c);b=c;}
            return;
        }
        ++layer.ambiguous;
        double center=0;for(int i:f)center+=i;center/=8;
        if(center==0)center=1;
        bool desired=center<0;
        for(int s=0;s<6;++s){
            const int* v=sides[s];const int* es=tables.sideEdges[s];
            int count=0;bool keep[4];
            for(int j=0;j<4;++j){keep[j]=((f[v[j]]>0)==desired);count+=keep[j];}
            if(!count)continue;
            if(count==2 && keep[0]==keep[2]){
                int p0=f[v[0]]*f[v[2]],p1=f[v[1]]*f[v[3]];
                bool connectedPositive=p0==p1 || (p0>p1)==(f[v[0]]>0);
                if(connectedPositive!=desired){
                    for(int j=0;j<4;++j)if(keep[j]){
                        V t[3]={radial(v[j],center),crossing(es[j]),crossing(es[(j+3)%4])};
                        polygon(t,3,center>0);
                    }
                    continue;
                }
            }
            // Start the fan on a spoke inside the cube. A diagonal between two
            // nonconsecutive base crossings would lie on the shared square.
            int anchor=0;while(!keep[anchor])++anchor;
            V points[8];int n=0;
            for(int step=0;step<4;++step){
                int j=(anchor+step)%4;
                if(keep[j])points[n++]=radial(v[j],center);
                if(keep[j]!=keep[(j+1)%4])points[n++]=crossing(es[j]);
            }
            polygon(points,n,center>0);
        }
    }
};

API Surface* begin_surface(){return new Surface();}
API void end_surface(Surface* s){delete s;}
API const V* surface_vertices(Surface* s){return s->vertices.points.data();}
API const U* surface_indices(Surface* s){return s->indices.data();}
API void surface_counts(Surface* s,U* stats){
    stats[0]=U(s->vertices.points.size());stats[1]=U(s->indices.size());
    stats[2]=s->regular;stats[3]=s->ambiguous;
}
API int contour_slab(Surface* s,const int16_t* field,int nx,int ny,int nz,int firstZ,
                     double ox,double oy,double oz,double pitch){
    const int plane=nx*ny;
    for(int z=0;z<nz-1;++z)for(int y=0;y<ny-1;++y){
        const auto row=field+size_t(z)*plane+size_t(y)*nx;
        auto sideMask=[&](int x){
            return int(row[x]>0)|(int(row[x+nx]>0)<<1)|
                   (int(row[x+plane]>0)<<2)|(int(row[x+plane+nx]>0)<<3);
        };
        int left=sideMask(0);
        for(int x=0;x<nx-1;++x){
            int right=sideMask(x+1);
            if((left|right)!=0 && (left&right)!=15){
                const auto q=row+x;
                Cell c{x,y,firstZ+z,pitch,{ox,oy,oz},
                    {q[0],q[1],q[nx+1],q[nx],q[plane],q[plane+1],q[plane+nx+1],q[plane+nx]},
                    {},{},{},{},*s};
                int mask=0;for(int k=0;k<8;++k)mask|=int(c.f[k]>0)<<k;
                c.build(mask);if(c.invalid)return 1;
            }
            left=right;
        }
    }
    return 0;
}
