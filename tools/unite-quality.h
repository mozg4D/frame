// Global contour fitting. The edge link and oriented triangle checks protect
// tunnels and adjoining sheets when eliminating a crossing shared by tiles.
namespace unite_surface {
static U nextCorner(U c){return c%3==2?c-2:c+1;}
static U prevCorner(U c){return c%3==0?c+2:c-1;}
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
        std::vector<V> axis(p.size());
        for(U i=0;i<t.size();i+=3){
            D n=unit(normal(p[t[i]],p[t[i+1]],p[t[i+2]]));face[i/3]=vertex(n);
            for(int j=0;j<3;++j){auto& a=axis[t[i+j]];a=vertex(add(val(a),n));}
        }
        for(auto& a:axis)a=vertex(unit(val(a)));
        // A cone of half the native 44-degree crease threshold cannot contain
        // both normals of a hard edge. Keep ridge endpoints on the crease.
        constexpr double cone=0.9271838545667874; // cos(22 degrees)
        for(U i=0;i<t.size();++i)if(dot(val(face[i/3]),val(axis[t[i]]))<cone)sharp[t[i]]=1;
    }
};
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
// Every non-coplanar retriangulation samples the same continuous implicit
// contour that supplied its starting patches, including across tile boundaries.
struct Reference {
    const unite_field::Grid* grid;
    D origin;double pitch;
    bool fits(D point,D normal,double limit) const {
        D u=scale(sub(point,origin),1/pitch);
        int x=int(std::floor(u.x)),y=int(std::floor(u.y)),z=int(std::floor(u.z));
        double t[]={u.x-x,u.y-y,u.z-z},d=0;D g{};
        for(int k=0;k<2;++k)for(int j=0;j<2;++j)for(int i=0;i<2;++i){
            double f=grid->value(x+i,y+j,z+k),a=i?t[0]:1-t[0],b=j?t[1]:1-t[1],c=k?t[2]:1-t[2];
            d+=a*b*c*f;g.x+=(i?1:-1)*b*c*f;g.y+=a*(j?1:-1)*c*f;g.z+=a*b*(k?1:-1)*f;
        }
        double length=dot(g,g),align=dot(g,normal);
        if(length<=1||d*d>limit*limit*length||align>=0||align*align<.65*length*dot(normal,normal))return false;
        if(d*d<=.025*.025*length)return true;
        // A tangent disk contained in one plane is a tighter constraint than
        // the user's tolerance for curved regions. Keep broad flats anchored.
        D foot=sub(u,scale(g,d/length)),axis=unit(g);
        D tangent=unit(cross(axis,std::abs(axis.x)<.8?D{1,0,0}:D{0,1,0}));
        D second=cross(axis,tangent);
        for(D v:{tangent,second})for(double sign:{-1.5,1.5}){
            D probe=add(foot,scale(v,sign));
            if(std::abs(grid->sample(probe.x,probe.y,probe.z))>.04*unite_field::full)return true;
        }
        return false;
    }
};
static U optimize(std::vector<V>& p,std::vector<U>& t,Rings& rings,const Features& f,const Reference& reference,unsigned percent){
    double pitch=reference.pitch;
    size_t remaining=t.size()/3;
    if(remaining<=4)return 0;
    std::vector<Quadric> quadrics(p.size());std::vector<U> degree(p.size()),marked(p.size(),none);
    for(U i=0;i<t.size();++i){quadrics[t[i]].plane(val(f.face[i/3]));++degree[t[i]];}
    const double inv=1/pitch,tolerance=percent ? .006+.64*std::pow(percent/100.,2) : 1.e-6,tolerance2=tolerance*tolerance;
    const double sampleLimit=std::min(.18,tolerance);
    U collapsed=0,stamp=0;
    for(U pass=0;pass<12&&remaining>4;++pass){
        U previous=collapsed;
        for(U k=0;k<p.size()&&remaining>4;++k){
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
                double shift2=std::pow(dot(old,d),2)/(dot(old,old)*pitch*pitch);
                if(shift2>(f.sharp[a]?1.e-12:tolerance2)){safe=false;break;}
                if(shift2>1.e-12){
                    D dest=val(p[b]),left=val(p[u]),right=val(p[v]);
                    if(!reference.grid||!reference.fits(scale(add(add(dest,left),right),1./3),now,sampleLimit)||
                        !reference.fits(scale(add(dest,left),.5),now,sampleLimit)||
                        !reference.fits(scale(add(dest,right),.5),now,sampleLimit)){safe=false;break;}
                }
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
// Improve the shared diagonal of nearly planar convex quads. A pass uses
// disjoint vertex stars, so its incidence lists stay authoritative for every edit.
static U improveDiagonals(const std::vector<V>& p,std::vector<U>& t,const Reference& field,bool curved){
    std::vector<unsigned char> used(p.size());U changed=0;
    auto shape=[](D n,D e,D f){
        D g=sub(e,f);double sum=dot(e,e)+dot(f,f)+dot(g,g);
        return dot(n,n)/(sum*sum);
    };
    for(int pass=0;pass<4;++pass){
        Rings rings(p.size(),t);std::fill(used.begin(),used.end(),0);U before=changed;
        for(U c=0;c<t.size();++c){
            U a=t[c],b=t[nextCorner(c)],l=t[prevCorner(c)];
            if(a>=b||used[a]||used[b]||used[l])continue;
            U mate=rings.head[b];while(mate!=none&&t[nextCorner(mate)]!=a)mate=rings.next[mate];
            if(mate==none)continue;U r=t[prevCorner(mate)];if(used[r]||l==r)continue;
            D A=val(p[a]),B=val(p[b]),L=val(p[l]),R=val(p[r]);
            D ab=sub(B,A),al=sub(L,A),br=sub(R,B);
            D left=cross(ab,al),right=cross(scale(ab,-1),br);
            double ll=dot(left,left),rr=dot(right,right),both=dot(left,right);
            if(both<=0||both*both<.97*ll*rr)continue;
            double previous=std::min(shape(left,ab,al),shape(right,scale(ab,-1),br));
            if(previous>.04)continue;
            D lr=sub(R,L),lb=sub(B,L),ra=sub(A,R);
            D n=cross(lr,lb),m=cross(scale(lr,-1),ra);
            if(dot(n,left)<=0||dot(m,right)<=0)continue;
            double next=std::min(shape(n,lr,lb),shape(m,scale(lr,-1),ra));
            if(next<previous*1.35)continue;
            bool exists=false;
            for(U e=rings.head[l];e!=none;e=rings.next[e]){
                if(t[nextCorner(e)]==r){exists=true;break;}
            }
            if(exists)continue;
            double h=dot(left,sub(R,A)),offset=h*h/(ll*field.pitch*field.pitch);
            if(offset>1.e-12){
                if(!curved||offset>.025*.025||!field.grid||
                    !field.fits(scale(add(L,R),.5),n,.04)||
                    !field.fits(scale(add(add(L,R),B),1./3),n,.04)||
                    !field.fits(scale(add(add(L,R),A),1./3),m,.04))continue;
            }
            t[c]=l;t[nextCorner(c)]=r;t[prevCorner(c)]=b;
            t[mate]=r;t[nextCorner(mate)]=l;t[prevCorner(mate)]=a;
            used[a]=used[b]=used[l]=used[r]=1;++changed;
        }
        if(changed==before)break;
    }
    return changed;
}

#include "unite-regions.h"
}
API unsigned refine_contour(Surface* s,const Volume* volume,double ox,double oy,double oz,double pitch,unsigned percent,U* regionCounts){
    if(regionCounts)regionCounts[0]=regionCounts[1]=0;
    if(s->indices.empty())return 0;
    using namespace unite_surface;
    auto& p=s->vertices.points;auto& t=s->indices;
    if(!s->referenceFaces)s->referenceFaces=U(t.size()/3);
    Reference field{volume?&volume->field():nullptr,{ox,oy,oz},pitch};
    unsigned removed,planar;
    {
        RegionMesher regions(p,t,field,percent);
        regions.simplifyPlanes();planar=regions.planarRemoved;
    }
    {
        Rings ring(p.size(),t);Features features(p,t);
        removed=optimize(p,t,ring,features,field,percent);
    }
    {
        RegionMesher regions(p,t,field,percent);
        regions.build();
        if(regionCounts){regionCounts[0]=planar+regions.planarRemoved;regionCounts[1]=regions.stripRemoved;}
    }
    improveDiagonals(p,t,field,percent>0);
    return removed;
}
