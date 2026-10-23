"""Refresh independent DXF geometry references with ezdxf 1.4.5 (test tooling only).

Run from the repository root: python tests/dxf-reference.py
The browser suite consumes the saved JSON and does not need Python or ezdxf.
"""
from pathlib import Path
import json, hashlib, gzip
import ezdxf
from ezdxf import disassemble
from ezdxf.math import Matrix44
from ezdxf.render import MeshBuilder

root=Path(__file__).parent/'scenes/dxf'

def generated():
 d=ezdxf.new('R2013');d.units=4;m=d.modelspace()
 m.add_line((1,2,3),(4,6,8),dxfattribs={'extrusion':(1,2,3)})
 m.add_circle((3,5,2),7,dxfattribs={'extrusion':(1,2,3)})
 m.add_arc((5,6,2),4,320,35,dxfattribs={'extrusion':(0,0,-1)})
 m.add_ellipse((7,8,9),(3,1,2),.4,.3,5.7,dxfattribs={'extrusion':(-2,1,2.5)})
 m.add_lwpolyline([(0,0,.5),(8,0,-.8),(8,5,0),(0,5,0)],format='xyb',close=True,dxfattribs={'elevation':4,'extrusion':(1,1,1)})
 m.add_polyline2d([(0,0),(5,0),(5,5)],dxfattribs={'elevation':(0,0,9),'extrusion':(0,1,0)})
 m.add_polyline3d([(1,2,3),(5,7,11),(13,17,19)],close=True)
 m.add_rational_spline([(0,0,0),(3,8,2),(6,-4,5),(10,1,3)],[1,2,.3,1],degree=3)
 m.add_spline_control_frame([(0,0,0),(1,5,1),(4,-3,7),(7,4,-2),(10,0,3),(15,5,8)],degree=5)
 d.saveas(root/'curves-generated.dxf')
 # Nonzero block origins, nested anisotropic/reflected transforms, OCS and MINSERT.
 d=ezdxf.new('R2013');d.units=1;m=d.modelspace();d.layers.new('Inherited');d.layers.new('Hidden',dxfattribs={'color':-3})
 b=d.blocks.new('inner',base_point=(2,3,4));b.add_circle((5,4,3),2);b.add_line((2,3,4),(7,8,9))
 b=d.blocks.new('outer',base_point=(3,1,2));b.add_blockref('inner',(7,8,9),dxfattribs={'xscale':2,'yscale':.5,'zscale':1.3,'rotation':37})
 m.add_blockref('outer',(9,10,11),dxfattribs={'layer':'Inherited','xscale':-1.5,'yscale':2,'zscale':.7,'rotation':23,'extrusion':(1,2,3),'row_count':2,'column_count':3,'row_spacing':30,'column_spacing':20})
 m.add_line((1,1,1),(2,2,2),dxfattribs={'layer':'Hidden'})
 m.add_line((2,1,1),(3,2,2),dxfattribs={'invisible':1})
 d.saveas(root/'blocks-generated.dxf')
 d=ezdxf.new('R2013');m=d.modelspace();d.units=4
 m.add_3dface([(0,0,0),(5,0,0),(5,5,0),(0,5,0)])
 m.add_solid([(10,0,0),(15,0,0),(10,5,0),(15,5,0)])
 mesh=m.add_mesh()
 with mesh.edit_data() as edit:
  edit.vertices=[(0,0,10),(4,0,10),(4,4,10),(2,2,10),(0,4,10)]
  edit.faces=[(0,1,2,3,4)]
 p=m.add_polyface();p.append_faces([[(0,0,20),(3,0,20),(3,3,20),(0,3,20)]])
 grid=m.add_polymesh((3,3))
 for i in range(3):
  for j in range(3):grid.set_mesh_vertex((i,j),(i*3,j*3,25+i+j))
 d.saveas(root/'meshes-generated.dxf')
 # Fit-only splines use CAD chord parametrization and natural boundary conditions.
 d=ezdxf.new('R2013');d.units=4;m=d.modelspace()
 m.add_spline([(0,0,0),(3,8,2),(8,-2,6),(12,4,0)])
 m.add_spline([(0,10,0),(3,18,2),(8,8,6),(12,14,0)],dxfattribs={'start_tangent':(1,2,0),'end_tangent':(2,-1,1)})
 d.saveas(root/'fit-generated.dxf')
 d=ezdxf.new('R2013');d.units=4;m=d.modelspace();d.layers.new('Binary_Контур')
 e=m.add_line((1,2,3),(4,5,6),dxfattribs={'layer':'Binary_Контур','true_color':0x123456,'color_name':'Named color','transparency':0x02000080})
 d.appids.new('FRAME_TEST');e.set_xdata('FRAME_TEST',[(1000,'metadata'),(1070,123),(1040,1.25),(1004,b'\x00\xff\x01'),(1071,1234567)])
 d.saveas(root/'modern-binary-generated.dxf',fmt='bin')
 for version,encoding in [('R2000','cp1251'),('R2013','utf-8')]:
  d=ezdxf.new(version);d.encoding=encoding;d.layers.new('Контур_\\U+03A9');m=d.modelspace();m.add_circle((1,2),3,dxfattribs={'layer':'Контур_\\U+03A9'})
  d.saveas(root/('unicode-'+version+'.dxf'),encoding=encoding)
 d=ezdxf.new('R2013');d.units=4;m=d.modelspace()
 for i in range(12000):m.add_line((i%120*2,i//120*2,0),(i%120*2+1,i//120*2+1,0))
 d.saveas(root/'large-generated.dxf')

def reference(filename):
 d=ezdxf.readfile(root/filename);scale=ezdxf.units.conversion_factor(d.units or 4,4);lines=[];faces=[];counts={};errors=[]
 transform=Matrix44()
 def xyz(v):
  v=transform.transform(v)
  return [v.x*scale,v.z*scale,-v.y*scale]
 def emit(vertices):
  vertices=[xyz(v) for v in vertices]
  lines.extend([[a,b] for a,b in zip(vertices,vertices[1:]) if a!=b])
 def curve(e):
  t=e.dxftype()
  if t=='LINE':emit([e.dxf.start,e.dxf.end])
  elif t in ['CIRCLE','ARC','ELLIPSE']:emit(e.flattening(.0005/scale))
  elif t=='SPLINE':emit(e.construction_tool().flattening(.0005/scale,segments=8))
  elif t in ['LWPOLYLINE','POLYLINE']:
   for v in e.virtual_entities():curve(v)
 # Analytic sampling uses ezdxf's source entity constructors.
 # Keep complete affine matrices. recursive_decompose() reconstructs nested
 # INSERT TRS and loses shear under rotated nonuniform ancestors.
 def walk(entities,matrix):
  for entity in entities:
   if entity.dxftype()=='INSERT':
    for occurrence in entity.multi_insert() if entity.mcount>1 else [entity]:
     yield from walk(occurrence.block(),occurrence.matrix44()@matrix)
   elif entity.dxftype()=='DIMENSION':yield from walk(entity.virtual_entities(),matrix)
   else:yield entity,matrix
 for e,transform in walk(d.modelspace(),Matrix44()):
  t=e.dxftype();counts[t]=counts.get(t,0)+1
  if e.dxf.get('paperspace',0):continue
  try:
   if t in ['LINE','CIRCLE','ARC','ELLIPSE','LWPOLYLINE','SPLINE'] or t=='POLYLINE' and (e.is_2d_polyline or e.is_3d_polyline):
    curve(e)
   elif t=='HATCH':
    from ezdxf.entities.boundary_paths import PolylinePath,LineEdge,ArcEdge,EllipseEdge,SplineEdge
    from ezdxf.math import Vec3
    ocs=e.ocs();elevation=e.dxf.elevation.z
    for boundary in e.paths:
     if isinstance(boundary,PolylinePath):
      # A virtual source entity lets ezdxf resolve bulges analytically.
      temp=ezdxf.new().modelspace().add_lwpolyline(boundary.vertices,format='xyb',close=boundary.is_closed,dxfattribs={'elevation':elevation,'extrusion':e.dxf.extrusion})
      curve(temp)
     else:
      for edge in boundary.edges:
       if isinstance(edge,LineEdge):pts=[Vec3(edge.start),Vec3(edge.end)]
       elif isinstance(edge,(ArcEdge,EllipseEdge)):pts=list(edge.construction_tool().flattening(.0005/scale))
       elif isinstance(edge,SplineEdge):pts=list(edge.construction_tool().flattening(.0005/scale,segments=8))
       emit([ocs.to_wcs(Vec3(p.x,p.y,elevation)) for p in pts])
   if t in ['3DFACE','SOLID','TRACE','MESH'] or t=='POLYLINE' and not (e.is_2d_polyline or e.is_3d_polyline):
    if t in ['3DFACE','SOLID','TRACE']:
     mesh=MeshBuilder();mesh.add_face(list(e.wcs_vertices()))
    else:mesh=disassemble.make_primitive(e).mesh
    if mesh:faces.extend([[xyz(v) for v in f] for f in mesh.tessellation(max_vertex_count=3)])
  except Exception as error:errors.append([t,str(error)])
 return {'sourceSHA256':hashlib.sha256((root/filename).read_bytes()).hexdigest(),'oracle':'ezdxf '+ezdxf.__version__,'scale':scale,'lines':lines,'faces':faces,'entities':counts,'errors':errors}

if __name__=='__main__':
 generated()
 manifest=json.loads((root/'sources.json').read_text())
 rejected={'bin_dxf_r2000.dxf','small_r14.dxf','visibility.dxf'}
 for f in manifest:
  f['expectedReject']=f['name'] in rejected
  if not f['expectedReject']:
   ref=reference(f['name']);(root/(f['name']+'.reference.json.gz')).write_bytes(gzip.compress(json.dumps(ref,separators=(',',':')).encode(),mtime=0))
 (root/'sources.json').write_text(json.dumps(manifest,indent=2)+'\n')
 for name in ['curves-generated','blocks-generated','meshes-generated','fit-generated','modern-binary-generated','unicode-R2000','unicode-R2013']:
  ref=reference(name+'.dxf');(root/(name+'.dxf.reference.json.gz')).write_bytes(gzip.compress(json.dumps(ref,separators=(',',':')).encode(),mtime=0))
 print('Reference corpus refreshed')
