// Vector3, Vector3 -> AtomFnlist, LightFnList -> *Canvas
// 
//   type AtomFnList = 
//     x  : Number (0..255),
//     y  : Number (0..255),
//     z  : Number (0..255),
//     nx : Number (-1..1), -- normal
//     ny : Number (-1..1), -- normal
//     nz : Number (-1..1), -- normal
//     r  : Number (0~255), -- red
//     g  : Number (0~255), -- green
//     b  : Number (0~255), -- green
//     a  : Number (0~255)  -- blue
//     -> IO ()
//   
// type LightFnList = 
//    x : Number (0..255),
//    y : Number (0..255),
//    z : Number (0..255),
//    s : Number (0..255) -- strength
//    -> IO ()
//
// An `FnList` is a list defined by a function
// that calls a callback in all listed values.
// For ex., this is an AtomFnList with 3 atoms,
// positioned on the unit vectors of the XYZ
// axis, with normals pointing to the axis,
// and colored red, green and blue:
// var atoms = function(atom){
//   atom(1,0,0, 1,0,0, 255,0,0,255);
//   atom(0,1,0, 0,1,0, 0,255,0,255);
//   atom(0,0,1, 0,0,1, 0,0,255,255);
// };
// 
// NightShade works by receiving a gridSize (the 
// quantization of the space), a screenSize (the
// resulting canvas size), an atoms list, a list
// of lights, and returns the rendered result as
// a canvas. It is a pure function. The returned
// canvas is modified on later calls, though.
//
// You're supposed to call it once with the size
// values, and then call the returned functions
// for each render frame. I.e.,
//
//   var render = NightShade(gridSize, screenSize);
//   document.body.appendChild(render(...));
//
module.exports = function NightShade(gridSize, screenSize){
  var monkeys = require("WebMonkeys")();
  var maxAtoms = 512*512;
  var maxLights = 4;
  var gridBuffer = new Uint32Array(gridSize.x*gridSize.y*gridSize.z);
  var screenBuffer = new Uint32Array(screenSize.x*screenSize.y);
  var atomsBuffer = new Uint32Array(maxAtoms);
  var lightsBuffer = new Uint32Array(maxLights);
  var gw = gridSize.x, gh = gridSize.h, gd = gridSize.d;
  monkeys.set("grid", gridBuffer);
  monkeys.set("screen", screenBuffer);
  monkeys.lib(`
    const vec3 gridSize = vec3(${gridSize.x},${gridSize.y},${gridSize.z});
    int gridIndex(vec3 pos){
      pos = floor(pos*1.0);
      return int(pos.z*gridSize.y*gridSize.x + pos.y*gridSize.x + pos.x);
    }
    float squaredDistance(vec3 a, vec3 b){
      return dot(a-b, a-b);
    }
    bool march(vec3 pos, vec3 light){
      vec3 dir = normalize(light - pos);
      for (int i=0; i<256; ++i){
        pos += dir;
        if (grid(gridIndex(pos)) != vec4(0.0))
          return false;
        if (squaredDistance(pos, light) < 4.0)
          return true;
        if ( pos.x < 0.0 || pos.x > gridSize.x
          || pos.y < 0.0 || pos.y > gridSize.y
          || pos.z < 0.0 || pos.z > gridSize.z)
          return true;
      };
      return false;
    }
    vec3 unpackNormal(float n){
      return vec3(
        mod(floor(n/ 1.0), 4.0) - 1.0,
        mod(floor(n/ 4.0), 4.0) - 1.0,
        mod(floor(n/16.0), 4.0) - 1.0);
    }
    vec3 unpackUnitVector(float sqrtBase, float e){
      float u = mod(e, sqrtBase) / sqrtBase;
      float v = floor(e / sqrtBase) / sqrtBase;
      float fx = u*4.0-2.0;
      float fy = v*4.0-2.0;
      float f = fx*fx + fy*fy;
      float g = sqrt(abs(1.0-f/4.0));
      return vec3(fx*g, fy*g, 1.0-f/2.0);
    }
  `);
  return function render(withAtoms, withLights, baseLight){
    var atomsCount = lightsCount = 0;

    withAtoms(function(x,y,z,nx,ny,nz,r,g,b,a){
      // Compacts normal to 1 byte
      // Adapted from Method #4 of
      // http://aras-p.info/texts/CompactNormalStorage.html
      var f = Math.sqrt(8*nz+8);
      var u = (nx/f+0.5)||0.5;
      var v = (ny/f+0.5)||1;
      var n = Math.round(u*16) + Math.round(v*16)*16;
      // Adds atom to buffer using 8 bytes
      atomsBuffer[atomsCount++] = (x<<0) + (y<<8) + (z<<16) + (n<<24);
      atomsBuffer[atomsCount++] = (r<<0) + (g<<8) + (b<<16) + (a<<24);
    });
    withLights(function(x,y,z,s){
      // Adds light to buffer usign 4 bytes
      lightsBuffer[lightsCount++] = (x<<0) + (y<<8) + (z<<16) + (s<<24);
    });

    monkeys.set("atoms", atomsBuffer);
    monkeys.set("lights", lightsBuffer);
    monkeys.set("baseLight", [baseLight]);
    monkeys.work(atomsCount, `
      vec4 atom = atoms(i*2);
      grid(gridIndex(atom.xyz)) := atom;
    `);
    monkeys.clear("screen", 0);
    monkeys.work(atomsCount, `
      vec4 atomPos = atoms(i*2+0);
      vec4 atomCol = atoms(i*2+1);
      float lum = baseLight(0);
      for (int i=0; i<${maxLights}; ++i){
        vec4 light = lights(i);
        if (light == vec4(0.0)) continue;
        vec3 norm = unpackUnitVector(16.0, atomPos.w);
        vec3 pos = atomPos.xyz + vec3(0.5) + norm*0.5;
        float lightEffect = max(dot(norm, normalize(light.xyz-pos)), 0.0);
        float lightStrength = light.w * light.w;
        if (lightEffect > 0.0)
          if (march(pos, light.xyz))
            lum += (1.0-distance(pos,light.xyz)/lightStrength) * lightEffect * 0.6;
      };
      vec3 color = atomCol.xyz*lum;
      vec3 screenPos = floor(vec3(atomPos.x-atomPos.z, atomPos.y+atomPos.z, atomPos.z));
      int screenIndex = int(screenPos.y * ${screenSize.y.toFixed(1)} + screenPos.x);
      screen(screenIndex, int(atomPos.z)) := vec4(color, 255.0);
    `);
    monkeys.work(atomsCount, `
      vec4 atomPos = atoms(i*2+0);
      grid(gridIndex(atomPos.xyz)) := vec4(0.0);
    `);
    for (var i=0; i<atomsCount; ++i){
      atomsBuffer[i*2+0] = 0;
      atomsBuffer[i*2+1] = 0;
      lightsBuffer[i*2+0] = 0;
    };
    return monkeys.render("screen", screenSize.x, screenSize.y);
  }
};
