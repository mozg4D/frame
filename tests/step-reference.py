"""Independent Open CASCADE oracle. Development-only; never used by Frame."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / '.step-reference'))
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE
from OCP.TopoDS import TopoDS
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepTools import BRepTools
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.TopAbs import TopAbs_IN, TopAbs_ON
from OCP.gp import gp_Pnt2d

root=Path(__file__).parent/'scenes'/'step'
if '--fixtures' in sys.argv:
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeBox, BRepPrimAPI_MakeTorus
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
    from OCP.TColgp import TColgp_Array2OfPnt
    from OCP.gp import gp_Pnt
    from OCP.Geom import Geom_BezierSurface
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    def save(shape, name):
        writer=STEPControl_Writer();writer.Transfer(shape,STEPControl_AsIs)
        if writer.Write(str(root/name))!=IFSelect_RetDone: raise ValueError(name)
    save(BRepAlgoAPI_Cut(BRepPrimAPI_MakeCylinder(30,6).Shape(),BRepPrimAPI_MakeCylinder(10,6).Shape()).Shape(),'washer.step')
    controls=TColgp_Array2OfPnt(1,4,1,4)
    for i in range(1,5):
        for j in range(1,5): controls.SetValue(i,j,gp_Pnt((i-1)*10,(j-1)*10,10 if i in (2,3) and j in (2,3) else 0))
    save(BRepBuilderAPI_MakeFace(Geom_BezierSurface(controls),1e-7).Face(),'interior-bulge.step')
    builder=BRep_Builder();mixed=TopoDS_Compound();builder.MakeCompound(mixed)
    builder.Add(mixed,BRepPrimAPI_MakeBox(gp_Pnt(60,0,0),10,10,10).Shape())
    builder.Add(mixed,BRepPrimAPI_MakeTorus(30,8).Shape())
    save(mixed,'mixed.step')
    sys.exit(0)
out=[]
for f in json.loads((root/'sources.json').read_text()):
    if f.get('expected')=='reject': continue
    reader=STEPControl_Reader()
    if reader.ReadFile(str(root/f['name']))!=IFSelect_RetDone: raise ValueError(f['name'])
    reader.TransferRoots();shape=reader.OneShape();box=Bnd_Box();BRepBndLib.AddOptimal_s(shape,box)
    props=GProp_GProps();BRepGProp.VolumeProperties_s(shape,props)
    samples=[];types=[];ex=TopExp_Explorer(shape,TopAbs_FACE)
    while ex.More():
        face=TopoDS.Face_s(ex.Current());surface=BRepAdaptor_Surface(face);types.append(str(surface.GetType()));u0,u1,v0,v1=BRepTools.UVBounds_s(face)
        for i in range(1,16):
            for j in range(1,16):
                u=u0+(u1-u0)*i/16;v=v0+(v1-v0)*j/16
                if BRepClass_FaceClassifier(face,gp_Pnt2d(u,v),1e-7).State() not in (TopAbs_IN,TopAbs_ON): continue
                p=surface.Value(u,v);samples.append([p.X(),p.Z(),-p.Y()])
        ex.Next()
    b=box.Get();out.append(dict(name=f['name'],sourceSHA256=f['sha256'],volume=props.Mass(),bounds=dict(min=[b[0],b[2],-b[4]],max=[b[3],b[5],-b[1]]),samples=samples,surfaces=types))
    print(f['name'],len(types),props.Mass(),flush=True)
(root/'reference.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
