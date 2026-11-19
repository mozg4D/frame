namespace unite_outline {
// The curved sheet determines how many samples its common perimeter needs.
// Contract an open boundary edge only when its one-sided link is a disk and
// the surviving triangles and the original boundary chain stay in tolerance.
static bool joinRims(Surface& s,std::vector<Outline>& caps,double pitch,unsigned strength){
    if(caps.empty())return true;
    using unite_surface::nextCorner;using unite_surface::prevCorner;
    using unite_surface::normal;using unite_surface::scale;using unite_surface::add;
    auto& t=s.indices;
    std::vector<std::vector<U>> ids(caps.size());
    for(size_t k=0;k<caps.size();++k){ids[k].reserve(caps[k].points.size());for(V p:caps[k].points)ids[k].push_back(s.vertices.insert(p));}
    auto& p=s.vertices.points;
    std::vector<U> index(p.size(),none);std::vector<unsigned char> shared;
    std::vector<std::vector<U>> fans;
    for(const auto& cap:ids)for(U id:cap){
        if(index[id]!=none){shared[index[id]]=1;continue;}
        index[id]=fans.size();fans.emplace_back();shared.push_back(0);
    }
    for(U c=0;c<t.size();++c)if(index[t[c]]!=none)fans[index[t[c]]].push_back(c);
    // Project along the chart axis. The constrained polygon retains exactly
    // the same projection. Its neighbor shares the identical Float32 vertex.
    for(size_t ci=0;ci<caps.size();++ci){
        const auto& cap=caps[ci];int d=cap.axis;
        for(U a:ids[ci]){
            if(shared[index[a]])continue;
            D old=val(p[a]);double shift=-dot(sub(old,cap.planePoint),cap.planeNormal)/at(cap.planeNormal,d);
            if(std::abs(shift)>(strength?.085:std::max(1.e-6,cap.crossingPrecision/std::abs(at(cap.planeNormal,d))))*pitch)continue;
            V pos=p[a];if(d==0)pos.x=float(old.x+shift);else if(d==1)pos.y=float(old.y+shift);else pos.z=float(old.z+shift);
            bool safe=true;
            for(U c:fans[index[a]]){
                U u=t[nextCorner(c)],v=t[prevCorner(c)];D before=normal(p[a],p[u],p[v]),now=normal(pos,p[u],p[v]);
                double m=dot(now,before);
                if(m<=1.e-4*dot(before,before)||m*m<.90*dot(before,before)*dot(now,now)){safe=false;break;}
            }
            if(safe)p[a]=pos;
        }
    }
    auto append=[&](const Outline& cap,const std::vector<U>& global){for(Tri tri:cap.triangles)for(U j:tri)t.push_back(global[j]);};
    std::vector<float> debt(t.size()/3);std::vector<U> marks(p.size());U stamp=0;
    struct Edit {U slot,old;float debt;};
    std::vector<Edit> changes;bool modified=false;
    for(size_t ci=0;ci<caps.size();++ci){
        auto& cap=caps[ci];const auto& global=ids[ci];changes.clear();
        double h=strength?(.012+.115*strength/100.):std::max(1.e-6,cap.crossingPrecision);
        double line=strength?(.1+.85*strength/100.):std::max(1.e-6,2*cap.crossingPrecision);
        Outline trimmed;trimmed.points=cap.points;
        for(const Ring& loop:cap.rings){
            int n=int(loop.size());std::vector<int> prev(n),next(n);
            for(int i=0;i<n;++i){prev[i]=(i+n-1)%n;next[i]=(i+1)%n;}
            int left=n;
            auto contract=[&](int i,int dest){
                U a=global[loop[i]],b=global[loop[dest]];int l=prev[i],r=next[i];
                if(shared[index[a]]||shared[index[b]])return false;
                auto& from=fans[index[a]];auto& to=fans[index[b]];
                if(from.empty()||from.size()>96||to.size()>96)return false;
                D L=val(p[global[loop[l]]]),dir=sub(val(p[global[loop[r]]]),L);double norm=dot(dir,dir);
                if(!norm)return false;
                for(int j=(l+1)%n;j!=r;j=(j+1)%n){
                    D q=sub(val(p[global[loop[j]]]),L);
                    D e=sub(q,scale(dir,std::clamp(dot(q,dir)/norm,0.,1.)));
                    if(dot(e,e)>line*line*pitch*pitch)return false;
                }
                ++stamp;U opposite=none,removed=none;D A=val(p[a]),B=val(p[b]),delta=sub(B,A);
                std::vector<std::pair<U,float>> update;
                for(U c:from)if(t[c]==a){
                    U u=t[nextCorner(c)],v=t[prevCorner(c)];marks[u]=marks[v]=stamp;
                    if(u==b||v==b){if(removed!=none)return false;removed=c-c%3;opposite=u==b?v:u;continue;}
                    D before=normal(p[a],p[u],p[v]),after=normal(p[b],p[u],p[v]);double old=dot(before,before),alignment=dot(after,before);
                    if(alignment<=1.e-6*old||alignment*alignment<.55*old*dot(after,after))return false;
                    double err=debt[c/3]+std::abs(dot(delta,before))/(pitch*std::sqrt(old));
                    if(err>h)return false;
                    update.emplace_back(c,float(err));
                }
                if(removed==none||(update.empty()&&opposite!=global[loop[dest==l?r:l]]))return false;
                for(U c:to)if(t[c]==b)for(U v:{t[nextCorner(c)],t[prevCorner(c)]})
                    if(v!=a&&v!=opposite&&marks[v]==stamp)return false;
                for(U j=removed;j<removed+3;++j){changes.push_back({j,t[j],debt[j/3]});t[j]=none;}
                for(auto [c,e]:update){changes.push_back({c,a,debt[c/3]});t[c]=b;debt[c/3]=e;to.push_back(c);}
                s.perimeterRimSkipped++;next[l]=r;prev[r]=l;next[i]=-1;--left;return true;
            };
            for(int pass=0;pass<10&&left>3;++pass){
                int initial=left;
                for(int k=0;k<n&&left>3;++k){
                    int i=pass&1?n-1-k:k;if(next[i]<0)continue;
                    int a=prev[i],b=next[i];D o=val(p[global[loop[i]]]);
                    D da=sub(val(p[global[loop[a]]]),o),db=sub(val(p[global[loop[b]]]),o);
                    if(dot(da,da)>dot(db,db))std::swap(a,b);
                    if(!contract(i,a))contract(i,b);
                }
                if(left==initial)break;
            }
            trimmed.rings.emplace_back();for(int j=0;j<n;++j)if(next[j]>=0)trimmed.rings.back().push_back(loop[j]);
        }
        if(changes.empty()){append(cap,global);continue;}
        if(trimmed.fill(cap.axis,cap.sign)){
            append(trimmed,global);modified=true;
        }else{
            for(auto it=changes.rbegin();it!=changes.rend();++it){t[it->slot]=it->old;debt[it->slot/3]=it->debt;}
            for(size_t j=0;j<cap.rings.size();++j)s.perimeterRimSkipped-=cap.rings[j].size()-trimmed.rings[j].size();
            append(cap,global);
        }
    }
    // No later stage may see the retired faces or unreferenced rim samples.
    if(!closedLinks(s,index))return false;
    if(modified)unite_surface::compact(s.vertices.points,s.indices);
    s.vertices.slots.clear();
    return true;
}
}
