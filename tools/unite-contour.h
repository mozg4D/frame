// Fit single-sheet patches directly to the crossings of the implicit boundary.
// A failed fit subdivides its spatial block. Unit cells retain the saddle decider.
namespace unite_contour {
using unite_surface::add;
using unite_surface::scale;
using unite_surface::unit;
struct Bounds {int lo[3],hi[3];};
struct Segment {int edge,neighbor;};
struct Patch {
    std::vector<Segment> loop;
    std::vector<int> outline;
    D center,normal;
};
// One face per unit-cell contour loop. Its interior has no edges yet. Shared
// LDI crossings can be eliminated along the sheet before choosing diagonals.
struct CrossingFace {
    int v[12],slots,count;D n;
    int ring(int* out,int from=-1,int to=-1) const {
        int m=0;
        for(int i=0;i<slots;++i)if(v[i]>=0){
            int e=v[i]==from?to:v[i];if(!m||e!=out[m-1])out[m++]=e;
        }
        if(m>1&&out[0]==out[m-1])--m;return m;
    }
};
struct Planes {
    double xx=0,yy=0,zz=0,xy=0,xz=0,yz=0,x=0,y=0,z=0,c=0,w=0;
    void sample(D n,D p){
        double h=dot(n,p);xx+=n.x*n.x;yy+=n.y*n.y;zz+=n.z*n.z;
        xy+=n.x*n.y;xz+=n.x*n.z;yz+=n.y*n.z;x-=n.x*h;y-=n.y*h;z-=n.z*h;c+=h*h;w++;
    }
    double error(D p) const {
        return std::max(0.,c+p.x*(xx*p.x+2*(xy*p.y+xz*p.z+x))+p.y*(yy*p.y+2*(yz*p.z+y))+p.z*(zz*p.z+2*z));
    }
    void absorb(const Planes& b){
        xx+=b.xx;yy+=b.yy;zz+=b.zz;xy+=b.xy;xz+=b.xz;yz+=b.yz;x+=b.x;y+=b.y;z+=b.z;c+=b.c;w+=b.w;
    }
};
struct Tile {
    Surface& surface;const int16_t* field;const Axes& axes;
    int row,plane,first[3],size[3],stride[3],gridStride[3];
    double tolerance;unsigned strength;
    std::vector<unsigned char> masks;
    std::vector<int> owner,stamp,link,neighbor,used,boundary;
    std::vector<D> positions;
    std::vector<V> world;
    std::vector<Patch> patches;
    std::vector<CrossingFace> faces;
    std::vector<int> head,incidence,marks,emitted;
    std::vector<unsigned char> locked,border;
    std::vector<Planes> planes;
    std::vector<U64> edgeKeys;
    std::vector<unsigned char> edgeDirections;
    std::vector<size_t> occupied;
    int generation=0;D origin;

