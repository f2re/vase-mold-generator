// Original demonstration shapes, MIT, Vase Mold Generator contributors.
// OpenSCAD -D 'example="medallion"' -o medallion.stl examples.scad
example="medallion";
if(example=="medallion") {
  union() {
    linear_extrude(6) hull() { translate([-19,0]) circle(r=13,$fn=48);translate([19,0]) circle(r=13,$fn=48); }
    translate([-15,-3,5.8]) cube([30,6,3]);
    translate([-3,-9,5.8]) cube([6,18,3]);
  }
} else if(example=="capsule") {
  hull() {translate([0,0,12]) sphere(r=12,$fn=32);translate([0,0,40]) sphere(r=12,$fn=32);}
} else if(example=="ring") {
  rotate_extrude($fn=48) translate([23,0]) circle(r=6,$fn=20);
}
