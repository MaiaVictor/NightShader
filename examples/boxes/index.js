var Geom = require("dattata/geometries.js");
var NightShade = require("./../../NightShader.js");

function rnd(){
  return Math.random()*2-1;
};

function now(){
  return Date.now()/1000;
};

var GW = 256;
var GH = 256;
var GD = 64;
var SW = 256;
var SH = 256;
var render = NightShade({x:GW, y:GH, z:GD}, {x:SW, y:SH});
var lastMark = Date.now();
var ticks = 0;
window.requestAnimationFrame(function R(){
  var t = now() * Math.PI*2;
  var F = Math.floor;
  var S = Math.sin;
  var C = Math.cos;
  var canvas = render(
    function(atom){
      // Floor
      Geom.box(64, 64, 4)(function paint(x,y,z,nx,ny,nz){
        atom(x+GW/2, y+GH/2, z+4, nx, ny, nz, 196, 222, 158, 0);
      }, 0);
      // Wall
      Geom.box(64, 4, 32)(function paint(x,y,z,nx,ny,nz){
        atom(x+GW/2, y-64, z+GD/2, nx, ny, nz, 231, 239, 255, 0);
      }, 0);
      // Pillar
      Geom.box(16, 16, 28+C(t)*4)(function paint(x,y,z,nx,ny,nz){
        var l 
          = (C((z+32)/64*32-t*3)*0.5+0.5)*0.25
          + (C((z+32)/64*8-t*1)*0.5+0.5)*0.25
          + (C((x+16)/16*16-t*2)*0.5+0.5)*0.25
          + (C((y+16)/16*16-t*2)*0.5+0.5)*0.25;
        atom(x+GW/2, y+GH/2, z+GD/2, nx, ny, nz, 255*l, 255*l, 255*l, 0);
      }, 0);
      // Cubes
      Geom.box(8, 8, 3)(function paint(x,y,z,nx,ny,nz){
        atom(GW/2+C(t/4+0.0)*48+x, GH/2+S(t/4+0.0)*48+y, z+12, nx, ny, nz, 250, 0, 0, 255);
        atom(GW/2+C(t/4+2.1)*48+x, GH/2+S(t/4+2.1)*48+y, z+12, nx, ny, nz, 0, 250, 0, 255);
        atom(GW/2+C(t/4+4.2)*48+x, GH/2+S(t/4+4.2)*48+y, z+12, nx, ny, nz, 0, 0, 250, 255);
      }, 0);
    }, function(light){
      light(100+80*C(-t/4), 100+80*S(-t/4), 48, 100);
    },
    [0.4]);
  //canvas.style = "border: none;";
  document.body.appendChild(canvas);
  if (Date.now() - lastMark > 1000){
    console.log(ticks);
    lastMark = Date.now(), ticks = 0;
  } else ++ticks;
  window.requestAnimationFrame(R);
});
