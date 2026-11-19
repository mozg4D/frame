// A closed vertex fan is a disk. Use the published surface as its constrained
// triangulation: the directed outline (also next to holes and other sheets)
// survives every replacement. Coordinates below are in cell pitches.
struct ChartPoint {
    U id,corner;
    D local;
    double x,y,h;
};
using ChartTriangle=std::array<int,3>;

enum class RegionFit {local,strip,patch,fringe,fieldFringe,field};

struct RegionMesher {
    std::vector<V>& points;
    std::vector<U>& faces;
    const Reference& field;
    Rings rings;
    std::vector<U> back,cornerAt,degree;
    std::vector<V> normals;
    std::vector<float> error;
    std::vector<U> incident,queue;
    std::vector<unsigned char> pending;
    std::vector<ChartPoint> loop;
    std::vector<ChartTriangle> replacement;
    std::vector<int> polygon;
    double flatLimit,stripLimit,fieldLimit,eps,prior,span;
    D center,normalAxis,axisX,axisY;
    U planarRemoved=0,stripRemoved=0;

    RegionMesher(std::vector<V>& p,std::vector<U>& t,const Reference& ref,unsigned percent):
        points(p),faces(t),field(ref),rings(p.size(),t),back(t.size(),none),cornerAt(p.size(),none),
        degree(p.size()),normals(t.size()/3),error(t.size()/3),pending(p.size()){
        const double strength=percent/100.;
        flatLimit=percent?std::min(.027,.052*strength):1.e-6;
        stripLimit=percent?.12*strength:1.e-6;
        fieldLimit=std::min(.18,.006+.64*strength*strength);
        for(U c=0;c<t.size();++c){
            if(rings.next[c]!=none)back[rings.next[c]]=c;
            ++degree[t[c]];
            if(c%3==0)measure(c);
        }
    }
    void measure(U c){
        normals[c/3]=vertex(unit(normal(points[faces[c]],points[faces[c+1]],points[faces[c+2]])));
    }
    bool existingEdge(U a,U b) const {
        if(degree[a]>degree[b])std::swap(a,b);
        for(U c=rings.head[a];c!=none;c=rings.next[c])if(faces[nextCorner(c)]==b)return true;
        return false;
    }
    void unlink(U c){
        U id=faces[c],previous=back[c],next=rings.next[c];
        if(previous==none)rings.head[id]=next;else rings.next[previous]=next;
        if(next!=none)back[next]=previous;
        --degree[id];faces[c]=none;
    }
    void insert(U c,U id){
        U head=rings.head[id];back[c]=none;rings.next[c]=head;
        if(head!=none)back[head]=c;
        rings.head[id]=c;faces[c]=id;++degree[id];
    }
    // Order the incident triangles by their radial edges and reject a pinched
    // or open link. Dropping the center must preserve a single oriented disk.
    bool chart(U id,U patch){
        if(degree[id]<3)return false;
        incident.clear();loop.clear();prior=0;D mean{};
        bool valid=true;center=val(points[id]);
        for(U c=rings.head[id];c!=none;c=rings.next[c]){
            U a=faces[nextCorner(c)];
            incident.push_back(c);valid&=cornerAt[a]==none;cornerAt[a]=c;
            mean=add(mean,cross(sub(val(points[a]),center),sub(val(points[faces[prevCorner(c)]]),center)));prior=std::max(prior,double(error[c/3]));
        }
        normalAxis=patch==none?unit(mean):planes[patch];
        axisX=unit(cross(normalAxis,std::abs(normalAxis.x)<.8?D{1,0,0}:D{0,1,0}));
        axisY=cross(normalAxis,axisX);
        double lo=0,hi=0,extent=0;U c=incident.front();
        do{
            U a=faces[nextCorner(c)];
            D r=scale(sub(val(points[a]),center),1/field.pitch);
            double h=dot(r,normalAxis);
            loop.push_back({a,c,r,dot(r,axisX),dot(r,axisY),h});
            extent=std::max(extent,dot(r,r));lo=std::min(lo,h);hi=std::max(hi,h);
            if(dot(val(normals[c/3]),normalAxis)<=0){valid=false;break;}
            c=cornerAt[faces[prevCorner(c)]];
        }while(c!=none&&c!=incident.front()&&loop.size()<incident.size());
        for(U slot:incident)cornerAt[faces[nextCorner(slot)]]=none;
        if(!valid||c!=incident.front()||loop.size()!=incident.size())return false;
        span=hi-lo;eps=std::max(1.e-19,extent*4.e-15);
        int winding=0;
        for(size_t i=0;i<loop.size();++i){
            const auto& a=loop[i];const auto& b=loop[(i+1)%loop.size()];
            if(a.x*b.y-a.y*b.x<=eps)return false;
            if(a.y<=0&&b.y>0)++winding;
        }
        return winding==1;
    }
    static double orient(const ChartPoint& a,const ChartPoint& b,const ChartPoint& c){
        return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    }
    bool boundary(int i,int j) const {
        int d=std::abs(i-j);return d==1||d==int(loop.size())-1;
    }
    bool diagonal(int i,int j) const {return boundary(i,j)||!existingEdge(loop[i].id,loop[j].id);}
    bool convexOutline() const {
        for(size_t k=0,m=polygon.size();k<m;++k)
            if(orient(loop[polygon[(k+m-1)%m]],loop[polygon[k]],loop[polygon[(k+1)%m]])<0)return false;
        return true;
    }
    // Peel alternating ears. A convex drum with thousands of rim samples
    // takes logarithmically many sweeps and keeps its rim vertices intact.
    bool cutConvex(){
        double remaining=0;
        for(size_t i=0;i<polygon.size();++i){const auto& a=loop[polygon[i]];const auto& b=loop[polygon[(i+1)%polygon.size()]];remaining+=a.x*b.y-a.y*b.x;}
        std::vector<int> kept;kept.reserve(polygon.size());
        while(polygon.size()>3){
            int m=int(polygon.size()),cut=0;kept.clear();
            for(int j=0;j<m;++j){
                int a=polygon[(j+m-1)%m],b=polygon[j],c=polygon[(j+1)%m];
                double area=orient(loop[a],loop[b],loop[c]);
                if((j&1)&&m-cut>3&&area>eps&&remaining-area>eps&&diagonal(a,c)){
                    replacement.push_back({a,b,c});remaining-=area;++cut;
                }else kept.push_back(b);
            }
            if(!cut){
                // An odd-indexed run can be collinear. Try the other parity.
                bool found=false;
                for(int j=0;j<m;j+=2){
                    int a=polygon[(j+m-1)%m],b=polygon[j],c=polygon[(j+1)%m];
                    double area=orient(loop[a],loop[b],loop[c]);
                    if(area<=eps||remaining-area<=eps||!diagonal(a,c))continue;
                    replacement.push_back({a,b,c});remaining-=area;kept.erase(kept.begin()+j);found=true;break;
                }
                if(!found)return false;
            }
            polygon.swap(kept);
        }
        if(orient(loop[polygon[0]],loop[polygon[1]],loop[polygon[2]])<=eps)return false;
        replacement.push_back({polygon[0],polygon[1],polygon[2]});return true;
    }
    // Remove ears with all boundary samples retained, including collinear ones.
    // Starting from the existing disk avoids a hole-bridging special case.
    bool triangulate(int start,int finish){
        polygon.clear();int n=int(loop.size()),i=start;
        do{polygon.push_back(i);i=(i+1)%n;}while(i!=(finish+1)%n);
        if(polygon.size()>16&&convexOutline())return cutConvex();
        while(polygon.size()>3){
            int best=-1,m=int(polygon.size());double bestShape=-1;
            for(int j=0;j<m;++j){
                int a=polygon[(j+m-1)%m],b=polygon[j],c=polygon[(j+1)%m];
                const auto& A=loop[a];const auto& B=loop[b];const auto& C=loop[c];
                double area=orient(A,B,C);if(area<=eps)continue;
                D u=sub(B.local,A.local),v=sub(C.local,A.local),w=sub(C.local,B.local);
                double shape=area/(dot(u,u)+dot(v,v)+dot(w,w));
                if(shape<=bestShape||!diagonal(a,c))continue;
                bool clear=true;
                for(int k:polygon)if(k!=a&&k!=b&&k!=c){
                    const auto& P=loop[k];
                    if(orient(A,B,P)>=-eps&&orient(B,C,P)>=-eps&&orient(C,A,P)>=-eps){clear=false;break;}
                }
                if(clear){best=j;bestShape=shape;if(m>48)break;}
            }
            if(best<0)return false;
            replacement.push_back({polygon[(best+m-1)%m],polygon[best],polygon[(best+1)%m]});
            polygon.erase(polygon.begin()+best);
        }
        if(polygon.size()!=3||orient(loop[polygon[0]],loop[polygon[1]],loop[polygon[2]])<=eps)return false;
        replacement.push_back({polygon[0],polygon[1],polygon[2]});return true;
    }
    // On a straight fillet the normals lie in a plane perpendicular to the
    // extrusion. Its least-variation tangent is the longitudinal direction.
    bool longitudinalChord(int& left,int& right) const {
        double xx=0,xy=0,yy=0;
        for(const auto& v:loop){
            D n=val(normals[v.corner/3]);double x=dot(n,axisX),y=dot(n,axisY);
            xx+=x*x;xy+=x*y;yy+=y*y;
        }
        double spread=std::hypot(xx-yy,2*xy);
        double major=.5*(xx+yy+spread),minor=.5*(xx+yy-spread);
        if(major<1.e-5||minor>.20*major)return false;
        double dx,dy;
        if(xx>=yy){dx=-xy;dy=xx-minor;}else{dx=yy-minor;dy=-xy;}
        double length=std::hypot(dx,dy);if(!length)return false;
        dx/=length;dy/=length;double best=INFINITY;
        for(int i=0;i<int(loop.size());++i){
            const auto& a=loop[i];double u=a.x*dx+a.y*dy,v=a.y*dx-a.x*dy;
            if(u>=0||std::abs(v)>1.2*-u)continue;
            for(int j=0;j<int(loop.size());++j){
                if(boundary(i,j))continue;
                const auto& b=loop[j];double U=b.x*dx+b.y*dy,V=b.y*dx-b.x*dy;
                if(U<=0||std::abs(V)>1.2*U)continue;
                double slope=(V-v)/(U-u),t=-u/(U-u);
                if(std::abs(slope)>.42)continue;
                double offset=v+(V-v)*t,displacement=a.h+(b.h-a.h)*t;
                double score=offset*offset+.15*slope*slope+.20*displacement*displacement;
                if(score>=best||!diagonal(i,j))continue;
                left=i;right=j;best=score;
            }
        }
        return left>=0;
    }
    // The two triangulations share their complete boundary. On their projected
    // overlay the height difference is affine per cell. Its extrema are the
    // old center and intersections of old spokes with new internal chords.
    double overlayError(double limit) const {
        double maximum=0;
        for(const auto& t:replacement){
            const auto& A=loop[t[0]];const auto& B=loop[t[1]];const auto& C=loop[t[2]];
            double a=B.x*C.y-B.y*C.x,b=C.x*A.y-C.y*A.x,c=A.x*B.y-A.y*B.x;
            if(std::min({a,b,c})>=-eps){
                maximum=std::max(maximum,std::abs((a*A.h+b*B.h+c*C.h)/(a+b+c)));
            }
            for(int k=0;k<3;++k){
                int i=t[k],j=t[(k+1)%3];if(i>j||boundary(i,j))continue;
                const auto& p=loop[i];const auto& q=loop[j];
                double dx=q.x-p.x,dy=q.y-p.y;
                for(const auto& v:loop){
                    if(v.id==p.id||v.id==q.id)continue;
                    double det=v.x*dy-v.y*dx;if(std::abs(det)<=eps)continue;
                    double radial=(p.x*dy-p.y*dx)/det,chord=(p.x*v.y-p.y*v.x)/det;
                    if(radial<=0||radial>=1||chord<=0||chord>=1)continue;
                    maximum=std::max(maximum,std::abs(radial*v.h-(p.h+chord*(q.h-p.h))));
                }
            }
            if(maximum>limit)break;
        }
        return maximum;
    }
    bool nearField(D q) const {
        // Signed height on the old fan and on the filtered zero crossing, at
        // the same position in the support plane of this broad flat.
        double x=dot(q,axisX),y=dot(q,axisY),z=dot(q,normalAxis),old=0;
        for(size_t i=0;i<loop.size();++i){
            const auto& a=loop[i];const auto& b=loop[(i+1)%loop.size()];
            double d=a.x*b.y-a.y*b.x,u=(x*b.y-y*b.x)/d,v=(a.x*y-a.y*x)/d;
            if(u>=-1.e-7&&v>=-1.e-7&&u+v<=1.0000001){old=u*a.h+v*b.h;break;}
        }
        if(std::abs(z-old)<.004)return true;
        D pos=add(scale(sub(center,field.origin),1/field.pitch),add(scale(axisX,x),scale(axisY,y)));
        auto sample=[&](D p){return field.grid->sample(p.x,p.y,p.z);};
        double slope=sample(add(pos,scale(normalAxis,.5)))-sample(sub(pos,scale(normalAxis,.5)));
        if(slope>=-1)return false;
        double target=-sample(pos)/slope;
        return std::abs(z-target)<=std::max(1.6*flatLimit,std::abs(old-target)+.004);
    }
    // A rim sample may leave a broad plane. Minimize the maximum height
    // difference on all legal triangulations of a short link, including the
    // original center and every intersection with an old spoke.
    bool fitFlat(double budget,bool implicit=false){
        constexpr int cap=32;
        const int n=int(loop.size());if(n>cap)return false;
        double cost[cap][cap]{};int split[cap][cap]{};
        for(int length=2;length<n;++length)for(int i=0;i+length<n;++i){
            int j=i+length;const auto& a=loop[i];const auto& c=loop[j];
            double edge=0;
            if(!boundary(i,j)){
                if(!diagonal(i,j)){cost[i][j]=INFINITY;continue;}
                if(implicit){
                    D dir=sub(c.local,a.local);int count=std::clamp(int(std::ceil(std::sqrt(dot(dir,dir))/2)),2,64);
                    bool followsField=true;
                    for(int m=1;m<count;++m)if(!nearField(add(a.local,scale(dir,double(m)/count)))){followsField=false;break;}
                    if(!followsField){cost[i][j]=INFINITY;continue;}
                }
                double dx=c.x-a.x,dy=c.y-a.y;
                for(const auto& v:loop){
                    if(v.id==a.id||v.id==c.id)continue;
                    double det=v.x*dy-v.y*dx;if(std::abs(det)<=eps)continue;
                    double s=(a.x*dy-a.y*dx)/det,t=(a.x*v.y-a.y*v.x)/det;
                    if(s>0&&s<1&&t>0&&t<1)edge=std::max(edge,std::abs(s*v.h-(a.h+t*(c.h-a.h))));
                }
            }
            double best=INFINITY;
            if(edge<=budget)for(int k=i+1;k<j;++k){
                const auto& b=loop[k];double value=std::max({edge,cost[i][k],cost[k][j]});
                if(value>budget||value>=best||orient(a,b,c)<=eps)continue;
                double l=b.x*c.y-b.y*c.x,m=c.x*a.y-c.y*a.x,r=a.x*b.y-a.y*b.x;
                if(std::min({l,m,r})>=-eps)value=std::max(value,std::abs((l*a.h+m*b.h+r*c.h)/(l+m+r)));
                if(value<=budget&&value<best&&(!implicit||nearField(scale(add(add(a.local,b.local),c.local),1./3)))){best=value;split[i][j]=k;}
            }
            cost[i][j]=best;
        }
        if(cost[0][n-1]>budget)return false;
        std::array<std::array<int,2>,cap> stack{};int top=0;stack[top++]={0,n-1};
        while(top){
            auto ij=stack[--top];int i=ij[0],j=ij[1],k=split[i][j];replacement.push_back({i,k,j});
            if(k>i+1)stack[top++]={i,k};
            if(j>k+1)stack[top++]={k,j};
        }
        return true;
    }
    bool fieldAccepts() const {
        for(const auto& t:replacement){
            D a=val(points[loop[t[0]].id]),b=val(points[loop[t[1]].id]),c=val(points[loop[t[2]].id]);
            D n=cross(sub(b,a),sub(c,a));
            if(!field.fits(scale(add(add(a,b),c),1./3),n,fieldLimit))return false;
            for(int k=0;k<3;++k){
                int i=t[k],j=t[(k+1)%3];if(i>j||boundary(i,j))continue;
                D from=val(points[loop[i].id]),delta=sub(val(points[loop[j].id]),from);
                int pieces=std::clamp(int(std::ceil(std::sqrt(dot(delta,delta))/(3*field.pitch))),2,64);
                for(int m=1;m<pieces;++m)if(!field.fits(add(from,scale(delta,double(m)/pieces)),n,fieldLimit))return false;
            }
        }
        return true;
    }
    // Each patch has one fixed support plane. Both triangulations stay in its
    // slab, even after many removals. Floods follow real triangle adjacency.
    std::vector<U> labels;
    std::vector<D> planes;
    std::vector<U> sizes,preferred;
    U patchAt(U id) const {
        U first=rings.head[id];if(first==none)return none;
        U patch=labels[first/3];if(patch==none)return none;
        for(U c=rings.next[first];c!=none;c=rings.next[c])if(labels[c/3]!=patch)return none;
        return patch;
    }
    void clusterPlanes(){
        const U count=faces.size()/3;std::vector<U> mate(faces.size(),none);
        for(U id=0;id<points.size();++id){
            for(U c=rings.head[id];c!=none;c=rings.next[c])cornerAt[faces[nextCorner(c)]]=c;
            for(U c=rings.head[id];c!=none;c=rings.next[c]){
                U incoming=prevCorner(c);mate[incoming]=cornerAt[faces[incoming]];
            }
            for(U c=rings.head[id];c!=none;c=rings.next[c])cornerAt[faces[nextCorner(c)]]=none;
        }
        std::array<std::vector<U>,64> seeds;
        std::vector<unsigned char> used(count);labels.assign(count,none);
        for(U f=0;f<count;++f){
            U c=3*f;if(faces[c]==none)continue;
            D a=val(points[faces[c]]),u=sub(val(points[faces[c+1]]),a),v=sub(val(points[faces[c+2]]),a);
            D w=cross(u,v);double size=dot(w,w)/(std::max(1.e-40,dot(u,u)+dot(v,v)+dot(sub(u,v),sub(u,v)))*field.pitch*field.pitch);
            int exponent=0;std::frexp(size,&exponent);
            seeds[std::clamp(exponent+32,0,63)].push_back(f);
        }
        const double half=flatLimit*field.pitch;std::vector<U> flood;
        for(int bucket=63;bucket>=0;--bucket)for(U seed:seeds[bucket]){
            if(used[seed])continue;
            D n=val(normals[seed]),origin=val(points[faces[3*seed]]);
            flood.clear();flood.push_back(seed);used[seed]=1;
            for(size_t k=0;k<flood.size();++k){
                U c=3*flood[k];
                for(U e=c;e<c+3;++e){
                    if(mate[e]==none)continue;
                    U f=mate[e]/3;if(used[f]||dot(n,val(normals[f]))<.65)continue;
                    bool inSlab=true;
                    for(U j=3*f;j<3*f+3;++j){
                        if(std::abs(dot(sub(val(points[faces[j]]),origin),n))>half){inSlab=false;break;}
                    }
                    if(inSlab){used[f]=1;flood.push_back(f);}
                }
            }
            if(flood.size()<4)continue;
            U patch=U(planes.size());planes.push_back(n);sizes.push_back(U(flood.size()));
            for(U f:flood)labels[f]=patch;
        }
    }
    unsigned support(D point,D n) const {
        D o=scale(sub(point,field.origin),1/field.pitch);
        D x=unit(cross(n,std::abs(n.x)<.8?D{1,0,0}:D{0,1,0})),y=cross(n,x);
        const auto& g=*field.grid;
        auto sample=[&](D a){return g.sample(a.x,a.y,a.z);};
        double gradient=std::abs(sample(add(o,scale(n,.5)))-sample(sub(o,scale(n,.5))));
        if(gradient<1||std::abs(sample(o))>.04*gradient)return 0;
        unsigned level=0;
        for(double r:{2.,4.,8.,16.}){
            for(int j=0;j<8;++j){
                constexpr double diagonal=.7071067811865475;
                static constexpr double uv[8][2]={{1,0},{diagonal,diagonal},{0,1},{-diagonal,diagonal},{-1,0},{-diagonal,-diagonal},{0,-1},{diagonal,-diagonal}};
                D probe=add(o,add(scale(x,r*uv[j][0]),scale(y,r*uv[j][1])));
                if(std::abs(sample(probe))>.045*gradient)return level;
            }
            ++level;
        }
        return level;
    }
    void simplifyPlanes(){
        // Retire redundant samples with short links while their immediate
        // neighbors are still present. This avoids creating a long spoke
        // spanning both an exactly flat sample and a neighboring fillet.
        double tolerance=flatLimit;flatLimit=std::min(tolerance,.001);
        for(U maxDegree:{4u,6u})for(U id=0;id<points.size();++id)
            if(degree[id]>=3&&degree[id]<=maxDegree)replace(id,RegionFit::local);
        flatLimit=tolerance;clusterPlanes();
        preferred.assign(points.size(),none);
        for(U i=0;i<points.size();++i){
            U chosen=none;
            for(U c=rings.head[i];c!=none;c=rings.next[c]){
                U p=labels[c/3];
                if(p!=none&&sizes[p]>=24&&(chosen==none||sizes[p]>sizes[chosen]))chosen=p;
            }
            preferred[i]=chosen;
        }
        if(field.grid&&stripLimit>flatLimit){
            std::array<std::vector<U>,16> levels;
            for(U i=0;i<points.size();++i){
                if(preferred[i]==none)continue;
                D n=planes[preferred[i]];unsigned level=support(val(points[i]),n);if(level<2)continue;
                D o=val(points[i]);double far=0;
                for(U c=rings.head[i];c!=none;c=rings.next[c]){
                    D d=sub(val(points[faces[nextCorner(c)]]),o);
                    far=std::max(far,std::abs(dot(d,n))/field.pitch);
                }
                unsigned priority=4*std::min(3u,unsigned(far/.023))+level-1;
                levels[priority].push_back(i);
            }
            for(int k=15;k>=0;--k)for(U id:levels[k])replace(id,RegionFit::fieldFringe);
        }
        pass(RegionFit::patch);pass(RegionFit::fringe);
        if(planarRemoved)compact(points,faces);
    }
    bool replace(U id,RegionFit mode){
        bool fixedPlanes=mode==RegionFit::patch;
        bool broad=mode==RegionFit::field||mode==RegionFit::fieldFringe;
        bool fringe=mode==RegionFit::fringe||mode==RegionFit::fieldFringe;
        U patch=fixedPlanes?patchAt(id):fringe?preferred[id]:none;
        if(((fixedPlanes||fringe)&&patch==none)||!chart(id,patch))return false;
        int n=int(loop.size());
        if(n==3){
            // The other face of a tetrahedral component can already fill this cycle.
            for(U c=rings.head[loop[0].id];c!=none;c=rings.next[c]){
                if(faces[nextCorner(c)]==loop[2].id&&faces[prevCorner(c)]==loop[1].id)return false;
            }
        }
        bool flat=!broad&&(fixedPlanes||span+prior<=flatLimit);
        if(broad){
            if(n>32||span>.75||!std::any_of(loop.begin(),loop.end(),[](const ChartPoint& a){return dot(a.local,a.local)>16;}))return false;
            if(support(center,normalAxis)<2)return false;
        }
        replacement.clear();
        double localLimit=broad?std::min(fieldLimit,2*stripLimit):fringe?std::min(stripLimit,2*flatLimit):flatLimit;
        bool fitted=!flat&&prior<localLimit&&(broad||span<=.40)&&fitFlat(localLimit-prior,broad);
        if(!flat&&!fitted&&(mode!=RegionFit::strip||prior>=stripLimit||n>48))return false;
        if(flat){
            if(!triangulate(0,n-1))return false;
        }else if(!fitted){
            int a=-1,b=-1;
            if(!longitudinalChord(a,b)||!triangulate(a,b)||!triangulate(b,a))return false;
        }
        double limit=flat||fitted?localLimit:stripLimit;
        double delta=fixedPlanes?0:flat?span:overlayError(limit-prior);
        if(prior+delta>limit)return false;
        if(!flat&&!fitted&&delta>.006&&field.grid&&!fieldAccepts())return false;
        // Transfer the accumulated geometric bound to the new triangles before
        // retiring the old ones. No change becomes visible on rejection.
        publishDisk(prior+delta,fringe);
        if(flat||fitted)++planarRemoved;else ++stripRemoved;
        return true;
    }
    void publishDisk(double bound,bool fringe){
        for(U c:incident){U f=c-c%3;for(U j=f;j<f+3;++j)unlink(j);}
        for(size_t i=0;i<replacement.size();++i){
            U f=incident[i]-incident[i]%3;
            for(int j=0;j<3;++j)insert(f+j,loop[replacement[i][j]].id);
            measure(f);if(fringe)labels[f/3]=none;error[f/3]=float(bound);
        }
    }
    void pass(RegionFit mode){
        queue.resize(points.size());std::iota(queue.begin(),queue.end(),0u);std::fill(pending.begin(),pending.end(),1);
        if(mode==RegionFit::patch){
            // Eliminate the middle first while a full ring of flat samples
            // still anchors its transition into neighboring fillets.
            std::vector<unsigned char> visited(points.size());queue.clear();
            for(U i=0;i<points.size();++i)if(patchAt(i)==none){visited[i]=1;queue.push_back(i);}
            for(size_t j=0;j<queue.size();++j){
                for(U c=rings.head[queue[j]];c!=none;c=rings.next[c]){
                    U i=faces[nextCorner(c)];if(!visited[i]){visited[i]=1;queue.push_back(i);}
                }
            }
            for(U i=0;i<points.size();++i)if(!visited[i])queue.push_back(i);
            std::reverse(queue.begin(),queue.end());
        }
        for(size_t q=0;q<queue.size();++q){
            U id=queue[q];pending[id]=0;
            if(!replace(id,mode))continue;
            for(const auto& n:loop)if(!pending[n.id]){pending[n.id]=1;queue.push_back(n.id);}
        }
    }
    void settleBoundaries(){
        std::array<std::vector<U>,5> byDepth;
        for(U id=0;id<points.size();++id){
            if(degree[id]<3||degree[id]>32)continue;
            bool longEdge=false;D p=val(points[id]);
            for(U c=rings.head[id];c!=none;c=rings.next[c]){
                D d=sub(val(points[faces[nextCorner(c)]]),p);
                if(dot(d,d)>16*field.pitch*field.pitch){longEdge=true;break;}
            }
            if(!longEdge||!chart(id,none)||span>.8)continue;
            unsigned level=support(p,normalAxis);if(level>=2)byDepth[level].push_back(id);
        }
        queue.clear();std::fill(pending.begin(),pending.end(),0);
        // Visit plane-to-rim transitions before their wide flat interiors.
        for(unsigned level=2;level<=4;++level)for(U id:byDepth[level]){queue.push_back(id);pending[id]=1;}
        for(size_t at=0;at<queue.size();++at){
            U id=queue[at];pending[id]=0;
            if(!replace(id,RegionFit::field))continue;
            for(const auto& v:loop)if(v.id!=id&&!pending[v.id]){pending[v.id]=1;queue.push_back(v.id);}
        }
    }
    void build(){
        pass(RegionFit::local);pass(RegionFit::strip);
        if(field.grid&&stripLimit>flatLimit)settleBoundaries();
        if(planarRemoved||stripRemoved)compact(points,faces);
    }
};
