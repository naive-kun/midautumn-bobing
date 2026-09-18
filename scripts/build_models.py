"""Run with Blender --background --factory-startup --python scripts/build_models.py.
Actual Blender modeling; exports Y-up glTF matching shared/geometry.js.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'models'
SOURCE = ROOT / 'blender'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, roughness=.28, metallic=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Roughness'].default_value=roughness
    bs.inputs['Metallic'].default_value=metallic
    bs.inputs['Coat Weight'].default_value=.3
    return m

ivory=material('warm_ivory_glaze',(.88,.87,.76),.21)
jade=material('deep_celadon',(.055,.19,.15),.23)
gold=material('brushed_gold',(.66,.43,.16),.3,.62)
red=material('cinnabar_pips',(.58,.055,.026),.26)
ink=material('ink_pips',(.025,.045,.035),.24)
die_mat=material('ivory_dice',(.96,.93,.83),.2)

def lathe(name, profile, mat, segments=128):
    verts=[]; faces=[]
    for r,h in profile:
        verts.extend((r*math.cos(i*2*math.pi/segments),r*math.sin(i*2*math.pi/segments),h) for i in range(segments))
    for j in range(len(profile)-1):
        for i in range(segments):
            a=j*segments+i; b=j*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    mesh=bpy.data.meshes.new(name+'_mesh'); mesh.from_pydata(verts,[],faces); mesh.update()
    obj=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for p in mesh.polygons:p.use_smooth=True
    bpy.context.view_layer.objects.active=obj; obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    return obj

inner=[(0,0),(2.35,0),(2.6,.16),(2.85,.55),(3.15,1.15),(3.5,1.85)]
rim=[(3.51,1.88),(3.55,1.905),(3.60,1.90),(3.64,1.87)]
outer=[(3.64,1.82),(3.28,1.07),(2.98,.43),(2.72,.025),(2.48,-.16),(2.2,-.22),(1.75,-.24),(0,-.24)]
bowl=lathe('Bobing_Bowl',inner+rim+outer,ivory)
# Outer enamel shares the ivory interior but has a darker green exterior.
bowl.data.materials.append(jade)
for p in bowl.data.polygons:
    if p.center.z < 0: pass
# Material slots by generating ring index, so interior stays light and readable.
for p in bowl.data.polygons:
    ring=p.index//128
    if ring>=len(inner)+len(rim)-1:p.material_index=1

def torus(name, radius, minor, height, mat):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius,minor_radius=minor,major_segments=128,minor_segments=8,location=(0,0,height))
    o=bpy.context.object;o.name=name;o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True
    o.select_set(False)
    return o

trim1=torus('Gilt_Rim',3.561,.018,1.903,gold)
trim2=torus('Inner_Celadon_Line',2.361,.012,.012,jade)
trim3=torus('Inner_Gilt_Line',2.30,.008,.006,gold)
foot=lathe('Foot_Ring',[(1.7,-.22),(1.7,-.34),(1.82,-.34),(1.84,-.22)],jade)

# Fine decorative olive leaves around the inner bottom, kept outside dice resting zone.
leaves=[]
for i in range(40):
    angle=i*2*math.pi/40
    r=2.18
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=1,location=(r*math.cos(angle),r*math.sin(angle),.005))
    o=bpy.context.object;o.name='Glaze_Leaf';o.scale=(.048,.115,.004);o.rotation_euler.z=angle-.4;o.data.materials.append(jade)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.select_set(False);leaves.append(o)

bowl_objects=[bowl,trim1,trim2,trim3,foot]+leaves
for o in bowl_objects:o.select_set(True)
bpy.context.view_layer.objects.active=bowl
bpy.ops.export_scene.gltf(filepath=str(OUT/'bowl.glb'),export_format='GLB',use_selection=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
bpy.ops.object.select_all(action='DESELECT')

# Dice centered at origin, round physical edges and shallow genuinely cut pip recesses.
bpy.ops.mesh.primitive_cube_add(size=.52,location=(0,0,0))
die=bpy.context.object;die.name='Bobing_Die';die.data.materials.append(die_mat)
bevel=die.modifiers.new('Rounded_edges','BEVEL');bevel.width=.025;bevel.segments=4
bpy.ops.object.modifier_apply(modifier=bevel.name)
for p in die.data.polygons:p.use_smooth=True
weighted=die.modifiers.new('Weighted_normals','WEIGHTED_NORMAL');weighted.keep_sharp=True
bpy.ops.object.modifier_apply(modifier=weighted.name)
die.select_set(False)

layouts={1:[(0,0)],2:[(-1,1),(1,-1)],3:[(-1,1),(0,0),(1,-1)],4:[(-1,-1),(-1,1),(1,-1),(1,1)],5:[(-1,-1),(-1,1),(0,0),(1,-1),(1,1)],6:[(-1,-1),(-1,0),(-1,1),(1,-1),(1,0),(1,1)]}
# Game axes (x,y,z) -> Blender axes (x,-z,y).
faces={1:Vector((0,0,1)),6:Vector((0,0,-1)),3:Vector((1,0,0)),4:Vector((-1,0,0)),2:Vector((0,-1,0)),5:Vector((0,1,0))}
cutters=[];pips=[]
for value,normal in faces.items():
    tangent=Vector((1,0,0)) if abs(normal.x)<.5 else Vector((0,1,0))
    bitangent=normal.cross(tangent)
    for a,b in layouts[value]:
        pos=tangent*(a*.125)+bitangent*(b*.125)
        bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.037,depth=.025,location=pos+normal*.259)
        cutter=bpy.context.object;cutter.rotation_mode='QUATERNION';cutter.rotation_quaternion=normal.to_track_quat('Z','Y');cutter.select_set(False);cutters.append(cutter)
        bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.0355,depth=.0015,location=pos+normal*.248)
        pip=bpy.context.object;pip.name='Pip_%d'%value;pip.rotation_mode='QUATERNION';pip.rotation_quaternion=normal.to_track_quat('Z','Y');pip.data.materials.append(red if value in (1,4) else ink);pip.select_set(False);pips.append(pip)
for o in cutters:o.select_set(True)
bpy.context.view_layer.objects.active=cutters[0];bpy.ops.object.join();cutter=bpy.context.object;cutter.name='Pip_Cutters';cutter.select_set(False)
die.select_set(True);bpy.context.view_layer.objects.active=die
boolean=die.modifiers.new('Recessed_pips','BOOLEAN');boolean.operation='DIFFERENCE';boolean.solver='EXACT';boolean.object=cutter
bpy.ops.object.modifier_apply(modifier=boolean.name)
bpy.data.objects.remove(cutter,do_unlink=True)
for o in pips:o.select_set(True)
bpy.context.view_layer.objects.active=die;bpy.ops.object.join();die=bpy.context.object
bpy.ops.export_scene.gltf(filepath=str(OUT/'die.glb'),export_format='GLB',use_selection=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)

# Assemble six dice for editable source and a composition preview.
die.location=(-.8,-.4,.3)
for i,(x,y) in enumerate([(.1,-.55),(.9,.0),(-.85,.6),(.05,.55),(.85,.85)]):
    copy=die.copy();copy.data=die.data.copy();bpy.context.collection.objects.link(copy);copy.name='Preview_Die_%d'%(i+2);copy.location=(x,y,.3);copy.rotation_euler=(0,0,.2*i)

table=material('walnut_table',(.095,.07,.045),.6)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.355));bpy.context.object.name='Preview_Table';bpy.context.object.data.materials.append(table)
bpy.ops.object.camera_add(location=(8,-10,13))
camera=bpy.context.object;camera.name='Preview_Camera';camera.rotation_euler=(Vector((0,0,.6))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=11.5;bpy.context.scene.camera=camera
for loc,energy,size in [((2,-5,11),1600,8),((-6,3,7),950,7)]:
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=energy;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
scene=bpy.context.scene;scene.name='MidAutumn_Bobing';scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world.color=(.4,.4,.4);scene.view_settings.view_transform='AgX'
scene.render.filepath=str(SOURCE/'model-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'midautumn-bobing.blend'))
bpy.ops.render.render(write_still=True)
(OUT/'manifest.json').write_text(json.dumps({'generator':'Blender '+bpy.app.version_string,'source':'blender/midautumn-bobing.blend','units':'meters','up':'Y','diceSize':.52,'diceFaces':{'+Y':1,'-Y':6,'+X':3,'-X':4,'+Z':2,'-Z':5},'bowlInnerProfile':inner,'assets':['bowl.glb','die.glb']},ensure_ascii=False,indent=2))
print('BOBING_MODEL_EXPORT_OK',OUT)