    Tile(Surface& s,const int16_t* f,int nx,int ny,const Axes& a,int block,double error,unsigned percent)
      :surface(s),field(f),axes(a),row(nx),plane(nx*ny),stride{1,block+1,(block+1)*(block+1)},
       gridStride{1,nx,nx*ny},tolerance(error),strength(percent){
        size_t n=stride[2]*(block+1);
        masks.resize(n);owner.resize(n);stamp.resize(3*n);link.resize(3*n);neighbor.resize(3*n);
        positions.resize(3*n);world.resize(3*n);head.resize(3*n);marks.resize(3*n);emitted.resize(3*n);
        locked.resize(3*n);border.resize(3*n);planes.resize(3*n);
    }
    int index(int x,int y,int z) const {return x+stride[1]*y+stride[2]*z;}
    void values(int x,int y,int z,int* f) const {
        auto p=field+x+y*row+z*plane;
        for(int i=0;i<8;++i)f[i]=p[corners[i][0]+corners[i][1]*row+corners[i][2]*plane];
    }
    int cut(int x,int y,int z,int edge){
        int axis=edge/4;auto a=corners[edges[edge][0]];
        int xyz[]={x+a[0],y+a[1],z+a[2]};
        int key=3*index(xyz[0],xyz[1],xyz[2])+axis;
        if(stamp[key]!=generation){stamp[key]=generation;used.push_back(key);link[key]=-1;}
        if(std::isnan(positions[key].x)){
            auto p=field+xyz[0]+row*xyz[1]+plane*xyz[2];
            double t=fraction(*p,p[gridStride[axis]]),v[3];
            for(int k=0;k<3;++k)v[k]=axes.coordinate(k,first[k]+xyz[k],k==axis?t:0);
            D point{v[0],v[1],v[2]};world[key]=unite_surface::vertex(point);
            positions[key]=scale(sub(point,origin),1/axes.pitch);
        }
        return key;
    }
    bool fit(const Bounds& b){
        ++generation;used.clear();boundary.clear();
        int cells=0,cornersTotal=0,rays[3]{},planeAxis=-1;double planeValue=0,smallestStep=INFINITY;
        for(int z=b.lo[2];z<b.hi[2];++z)for(int y=b.lo[1];y<b.hi[1];++y)for(int x=b.lo[0];x<b.hi[0];++x){
            int mask=masks[index(x,y,z)];if(!mask)continue;
            const auto& p=tables.patterns[mask];if(!p.simple)return false;
            ++cells;cornersTotal+=p.count;int ids[12];
            for(int j=0;j<p.count;++j){
                int edge=p.loop[j];ids[j]=cut(x,y,z,edge);
                rays[edge/4]|=(mask&(1<<edges[edge][0]))?1:2;
            }
            if(axes.knots[0])for(int k=0;k<3;++k){
                const int xyz[]={x,y,z};int i=first[k]+xyz[k];
                smallestStep=std::min(smallestStep,(axes.knots[k][i+1]-axes.knots[k][i])/axes.pitch);
                double value=at(positions[ids[0]],k);bool planar=true;
                for(int j=1;j<p.count;++j)if(std::abs(at(positions[ids[j]],k)-value)>1e-7){planar=false;break;}
                if(planar){
                    if(planeAxis>=0&&(k!=planeAxis||std::abs(planeValue-value)>1e-7))return false;
                    planeAxis=k;planeValue=value;break;
                }
            }
            // Only segments on the six exterior sides enter the shared outline.
            const int xyz[]={x,y,z};
            for(int j=0;j<p.count;++j){
                int next=(j+1)%p.count,side=tables.commonSide[p.loop[j]][p.loop[next]];
                int axis=2-side/2,step=(side&1)?1:-1;
                if(xyz[axis]!=((side&1)?b.hi[axis]-1:b.lo[axis]))continue;
                int start=ids[j];if(link[start]>=0)return false;
                link[start]=ids[next];boundary.push_back(start);
                const int adjacent=xyz[axis]+step;
                neighbor[start]=adjacent<0||adjacent>=size[axis]?-1:index(x,y,z)+step*stride[axis];
            }
        }
        if(cells<3||boundary.size()<3||int(used.size())-(cornersTotal+int(boundary.size()))/2+cells!=1)return false;
        // Exactly one directed boundary cycle and Euler characteristic one.
        int seed=boundary[0],e=seed,count=0;D area{},center{};
        do{
            int next=link[e];if(next<0||++count>int(boundary.size()))return false;
            area=add(area,cross(positions[e],positions[next]));e=next;
        }while(e!=seed);
        if(count!=int(boundary.size()))return false;
        D n=unit(area);int axis=0;
        for(int k=1;k<3;++k)if(std::abs(at(n,k))>std::abs(at(n,axis)))axis=k;
        if(std::abs(at(n,axis))<.5||rays[axis]==3||!rays[axis])return false;
        for(int id:used)center=add(center,positions[id]);
        center=scale(center,1./used.size());
        double nearest=INFINITY,offset=0,lo=0,hi=0;
        const double fitError=std::min(tolerance,.16*smallestStep);
        for(int id:used){
            if(planeAxis>=0&&std::abs(at(positions[id],planeAxis)-planeValue)>1e-7)return false;
            D v=sub(positions[id],center);double d=dot(v,n);lo=std::min(lo,d);hi=std::max(hi,d);
            if(hi-lo>fitError)return false;
            double radial=dot(v,v)-d*d;if(radial<nearest){nearest=radial;offset=d;}
        }
        center=add(center,scale(n,offset));
        for(int id:boundary){
            D u=sub(positions[id],center),v=sub(positions[link[id]],center);
            if(dot(cross(u,v),n)<=1e-10)return false;
        }
        int label=int(patches.size());patches.emplace_back();auto& patch=patches.back();
        patch.center=center;patch.normal=n;patch.loop.reserve(count);e=seed;
        do{patch.loop.push_back({e,neighbor[e]});e=link[e];}while(e!=seed);
        for(int z=b.lo[2];z<b.hi[2];++z)for(int y=b.lo[1];y<b.hi[1];++y)for(int x=b.lo[0];x<b.hi[0];++x)owner[index(x,y,z)]=label;
        surface.fittedCells+=cells;++surface.patches;surface.regular+=cells;return true;
    }
    void partition(const Bounds& b){
        bool active=false;for(int z=b.lo[2];z<b.hi[2]&&!active;++z)for(int y=b.lo[1];y<b.hi[1]&&!active;++y){
            auto start=masks.data()+index(b.lo[0],y,z);active=std::any_of(start,start+b.hi[0]-b.lo[0],[](int m){return m!=0;});
        }
        if(!active)return;
        int mid[3],parts[3];
        for(int k=0;k<3;++k){parts[k]=b.hi[k]-b.lo[k]>1?2:1;mid[k]=(b.lo[k]+b.hi[k])/2;}
        if(parts[0]*parts[1]*parts[2]==1||fit(b))return;
        for(int z=0;z<parts[2];++z)for(int y=0;y<parts[1];++y)for(int x=0;x<parts[0];++x){
            int half[]={x,y,z};Bounds child;
            for(int k=0;k<3;++k){child.lo[k]=half[k]?mid[k]:b.lo[k];child.hi[k]=(half[k]||parts[k]==1)?b.hi[k]:mid[k];}
            partition(child);
        }
    }
    // Both sides of a shared curve use the same endpoints, arithmetic and tie
    // breaker. At a tile/slab boundary keep all unit crossings on both sides.
    void simplify(const Patch& p,std::vector<int>& out,int a,int b){
        int count=int(p.loop.size()),u=p.loop[a%count].edge,v=p.loop[b%count].edge;
        if(b>a+1){
            D A=positions[std::min(u,v)],B=positions[std::max(u,v)],ab=sub(B,A);
            double l=dot(ab,ab),worst=axes.knots[0]?1e-14:tolerance*tolerance*.0625;int split=-1,id=INT32_MAX;
            for(int j=a+1;j<b;++j){
                int key=p.loop[j%count].edge;D d=sub(positions[key],A);
                D delta=sub(d,scale(ab,l>0?std::clamp(dot(d,ab)/l,0.,1.):0.));double error=dot(delta,delta);
                if(error>worst||(split>=0&&error==worst&&key<id)){worst=error;split=j;id=key;}
            }
            if(split>=0){simplify(p,out,a,split);simplify(p,out,split,b);return;}
        }
        out.push_back(u);
    }
    bool outline(Patch& p){
        auto& loop=p.loop;int count=int(loop.size());std::vector<int> anchors;
        for(int i=0;i<count;++i){
            int a=loop[(i+count-1)%count].neighbor,b=loop[i].neighbor;
            if(a<0||b<0||owner[a]<0||owner[b]<0||owner[a]!=owner[b])anchors.push_back(i);
        }
        if(anchors.size()<3)return false;
        for(size_t j=0;j<anchors.size();++j)simplify(p,p.outline,anchors[j],j+1<anchors.size()?anchors[j+1]:anchors[0]+count);
        for(size_t i=0;i<p.outline.size();++i){
            D a=sub(positions[p.outline[i]],p.center),b=sub(positions[p.outline[(i+1)%p.outline.size()]],p.center);
            if(dot(cross(a,b),p.normal)<=1e-10)return false;
        }
        return true;
    }
    bool triangulate(Patch& p,bool simplified){
        if(!simplified){p.outline.clear();for(auto v:p.loop)p.outline.push_back(v.edge);}
        const auto& loop=p.outline;int count=int(loop.size());
        auto tri=[&](V a,V b,V c){
            D n=unite_surface::normal(a,b,c);if(!(dot(n,p.normal)>0))return false;
            for(V q:{a,b,c})surface.indices.push_back(surface.vertices.insert(q));return true;
        };
        if(count==3)return tri(world[loop[0]],world[loop[1]],world[loop[2]]);
        if(count==4){
            auto area=[&](int i){D a=positions[loop[i]],b=positions[loop[(i+1)%4]],c=positions[loop[(i+2)%4]];
                return dot(cross(sub(b,a),sub(c,a)),p.normal);};
            double ac=std::min(area(0),area(2)),bd=std::min(area(1),area(3));int i=ac>=bd?0:1;
            if(std::max(ac,bd)>1e-9)return tri(world[loop[i]],world[loop[(i+1)%4]],world[loop[(i+2)%4]])&&
                tri(world[loop[i]],world[loop[(i+2)%4]],world[loop[(i+3)%4]]);
        }
        V center=unite_surface::vertex(add(origin,scale(p.center,axes.pitch)));
        for(int i=0;i<count;++i)if(!tri(center,world[loop[i]],world[loop[(i+1)%count]]))return false;
        return true;
    }
    D area(const int* ring,int count) const {
        D a{},o=positions[ring[0]];
        for(int j=2;j<count;++j)a=add(a,cross(sub(positions[ring[j-1]],o),sub(positions[ring[j]],o)));
        return a;
    }
    int published(int e){
        if(emitted[e]<0)emitted[e]=int(surface.vertices.insert(world[e]));return emitted[e];
    }
    int fan(const int* ring,int count,D n) const {
        // Use the best of the legal fans. Prefer well-shaped triangles, and
        // measure after Float32 conversion, as these are the published points.
        int best=-1;double quality=0;
        for(int a=0;a<count;++a){
            D o=val(world[ring[a]]);double q=INFINITY;
            for(int k=2;k<count;++k){
                if(k<count-1&&(border[ring[a]]&border[ring[(a+k)%count]])){q=0;break;}
                D b=sub(val(world[ring[(a+k-1)%count]]),o),c=sub(val(world[ring[(a+k)%count]]),o);
                double turn=dot(cross(b,c),n);
                if(!(turn>0)){q=0;break;}
                q=std::min(q,turn/(dot(b,b)+dot(c,c)+dot(sub(b,c),sub(b,c))));
            }
            if(q>quality){quality=q;best=a;}
        }
        return best;
    }
    bool graph(){
        faces.clear();incidence.clear();++generation;used.clear();
        for(int z=0;z<size[2];++z)for(int y=0;y<size[1];++y)for(int x=0;x<size[0];++x){
            int mask=masks[index(x,y,z)];if(!mask)continue;
            const auto& p=tables.patterns[mask];
            auto crossing=[&](int edge){
                size_t old=used.size();int e=cut(x,y,z,edge);
                if(used.size()!=old){
                    const auto a=corners[edges[edge][0]];int v[]={x+a[0],y+a[1],z+a[2]};
                    head[e]=emitted[e]=-1;border[e]=0;marks[e]=0;planes[e]={};
                    for(int k=0;k<3;++k)if(k!=edge/4&&(v[k]==0||v[k]==size[k]))border[e]|=1u<<(2*k+(v[k]!=0));
                    locked[e]=border[e]!=0;
                }return e;
            };
            if(!p.simple){
                // The asymptotic-decider cap owns all of these edge samples.
                for(int k=0;k<12;++k)if(((mask>>edges[k][0])^(mask>>edges[k][1]))&1)locked[crossing(k)]=1;
                Cell cell{first[0]+x,first[1]+y,first[2]+z,axes,{},{},{},{},{},surface};values(x,y,z,cell.f);
                auto before=surface.indices.size();cell.build(mask);if(cell.invalid)return false;
                surface.referenceFaces+=U((surface.indices.size()-before)/3);continue;
            }
            int id=int(faces.size());faces.emplace_back();auto& face=faces.back();
            face.count=face.slots=p.count;incidence.resize(12*(id+1));
            for(int k=0;k<p.count;++k){
                int e=crossing(p.loop[k]);face.v[k]=e;int slot=12*id+k;
                incidence[slot]=head[e];head[e]=slot;
            }
            face.n=unit(area(face.v,face.count));
            // Each original contour contributes its tangent-plane constraint at
            // the actual crossing. Keep that constraint after later contractions.
            for(int k=0;k<face.slots;++k){int e=face.v[k];planes[e].sample(face.n,positions[e]);}
            ++surface.regular;surface.referenceFaces+=p.count-2;
        }
        const double t=strength/100.,limit=.012+.29*t,limit2=limit*limit;
        const double span=1+5*t;
        const int target=int(used.size()*t),num=int(used.size());int removed=0,serial=0;
        for(int pass=0;pass<6&&removed<target;++pass){
            int prior=removed;
            for(int i=0;i<num&&removed<target;++i){
                int a=used[pass%2?num-1-i:i];if(locked[a]||head[a]<0)continue;
                int adjacent[40],count=0;bool eligible=true;int tag=++serial;
                for(int slot=head[a];slot>=0;slot=incidence[slot]){
                    const auto& f=faces[slot/12];if(!f.count)continue;
                    int pos=slot%12;do{pos=(pos+1)%f.slots;}while(f.v[pos]<0);
                    int b=f.v[pos];if(marks[b]==tag||count==40){eligible=false;break;}marks[b]=tag;adjacent[count++]=b;
                }
                if(!eligible||count<3)continue;
                int b=-1;double best=INFINITY;
                for(int j=0;j<count;++j){
                    int v=adjacent[j];if(locked[v])continue;D d=sub(positions[v],positions[a]);double length=dot(d,d);
                    if(length>span*span)continue;
                    double cost=planes[a].error(positions[v])/planes[a].w;
                    if(cost>limit2)continue;
                    cost+=.0004*length;if(cost<best){best=cost;b=v;}
                }
                if(b<0)continue;
                int touches=0,opposite[2]={-1,-1},ring[12];bool safe=true;
                for(int slot=head[a];slot>=0&&safe;slot=incidence[slot]){
                    const auto& f=faces[slot/12];if(!f.count)continue;
                    int m=f.ring(ring,a,b);
                    if(m!=f.count){
                        if(touches==2){safe=false;break;}
                        if(m==2)opposite[touches]=ring[0]==b?ring[1]:ring[0];++touches;
                    }else if(std::count(ring,ring+m,b)>1){safe=false;break;}
                    if(m<3)continue;
                    D d=sub(positions[b],positions[a]);
                    if(std::abs(dot(f.n,d))>2*limit){safe=false;break;}
                    // A surviving polygon remains a single convex chart in its
                    // original tangent plane. This also rules out a flipped face.
                    for(int j=0;j<m;++j){
                        D u=sub(positions[ring[(j+1)%m]],positions[ring[j]]);
                        D v=sub(positions[ring[(j+2)%m]],positions[ring[(j+1)%m]]);
                        if(dot(cross(u,v),f.n)<-1e-9){safe=false;break;}
                    }
                    if(safe&&fan(ring,m,f.n)<0)safe=false;
                }
                if(!safe||touches!=2||(opposite[0]>=0&&opposite[0]==opposite[1]))continue;
                int degree=0;
                for(int slot=head[b];slot>=0;slot=incidence[slot]){
                    const auto& f=faces[slot/12];if(!f.count)continue;
                    int pos=slot%12;do{pos=(pos+1)%f.slots;}while(f.v[pos]<0);int v=f.v[pos];++degree;
                    if(marks[v]==tag&&v!=opposite[0]&&v!=opposite[1]){safe=false;break;}
                }
                if(!safe||degree>40||(degree==3&&count==3&&opposite[0]>=0&&opposite[1]>=0))continue;
                for(int slot=head[a];slot>=0;){
                    int next=incidence[slot];auto& f=faces[slot/12];
                    if(f.count){
                        if(std::find(f.v,f.v+f.slots,b)!=f.v+f.slots){
                            f.v[slot%12]=-1;if(--f.count==2)f.count=0;
                        }else{f.v[slot%12]=b;incidence[slot]=head[b];head[b]=slot;}
                    }slot=next;
                }
                head[a]=-1;planes[b].absorb(planes[a]);++removed;
            }
            if(removed==prior)break;
        }
        surface.omittedCrossings+=removed;
        for(const auto& f:faces)if(f.count){
            int ring[12],m=f.ring(ring),anchor=fan(ring,m,f.n);
            // An untouched noisy input contour can be nonconvex. Its original
            // marching pattern is the canonical, coordinate-checked fallback.
            if(anchor<0)anchor=0;
            for(int j=2;j<m;++j){
                int a=ring[anchor],b=ring[(anchor+j-1)%m],c=ring[(anchor+j)%m];
                D n=unite_surface::normal(world[a],world[b],world[c]);if(!(dot(n,n)>0))return false;
                for(int e:{a,b,c})surface.indices.push_back(published(e));
            }
        }
        return true;
    }
    bool validBoundary(size_t start){
        // Every new interior edge has two opposite uses. Across tiles only the
        // original (locked) crossings of unit squares may be exposed. In
        // particular an internal fan diagonal cannot lie on a shared tile face.
        auto& indices=surface.indices;auto& points=surface.vertices.points;
        size_t length=capacity((indices.size()-start)*2+1);
        if(edgeKeys.size()<length){edgeKeys.resize(length);edgeDirections.resize(length);}
        occupied.clear();
        struct Clear {
            std::vector<unsigned char>& directions;std::vector<size_t>& slots;
            ~Clear(){for(size_t i:slots)directions[i]=0;}
        } clear{edgeDirections,occupied};
        for(size_t i=start;i<indices.size();i+=3)for(int j=0;j<3;++j){
            U a=indices[i+j],b=indices[i+(j+1)%3];if(a==b)return false;
            U64 key=(U64(std::min(a,b))<<32)|std::max(a,b);unsigned char d=a<b?1:2;
            size_t k=mix(key)&(length-1);
            while(edgeDirections[k]&&edgeKeys[k]!=key)k=(k+1)&(length-1);
            if(edgeDirections[k]&d)return false;
            if(!edgeDirections[k]){edgeKeys[k]=key;occupied.push_back(k);}edgeDirections[k]|=d;
        }
        float lo[3],hi[3];for(int k=0;k<3;++k){lo[k]=float(axes.coordinate(k,first[k]));hi[k]=float(axes.coordinate(k,first[k]+size[k]));}
        for(size_t k:occupied){
            auto a=points[edgeKeys[k]>>32],b=points[U(edgeKeys[k])];
            bool border=(a.x==b.x&&(a.x==lo[0]||a.x==hi[0]))||(a.y==b.y&&(a.y==lo[1]||a.y==hi[1]))||(a.z==b.z&&(a.z==lo[2]||a.z==hi[2]));
            if(border==(edgeDirections[k]==3))return false;
        }
        return true;
    }
    bool uniform(){
        for(int z=0;z<size[2];++z)for(int y=0;y<size[1];++y)for(int x=0;x<size[0];++x){
            int mask=masks[index(x,y,z)];if(!mask)continue;
            Cell cell{first[0]+x,first[1]+y,first[2]+z,axes,{},{},{},{},{},surface};values(x,y,z,cell.f);
            auto before=surface.indices.size();cell.build(mask);if(cell.invalid)return false;
            surface.referenceFaces+=U((surface.indices.size()-before)/3);
        }
        return true;
    }
    bool build(){
        patches.clear();bool active=false;
        for(int z=0;z<size[2];++z)for(int y=0;y<size[1];++y){
            auto p=field+z*plane+y*row;
            auto side=[&](int x){return (p[x]>0)|((p[x+row]>0)<<1)|((p[x+plane]>0)<<2)|((p[x+plane+row]>0)<<3);};
            int left=side(0);
            for(int x=0;x<size[0];++x){
                int right=side(x+1),id=index(x,y,z);masks[id]=0;
                if((left|right)!=0&&(left&right)!=15){
                    int mask=(left&1)|((right&1)<<1)|((right&2)<<1)|((left&2)<<2)|
                        ((left&4)<<2)|((right&4)<<3)|((right&8)<<3)|((left&8)<<4);
                    masks[id]=mask;owner[id]=-1;active=true;
                }
                left=right;
            }
        }
        if(!active)return true;
        std::fill(positions.begin(),positions.end(),D{NAN,0,0});
        origin={axes.coordinate(0,first[0]),axes.coordinate(1,first[1]),axes.coordinate(2,first[2])};
        Bounds bounds{{0,0,0},{size[0],size[1],size[2]}};
        if(axes.knots[0])partition(bounds);
        else if(!fit(bounds))return graph();
        bool simplified=true;
        for(auto& p:patches)if(!outline(p)){simplified=false;break;}
        for(auto& p:patches)if(!triangulate(p,simplified))return false;
        for(int z=0;z<size[2];++z)for(int y=0;y<size[1];++y)for(int x=0;x<size[0];++x){
            int id=index(x,y,z),mask=masks[id];if(!mask)continue;
            const auto& pattern=tables.patterns[mask];
            if(pattern.simple)surface.referenceFaces+=pattern.count-2;
            if(owner[id]>=0)continue;
            Cell cell{first[0]+x,first[1]+y,first[2]+z,axes,{},{},{},{},{},surface};values(x,y,z,cell.f);
            size_t before=surface.indices.size();cell.build(mask);if(cell.invalid)return false;
            if(!pattern.simple)surface.referenceFaces+=U((surface.indices.size()-before)/3);
        }
        return true;
    }
};
static int adaptive(Surface& s,const int16_t* f,int nx,int ny,int nz,int firstZ,const Axes& axes,unsigned strength){
    int block=strength<20?2:(strength<45?4:(strength<65?8:16));
    double t=strength/100.;Tile tile(s,f,nx,ny,axes,block,.006+.64*t*t,strength);
    for(int z=0;z<nz-1;z+=block)for(int y=0;y<ny-1;y+=block)for(int x=0;x<nx-1;x+=block){
        tile.field=f+z*nx*ny+y*nx+x;
        tile.first[0]=x;tile.first[1]=y;tile.first[2]=firstZ+z;
        tile.size[0]=std::min(block,nx-1-x);tile.size[1]=std::min(block,ny-1-y);tile.size[2]=std::min(block,nz-1-z);
        size_t start=s.indices.size();U regular=s.regular,ambiguous=s.ambiguous,raw=s.referenceFaces,patches=s.patches,cells=s.fittedCells,omitted=s.omittedCrossings;
        if(!tile.build()||(start!=s.indices.size()&&!tile.validBoundary(start))){
            s.indices.resize(start);s.regular=regular;s.ambiguous=ambiguous;s.referenceFaces=raw;s.patches=patches;
            s.fittedCells=cells;s.omittedCrossings=omitted;++s.fallbackTiles;if(!tile.uniform())return 1;
        }
    }
    return 0;
}
}
