// Constrained triangulation of oriented boundary loops. Earcut v2.2.4 is
// vendored from mapbox/earcut.hpp, revision 4811a2b, under the ISC license.
namespace unite_outline {
using Point=std::array<double,2>;
using Ring=std::vector<U>;
using Tri=std::array<U,3>;
struct Side {U64 a,b;};
static double turn(Point a,Point b,Point c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
static U64 edgeKey(U a,U b){return (U64(std::min(a,b))<<32)|std::max(a,b);}
struct Outline {
    int axis=0,sign=1;double crossingPrecision=0;D planePoint{},planeNormal{};
    std::vector<V> points;
    std::vector<Ring> rings;
    std::vector<Tri> triangles;
    template<class Position> bool trace(const std::vector<Side>& sides,Position position){
        // A connected sheet has one outgoing and one incoming edge at every
        // point on its perimeter. A pinched outline keeps its cell topology.
        std::unordered_map<U64,U> ids;ids.reserve(sides.size());std::vector<U> next;
        for(const auto& s:sides){
            auto [it,fresh]=ids.emplace(s.a,U(points.size()));if(!fresh)return false;
            points.push_back(position(s.a));next.push_back(none);
        }
        for(const auto& s:sides){
            auto it=ids.find(s.b);if(it==ids.end())return false;
            next[ids.at(s.a)]=it->second;
        }
        std::vector<bool> seen(next.size());
        for(U i=0;i<next.size();++i)if(!seen[i]){
            rings.emplace_back();auto& loop=rings.back();U a=i;
            do{if(seen[a])return false;seen[a]=true;loop.push_back(a);a=next[a];}while(a!=i);
            if(loop.size()<3)return false;
        }
        return !rings.empty();
    }
    bool simple(const std::vector<Point>& xy) const {
        struct Segment {U a,b;Point lo,hi;};
        struct Node {Point lo,hi;U left=0,right=0,start,end;};
        std::vector<Segment> edges;std::vector<Node> tree;
        for(const Ring& r:rings)for(size_t i=0;i<r.size();++i){
            U a=r[i],b=r[(i+1)%r.size()];if(xy[a]==xy[b])return false;
            edges.push_back({a,b,{std::min(xy[a][0],xy[b][0]),std::min(xy[a][1],xy[b][1])},
                                {std::max(xy[a][0],xy[b][0]),std::max(xy[a][1],xy[b][1])}});
        }
        auto build=[&](auto& self,U a,U b)->U{
            Node node{edges[a].lo,edges[a].hi,0,0,a,b};U id=tree.size();
            for(U i=a+1;i<b;++i)for(int d=0;d<2;++d){node.lo[d]=std::min(node.lo[d],edges[i].lo[d]);node.hi[d]=std::max(node.hi[d],edges[i].hi[d]);}
            tree.push_back(node);
            if(b-a>12){
                int d=node.hi[1]-node.lo[1]>node.hi[0]-node.lo[0];U m=a+(b-a)/2;
                std::nth_element(edges.begin()+a,edges.begin()+m,edges.begin()+b,[&](const Segment& u,const Segment& v){return u.lo[d]+u.hi[d]<v.lo[d]+v.hi[d];});
                U left=self(self,a,m),right=self(self,m,b);tree[id].left=left;tree[id].right=right;
            }
            return id;
        };
        build(build,0,edges.size());
        auto overlap=[](const auto& a,const auto& b){return a.lo[0]<=b.hi[0]&&b.lo[0]<=a.hi[0]&&a.lo[1]<=b.hi[1]&&b.lo[1]<=a.hi[1];};
        auto check=[&](auto& self,U i,U id)->bool{
            const auto& a=edges[i];const auto& n=tree[id];if(n.end<=i+1||!overlap(a,n))return true;
            if(n.left)return self(self,i,n.left)&&self(self,i,n.right);
            for(U j=std::max(n.start,i+1);j<n.end;++j){
                const auto& b=edges[j];
                if(a.a==b.a||a.a==b.b||a.b==b.a||a.b==b.b||!overlap(a,b))continue;
                if(turn(xy[a.a],xy[a.b],xy[b.a])*turn(xy[a.a],xy[a.b],xy[b.b])<=0&&
                   turn(xy[b.a],xy[b.b],xy[a.a])*turn(xy[b.a],xy[b.b],xy[a.b])<=0)return false;
            }
            return true;
        };
        for(U i=0;i<edges.size();++i)if(!check(check,i,0))return false;
        return true;
    }
    void improve(const std::vector<Point>& xy){
        std::unordered_map<U64,U> first;std::vector<U> mate(3*triangles.size(),none),queue;
        auto vertex=[&](U c){return triangles[c/3][c%3];};
        auto next=[](U c){return c%3==2?c-2:c+1;};auto prev=[](U c){return c%3?c-1:c+2;};
        for(U c=0;c<mate.size();++c){
            auto e=edgeKey(vertex(c),vertex(next(c)));auto [it,inserted]=first.emplace(e,c);
            if(!inserted){mate[c]=it->second;mate[it->second]=c;queue.push_back(c);}
        }
        auto couple=[&](U a,U b){mate[a]=b;if(b!=none)mate[b]=a;};
        size_t limit=12*mate.size();
        for(size_t k=0;k<queue.size()&&k<limit;++k){
            U f=queue[k],g=mate[f];if(g==none)continue;
            U u=vertex(f),v=vertex(g),l=vertex(prev(f)),r=vertex(prev(g));
            if(turn(xy[l],xy[r],xy[v])<=0||turn(xy[r],xy[l],xy[u])<=0)continue;
            Point a{xy[u][0]-xy[r][0],xy[u][1]-xy[r][1]},b{xy[v][0]-xy[r][0],xy[v][1]-xy[r][1]},c{xy[l][0]-xy[r][0],xy[l][1]-xy[r][1]};
            auto norm=[](Point p){return p[0]*p[0]+p[1]*p[1];};
            double det=norm(a)*(b[0]*c[1]-b[1]*c[0])-norm(b)*(a[0]*c[1]-a[1]*c[0])+norm(c)*(a[0]*b[1]-a[1]*b[0]);
            double extent=std::max({norm(a),norm(b),norm(c)});
            if(det<=extent*extent*1e-12)continue;
            U fn=next(f),fp=prev(f),gn=next(g),gp=prev(g);
            U vl=mate[fn],lu=mate[fp],ur=mate[gn],rv=mate[gp];
            triangles[f/3][f%3]=l;triangles[f/3][fn%3]=r;triangles[f/3][fp%3]=v;
            triangles[g/3][g%3]=r;triangles[g/3][gn%3]=l;triangles[g/3][gp%3]=u;
            couple(fn,rv);couple(fp,vl);couple(gn,lu);couple(gp,ur);
            for(U c:{fn,fp,gn,gp})if(mate[c]!=none)queue.push_back(c);
        }
    }
    bool fill(int projection,int orientation){
        axis=projection;sign=orientation;
        int u=(axis+1)%3,v=(axis+2)%3;D origin=val(points[rings.front().front()]);
        std::vector<Point> xy;xy.reserve(points.size());
        for(V p:points){D d=sub(val(p),origin);xy.push_back({at(d,u),sign*at(d,v)});}
        if(!simple(xy))return false;
        size_t outer=rings.size();double totalArea=0;
        for(size_t k=0;k<rings.size();++k){
            const auto& loop=rings[k];double area=0;
            for(size_t j=1;j+1<loop.size();++j)area+=turn(xy[loop[0]],xy[loop[j]],xy[loop[j+1]]);
            if(area>0){if(outer!=rings.size())return false;outer=k;}
            if(!area)return false;totalArea+=area;
        }
        if(outer==rings.size()||totalArea<=0)return false;
        std::swap(rings[0],rings[outer]);
        std::vector<std::vector<Point>> polygon;std::vector<U> flat;
        std::unordered_map<U64,std::vector<U>> chains;
        for(const Ring& loop:rings){
            // Remove exact collinearity for the triangulator, then restore the
            // entire constrained edge shared with the neighboring surface.
            std::vector<size_t> corners;size_t m=loop.size();
            for(size_t j=0;j<m;++j){
                Point a=xy[loop[(j+m-1)%m]],b=xy[loop[j]],c=xy[loop[(j+1)%m]];
                if(turn(a,b,c)!=0)corners.push_back(j);
                else if((b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])<=0)return false;
            }
            if(corners.size()<3)return false;
            polygon.emplace_back();
            for(size_t j=0;j<corners.size();++j){
                size_t i=corners[j],end=corners[(j+1)%corners.size()];
                polygon.back().push_back(xy[loop[i]]);flat.push_back(loop[i]);
                if((i+1)%m!=end){
                    auto& chain=chains[edgeKey(loop[i],loop[end])];
                    for(size_t k=(i+1)%m;k!=end;k=(k+1)%m)chain.push_back(loop[k]);
                }
            }
        }
        auto mesh=mapbox::earcut<U>(polygon);
        if(mesh.size()!=3*(flat.size()+2*(rings.size()-1)-2))return false;
        triangles.clear();triangles.reserve(points.size()+2*rings.size());
        for(size_t i=0;i<mesh.size();i+=3)triangles.push_back({flat[mesh[i]],flat[mesh[i+1]],flat[mesh[i+2]]});
        // Split each boundary side independently, including triangles that
        // contain two or three subdivided sides. No center vertex is needed.
        for(size_t i=0;i<triangles.size();){
            Tri t=triangles[i];bool split=false;
            for(int k=0;k<3;++k){
                U a=t[k],b=t[(k+1)%3],c=t[(k+2)%3];auto it=chains.find(edgeKey(a,b));
                if(it==chains.end())continue;
                U last=a;bool first=true;
                for(U q:it->second){Tri part{last,q,c};if(first){triangles[i]=part;first=false;}else triangles.push_back(part);last=q;}
                triangles.push_back({last,b,c});chains.erase(it);split=true;break;
            }
            if(!split)++i;
        }
        if(!chains.empty())return false;
        // Certify boundary incidence, orientation and planar coverage before
        // the owner cells are claimed. A failed fill has no published output.
        std::unordered_map<U64,unsigned char> uses;uses.reserve(triangles.size()*2);
        auto use=[&](U a,U b){auto& mask=uses[edgeKey(a,b)];int bit=a<b?1:2;if(mask&bit)return false;mask|=bit;return true;};
        for(const auto& loop:rings)for(size_t i=0;i<loop.size();++i)if(!use(loop[(i+1)%loop.size()],loop[i]))return false;
        double area=0;
        for(Tri t:triangles){
            double a=turn(xy[t[0]],xy[t[1]],xy[t[2]]);if(!(a>0))return false;area+=a;
            for(int k=0;k<3;++k)if(!use(t[k],t[(k+1)%3]))return false;
        }
        if(std::abs(area-totalArea)>1.e-8*totalArea||!std::all_of(uses.begin(),uses.end(),[](auto e){return e.second==3;}))return false;
        improve(xy);return true;
    }
    void emit(Surface& s) const {
        std::vector<U> ids(points.size(),none);
        for(Tri t:triangles)for(U v:t){if(ids[v]==none)ids[v]=s.vertices.insert(points[v]);s.indices.push_back(ids[v]);}
    }
};
// Check oriented incidence and a single cyclic link at every selected vertex.
// This also catches a cap diagonal already used by its exterior neighbor.
static bool closedLinks(const Surface& s,const std::vector<U>& indices){
    const auto& t=s.indices;size_t n=s.vertices.points.size();
    std::vector<U> head(n,none),next(t.size()),outgoing(n,none);
    for(U c=0;c<t.size();++c)if(t[c]!=none&&(indices.empty()||indices[t[c]]!=none)){next[c]=head[t[c]];head[t[c]]=c;}
    auto after=[](U c){return c%3==2?c-2:c+1;};auto before=[](U c){return c%3?c-1:c+2;};
    for(U a=0;a<n;++a){
        if(head[a]==none)continue;U count=0;
        for(U c=head[a];c!=none;c=next[c]){U b=t[after(c)];if(outgoing[b]!=none)return false;outgoing[b]=c;++count;}
        U c=head[a],used=0;
        do{c=outgoing[t[before(c)]];if(c==none||++used>count)return false;}while(c!=head[a]);
        if(used!=count)return false;
        for(U c=head[a];c!=none;c=next[c])outgoing[t[after(c)]]=none;
    }
    return true;
}
static bool joinRims(Surface&,std::vector<Outline>&,double,unsigned);
struct Picks {
    int sx,sy;std::unordered_map<U64,std::array<U64,8>> blocks;
    Picks(int x,int y):sx((x+7)/8),sy((y+7)/8){}
    U64 block(int x,int y,int z)const{return U64(x/8)+U64(sx)*(y/8+U64(sy)*(z/8));}
    void set(int x,int y,int z){blocks[block(x,y,z)][z&7]|=U64(1)<<((x&7)+8*(y&7));}
    bool has(int x,int y,int z)const{
        auto it=blocks.find(block(x,y,z));return it!=blocks.end()&&bool(it->second[z&7]&(U64(1)<<((x&7)+8*(y&7))));
    }
    bool touches(int x,int y,int z,int nx,int ny,int nz) const {
        for(int k=z/8;k<=(z+nz-1)/8;++k)for(int j=y/8;j<=(y+ny-1)/8;++j)for(int i=x/8;i<=(x+nx-1)/8;++i)
            if(blocks.count(U64(i)+U64(sx)*(j+U64(sy)*k)))return true;
        return false;
    }
};
}
