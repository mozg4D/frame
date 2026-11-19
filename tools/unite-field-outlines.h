// Extract the perimeter in the crossing lattice, before meshing the sheet.
// Each plane is searched through its two-dimensional footprint. Cells cannot
// join across a different material sheet or across an asymptotic-decider cell.
namespace unite_outline {
template<class Samples> struct FieldOutlines {
    const Samples& samples;const Axes& axes;int size[3];unsigned strength;bool rawField;
    Picks picks;std::vector<Outline> caps;
    U covered=0,holes=0,raw=0,interior=0;
    FieldOutlines(const Samples& data,const Axes& a,int x,int y,int z,unsigned percent,bool raw):
        samples(data),axes(a),size{x,y,z},strength(percent),rawField(raw),picks(x,y){}
    U64 cell(int x,int y,int z)const{return U64(x)+U64(size[0])*(y+U64(size[1])*z);}
    std::array<int,3> xyz(U64 id)const{
        int x=id%size[0];id/=size[0];return {x,int(id%size[1]),int(id/size[1])};
    }
    U64 crossing(const std::array<int,3>& p,int edge)const{
        const auto& o=corners[edges[edge][0]];
        return 3*cell(p[0]+o[0],p[1]+o[1],p[2]+o[2])+edge/4;
    }
    V position(U64 key)const{
        auto p=xyz(key/3),q=p;int d=key%3;++q[d];
        double t=fraction(samples.value(p[0],p[1],p[2]),samples.value(q[0],q[1],q[2]));
        return {float(axes.coordinate(0,p[0],d==0?t:0)),float(axes.coordinate(1,p[1],d==1?t:0)),float(axes.coordinate(2,p[2],d==2?t:0))};
    }
    int lower(int d,double value)const{
        if(axes.knots[d])return std::clamp(int(std::upper_bound(axes.knots[d],axes.knots[d]+size[d],value)-axes.knots[d])-1,0,size[d]-2);
        return int(std::clamp(std::floor((value-at(axes.origin,d))/axes.pitch),0.,double(size[d]-2)));
    }
    // At zero Optimize a raw field crossing can differ from an exact source
    // plane by the endpoint clamp and field quantization. Accept this floor
    // only inside the projected footprint of actual large source triangles.
    struct Coverage {
        const unite_planes::Support& plane;std::vector<std::vector<U>> bins;double x0,y0,dx,dy;
        int col(double x)const{return std::clamp(int((x-x0)*dx),0,15);}
        int row(double y)const{return std::clamp(int((y-y0)*dy),0,15);}
        Coverage(const unite_planes::Support& p,bool required):plane(p){
            if(!required||p.facets.empty())return;
            int u=(p.axis+1)%3,v=(p.axis+2)%3;x0=at(p.bounds.lo,u);y0=at(p.bounds.lo,v);
            dx=16/(at(p.bounds.hi,u)-x0);dy=16/(at(p.bounds.hi,v)-y0);bins.resize(256);
            for(U i=0;i<p.facets.size();++i){
                const auto& a=p.facets[i].p;
                int l=col(std::min({a[0][0],a[1][0],a[2][0]})),r=col(std::max({a[0][0],a[1][0],a[2][0]}));
                int b=row(std::min({a[0][1],a[1][1],a[2][1]})),t=row(std::max({a[0][1],a[1][1],a[2][1]}));
                for(int y=b;y<=t;++y)for(int x=l;x<=r;++x)bins[x+16*y].push_back(i);
            }
        }
        bool contains(Point q)const{
            for(U i:bins[col(q[0])+16*row(q[1])]){
                const auto& p=plane.facets[i].p;double a=turn(p[0],p[1],q),b=turn(p[1],p[2],q),c=turn(p[2],p[0],q);
                if(std::min({a,b,c})>=0||std::max({a,b,c})<=0)return true;
            }
            return false;
        }
    };
    struct Face {U64 id;unsigned char mask;int8_t sign;float lo,hi;};
    bool read(const std::array<int,3>& p,const unite_planes::Support& plane,double tol,const Coverage& coverage,Face& out)const{
        int f[8],mask=0;for(int j=0;j<8;++j){
            f[j]=samples.value(p[0]+corners[j][0],p[1]+corners[j][1],p[2]+corners[j][2]);if(f[j]>0)mask|=1<<j;
        }
        const auto& pattern=tables.patterns[mask];if(!pattern.simple)return false;
        int d=plane.axis,u=(d+1)%3,v=(d+2)%3;double lo=INFINITY,hi=-INFINITY;
        Point xy[12];double area=0;int sign=0;
        for(int j=0;j<pattern.count;++j){
            int edge=pattern.loop[j],axis=edge/4;const auto& a=corners[edges[edge][0]];
            double t=fraction(f[edges[edge][0]],f[edges[edge][1]]);
            D q=val(V{float(axes.coordinate(0,p[0]+a[0],axis==0?t:0)),float(axes.coordinate(1,p[1]+a[1],axis==1?t:0)),
                      float(axes.coordinate(2,p[2]+a[2],axis==2?t:0))});
            double offset=dot(sub(q,plane.origin),plane.n)/axes.pitch;lo=std::min(lo,offset);hi=std::max(hi,offset);
            if(hi-lo>2*tol||lo>.58||hi<-.58)return false;
            xy[j]={at(q,u),at(q,v)};
            if(j>=2){
                double turn2=turn(xy[0],xy[j-1],xy[j]);
                if(turn2==0||sign*(turn2)<0)return false;
                sign=turn2>0?1:-1;area+=turn2;
            }
        }
        if(!area)return false;
        if(!coverage.bins.empty()){
            if(lo< -tol||hi>tol)return false;
            for(int j=0;j<pattern.count;++j)if(!coverage.contains(xy[j]))return false;
        }
        out={cell(p[0],p[1],p[2]),static_cast<unsigned char>(mask),int8_t(sign),float(lo),float(hi)};return true;
    }
    void find(){
        int longest=std::max({size[0],size[1],size[2]});size_t budget=std::max(size_t(65536),size_t(longest)*longest*6);
        for(const auto& plane:unite_planes::supports){
            int d=plane.axis,u=(d+1)%3,v=(d+2)%3;
            const double margin=2*axes.pitch;
            int x0=lower(u,at(plane.bounds.lo,u)-margin),x1=lower(u,at(plane.bounds.hi,u)+margin);
            int y0=lower(v,at(plane.bounds.lo,v)-margin),y1=lower(v,at(plane.bounds.hi,v)+margin);
            size_t area=size_t(x1-x0+1)*(y1-y0+1);if(area>budget||area<36)continue;budget-=area;
            Coverage coverage(plane,rawField&&!strength);
            const double tol=strength?std::min(.053,.08*strength/100.):(coverage.bins.empty()?1.e-6:1./96+.005);
            const double nu=at(plane.n,u)/at(plane.n,d),nv=at(plane.n,v)/at(plane.n,d);
            std::vector<Face> candidates;std::array<U,241> votes{};
            for(int y=y0;y<=y1;++y)for(int x=x0;x<=x1;++x){
                double z=at(plane.origin,d)-nu*(axes.coordinate(u,x)-at(plane.origin,u))-nv*(axes.coordinate(v,y)-at(plane.origin,v));
                double du=-nu*(axes.coordinate(u,x+1)-axes.coordinate(u,x)),dv=-nv*(axes.coordinate(v,y+1)-axes.coordinate(v,y));
                double pad=.60*axes.pitch/std::abs(at(plane.n,d));
                int first=lower(d,z+std::min(0.,du)+std::min(0.,dv)-pad),last=lower(d,z+std::max(0.,du)+std::max(0.,dv)+pad);
                for(int k=first;k<=last;++k){
                    std::array<int,3> p;p[u]=x;p[v]=y;p[d]=k;Face f;
                    if(!read(p,plane,tol,coverage,f)||(!picks.blocks.empty()&&picks.has(p[0],p[1],p[2])))continue;
                    int bucket=std::clamp(int(std::round(100*(f.lo+f.hi)))+120,0,240);++votes[bucket];candidates.push_back(f);
                }
            }
            if(candidates.size()<32)continue;
            int peak=std::max_element(votes.begin(),votes.end())-votes.begin();
            // Use an actual measured offset, also at zero Optimize, where the
            // uniform field's iso-plane can have a nonzero sub-cell phase.
            double offset=0;U count=0;
            for(Face f:candidates)if(int(std::round(100*(f.lo+f.hi)))+120==peak){offset+=.5*(f.lo+f.hi);++count;}
            if(!count)continue;offset=coverage.bins.empty()?offset/count:0;
            std::unordered_map<U64,U> index;index.reserve(candidates.size());
            for(U i=0;i<candidates.size();++i){auto f=candidates[i];if(f.lo>=offset-tol&&f.hi<=offset+tol)index.emplace(f.id,i);}
            std::vector<unsigned char> seen(candidates.size());std::vector<U> group;std::vector<Side> sides;
            const int64_t stride[]={1,size[0],int64_t(size[0])*size[1]};
            for(U seed=0;seed<candidates.size();++seed){
                const Face s=candidates[seed];if(seen[seed]||!index.count(s.id))continue;
                seen[seed]=1;group.clear();sides.clear();group.push_back(seed);U faces=0,cornersTotal=0;
                for(size_t q=0;q<group.size();++q){
                    auto f=candidates[group[q]];auto p=xyz(f.id);auto& pat=tables.patterns[f.mask];
                    faces+=pat.count-2;cornersTotal+=pat.count;
                    for(int j=0;j<pat.count;++j){
                        int a=pat.loop[j],b=pat.loop[(j+1)%pat.count],side=tables.commonSide[a][b];
                        U64 other=f.id+((side&1)?1:-1)*stride[2-side/2];auto it=index.find(other);
                        if(it!=index.end()&&candidates[it->second].sign==s.sign){
                            U id=it->second;if(!seen[id]){seen[id]=1;group.push_back(id);}
                        }else sides.push_back({crossing(p,a),crossing(p,b)});
                    }
                }
                if(group.size()<32||sides.size()+8>=faces)continue;
                Outline cap;if(!cap.trace(sides,[&](U64 key){return position(key);}))continue;
                // Narrow strips have very little planar interior. Leave their
                // shared samples with the curved contour on both sides.
                double area2=0,length=0;D anchor=val(cap.points[0]);
                for(const auto& ring:cap.rings)for(size_t j=0;j<ring.size();++j){
                    D a=val(cap.points[ring[j]]),b=val(cap.points[ring[(j+1)%ring.size()]]);
                    area2+=dot(cross(sub(a,anchor),sub(b,anchor)),plane.n);D dv=sub(b,a);length+=std::sqrt(dot(dv,dv));
                }
                if((std::abs(area2)<4.8*length*axes.pitch&&std::abs(area2)<.050*length*length)||!cap.fill(d,s.sign))continue;
                // Euler count for one connected orientable sheet with H holes.
                int h=int(cap.rings.size())-1;
                int inside=int((cornersTotal-sides.size())/2)-int(group.size())+1-h;
                if(inside<=0)continue;
                for(U i:group){auto p=xyz(candidates[i].id);picks.set(p[0],p[1],p[2]);}
                cap.crossingPrecision=!coverage.bins.empty()?tol:0;cap.planeNormal=plane.n;cap.planePoint=unite_surface::add(plane.origin,unite_surface::scale(plane.n,offset*axes.pitch));
                covered+=group.size();raw+=faces;holes+=h;interior+=inside;caps.push_back(std::move(cap));
            }
        }
    }
    bool finish(Surface& s){
        if(!joinRims(s,caps,axes.pitch,strength))return false;
        s.regular+=covered;s.referenceFaces+=raw;s.perimeterCells+=covered;s.perimeterPatches+=caps.size();
        s.perimeterHoles+=holes;s.perimeterInterior+=interior;return true;
    }
};
}
