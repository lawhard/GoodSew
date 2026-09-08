"""Generate independent fixtures: pip install pyembroidery==1.5.1."""
from pathlib import Path
from pyembroidery import EmbPattern, EmbThread, STITCH, JUMP, TRIM, COLOR_CHANGE, END
root=Path(__file__).parent/'fixtures'
p=EmbPattern()
for color,name in [('#183a62','Ocean navy'),('#b95731','Burnt copper'),('#358675','Sea glass')]:
    t=EmbThread();t.color=int(color[1:],16);t.description=name;t.brand='Reference threads';t.catalog_number=name[:3];p.add_thread(t)
p.add_stitch_absolute(JUMP,-300,-200)
for x,y in [(-300,-200),(-200,-100),(-100,-200),(0,-100),(100,-200)]:p.add_stitch_absolute(STITCH,x,y)
p.add_stitch_absolute(TRIM,100,-200)
p.add_stitch_absolute(COLOR_CHANGE,100,-200)
p.add_stitch_absolute(JUMP,200,100)
for x,y in [(200,100),(200,200),(100,200),(100,100),(200,100)]:p.add_stitch_absolute(STITCH,x,y)
p.add_stitch_absolute(COLOR_CHANGE,200,100)
p.add_stitch_absolute(JUMP,-200,100)
for x,y in [(-200,100),(-200,200),(-100,150)]:p.add_stitch_absolute(STITCH,x,y)
p.add_stitch_absolute(END,-100,150)
for version in (1,6):
    EmbPattern.write_pes(p,str(root/f'independent-v{version}.pes'),{'version':version})
