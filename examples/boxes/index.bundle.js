(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

},{"WebMonkeys":3}],2:[function(require,module,exports){
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

},{"./../../NightShader.js":1,"dattata/geometries.js":4}],3:[function(require,module,exports){
load(this, function (exports) {
  function WebMonkeys(opt){
    var maxMonkeys,
      resultTextureSide,
      arrays,
      arrayByName,
      shaderByTask,
      monkeyIndexArray,
      gl,
      defaultLib,
      writer,
      renderer,
      resultTexture,
      userLib,
      framebuffer,
      rangebuffer,
      rendererVertexBuffer;

    // () -> Monkeys
    function init(){
      opt = opt || [];
      maxMonkeys = opt.maxMonkeys || 2048*2048;
      resultTextureSide = opt.resultTextureSide || 2048;
      arrays = [];
      arrayByName = {};
      shaderByTask = {};
      monkeyIndexArray = new Int32Array(maxMonkeys);

      var glOpt = {antialias: false, preserveDrawingBuffer: true};
      if (typeof window === "undefined"){
        gl = require("g"+"l")(1, 1, glOpt);
      } else {
        var canvas = document.createElement("canvas");
        gl = canvas.getContext("webgl", glOpt);
        gl.canvas = canvas;
        gl.canvas.width = 1;
        gl.canvas.height = 1;
        gl.canvas.style = [
          "image-rendering: optimizeSpeed;",
          "image-rendering: -moz-crisp-edges;",
          "image-rendering: -webkit-optimize-contrast;",
          "image-rendering: -o-crisp-edges;",
          "image-rendering: pixelated;",
          "-ms-interpolation-mode: nearest-neighbor;"].join("");
      }

      for (var i=0; i<maxMonkeys; ++i)
        monkeyIndexArray[i] = i; 

      defaultLib = [
        "vec2 indexToPos(vec2 size, float index){",
        "  return vec2(mod(index, size.x), floor(index/size.x));",
        "}",
        "float posToIndex(vec2 size, vec2 pos){",
        "  return pos.y*size.x + pos.x;",
        "}",
        "vec2 scaleRange(vec2 fromA, vec2 fromB, vec2 toA, vec2 toB, vec2 pos){",
        "  return toA+(pos-fromA)/(fromB-fromA)*(toB-toA);",
        "}",
        "vec4 packFloat(float x){",
        "  float s = x > 0.0 ? 1.0 : -1.0;",
        "  float e = floor(log2(s*x));",
        "  float m = s*x / pow(2.0, e);",
        "  return vec4(",
        "    floor(fract((m-1.0)*256.0*256.0)*256.0),",
        "    floor(fract((m-1.0)*256.0)*256.0),",
        "    floor(fract((m-1.0)*1.0)*256.0),",
        "    ((e+63.0) + (x>0.0?128.0:0.0)))/255.0;",
        "}",
        "float unpackFloat(vec4 v){",
        "  v *= 255.0;",
        "  float s = v.a >= 128.0 ? 1.0 : -1.0;",
        "  float e = v.a - (v.a >= 128.0 ? 128.0 : 0.0) - 63.0;",
        "  float m = 1.0 + v.x/256.0/256.0/256.0 + v.y/256.0/256.0 + v.z/256.0;",
        "  return s * pow(2.0, e) * m;",
        "}",
        "vec4 packVec4(vec4 v){",
        "  return v/255.0;",
        "}",
        "vec4 unpackVec4(vec4 v){",
        "  return v*255.0;",
        "}",
        "vec4 packIndexDepth(int a, int b){",
        "  float av = float(a);",
        "  float bv = float(b);",
        "  float x = mod(floor(av), 256.0);",
        "  float y = mod(floor(av/256.0), 256.0);",
        "  float z = mod(floor(av/256.0/256.0), 256.0);",
        "  float w = mod(floor(bv), 256.0);",
        "  return vec4(x,y,z,w)/255.0;",
        "}",
        "int unpackIndex(vec4 v){",
        "  return int(v.x*255.0 + v.y*255.0*256.0 + v.z*255.0*256.0*256.0);",
        "}",
        "int unpackDepth(vec4 v){",
        "  return int(v.w*255.0);",
        "}",
        ].join("\n");

      writer = buildShader(
        ["precision highp float;",
        "attribute float resultIndex;",
        "uniform sampler2D resultTexture;",
        "uniform float resultTextureSide;",
        "uniform float resultGridSide;",
        "uniform float resultSquareSide;",
        "uniform float targetTextureSide;",
        "varying vec4 value;",
        defaultLib,
        "void main(){",
        "  float resultSquareIndex = mod(resultIndex, resultSquareSide*resultSquareSide/2.0);", 
        "  vec2 resultSquareCoord = indexToPos(vec2(resultSquareSide/2.0,resultSquareSide), resultSquareIndex)*vec2(2.0,1.0);",
        "  vec2 resultGridCoord = indexToPos(vec2(resultGridSide), floor(resultIndex/(resultSquareSide*resultSquareSide/2.0)));",
        "  vec2 resultCoord = resultGridCoord * resultSquareSide + resultSquareCoord;",
        "  vec2 indexCoord = (resultCoord+vec2(0.5,0.5))/resultTextureSide;",
        "  vec2 valueCoord = (resultCoord+vec2(1.5,0.5))/resultTextureSide;",
        "  float index = float(unpackIndex(texture2D(resultTexture, indexCoord))-1);",
        "  float depth = float(unpackDepth(texture2D(resultTexture, indexCoord)));",
        "  value = texture2D(resultTexture, valueCoord);",
        "  vec2 rPos = (indexToPos(vec2(targetTextureSide),index)+vec2(0.5))/targetTextureSide*2.0-1.0;",
        "  gl_Position = vec4(depth > 0.5 ? rPos : vec2(-1.0,-1.0), (255.0-depth)/255.0, 1.0);",
        //"  gl_Position = vec4(rPos, -0.5, 1.0);",
        "  gl_PointSize = 1.0;",
        "}"].join("\n"),
        ["precision highp float;",
        "varying vec4 value;",
        "void main(){",
        "  gl_FragColor = value;",
        "}"].join("\n"));

      renderer = buildShader(
        ["precision highp float;",
        "attribute vec2 vertexPos;",
        "varying vec2 pos;",
        "void main(){",
        "  pos = vertexPos;",
        "  gl_Position = vec4(vertexPos, 0.0, 1.0);",
        "}"].join("\n"),
        ["precision mediump float;",
        "uniform sampler2D array;",
        "varying vec2 pos;",
        "void main(){",
        "  gl_FragColor = texture2D(array, pos*0.5+0.5);",
        //"  gl_FragColor = vec4(1.0, 0.5, 0.5, 1.0);",
        "}"].join("\n"));

      gl.clearDepth(256.0);

      rendererVertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, rendererVertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1,1,-1,-1,1,-1,1,1,-1,1,-1,-1]), gl.STATIC_DRAW);

      rangebuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, rangebuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(monkeyIndexArray), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      resultTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resultTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, resultTextureSide, resultTextureSide, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

      return monkeysApi;
    };

    // *Monkeys => String, String -> WebGLProgram
    function buildShader(vertexSrc, fragmentSrc){
      function compile(type, shaderSource){
        var shader = gl.createShader(type);
        gl.shaderSource(shader, shaderSource);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
          var errorMsg = "WebMonkeys had the following error from WebGL: " + gl.getShaderInfoLog(shader);
          if (errorMsg.indexOf("syntax error") !== -1)
            errorMsg += "This could be fixed by adding extra `;` before setters.";
          throw errorMsg;
        }
        return shader;
      }
      var vertexShader = compile(gl.VERTEX_SHADER, vertexSrc);
      var fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSrc);

      var shader = gl.createProgram();
      gl.attachShader(shader, vertexShader);
      gl.attachShader(shader, fragmentShader);
      gl.linkProgram(shader);
      if(!gl.getProgramParameter(shader, gl.LINK_STATUS))
        throw "Error linking shaders.";

      return shader;
    }

    // Number -> Number
    function fitTextureSide(elements){
      return Math.pow(2, Math.ceil(Math.log(Math.sqrt(elements))/Math.log(2)));
    };

    // Number -> Number
    function fract(x){ 
      return x - Math.floor(x);
    };

    // *Monkeys => String -> Maybe (Either (Array Number) *Uint32Array)
    function get(name){
      var array = arrayByName[name];
      if (!array) return null;
      var targetArray = array.uint32Array;
      var pixels = targetArray
        ? new Uint8Array(targetArray.buffer)  // re-uses existing buffer
        : new Uint8Array(array.textureSide*array.textureSide*4);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, array.texture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
      gl.readPixels(0, 0, array.textureSide, array.textureSide, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      if (!targetArray){
        var result = [];
        for (var i=0, l=array.length; i<l; ++i){
          var s = pixels[i*4+3] >= 128 ? 1 : -1;
          var e = pixels[i*4+3] - (pixels[i*4+3] >= 128 ? 128 : 0) - 63;
          var m = 1 + pixels[i*4+0]/256/256/256 + pixels[i*4+1]/256/256 + pixels[i*4+2]/256;
          var n = s * Math.pow(2, e) * m;
          var z = 0.000000000000000001; // to avoid annoying floating point error for 0
          result.push(-z < n && n < z ? 0 : n);
        };
        return result;
      } else {
        return targetArray;
      }
    };

    // *Monkeys => String, *Uint32Array -> Monkeys
    // *Monkeys => String, Array Number -> Monkeys
    // *Monkeys => String, Number -> Monkeys
    function set(name, lengthOrArray){
      if (typeof lengthOrArray === "number"){
        var length = lengthOrArray;
        var textureSide = fitTextureSide(length);
        var array = null;
      } else {
        var length = lengthOrArray.length;
        var textureSide = fitTextureSide(length);
        if (lengthOrArray instanceof Array) { // upload JS Numbers as Floats
          var array = new Uint8Array(textureSide*textureSide*4);
          for (var i=0, l=lengthOrArray.length; i<l; ++i){ 
            var x = lengthOrArray[i];
            var s = x > 0 ? 1 : -1;
            var e = Math.floor(Math.log2(s*x));
            var m = s*x/Math.pow(2, e);
            array[i*4+0] = Math.floor(fract((m-1)*256*256)*256)||0;
            array[i*4+1] = Math.floor(fract((m-1)*256)*256)||0;
            array[i*4+2] = Math.floor(fract((m-1)*1)*256)||0;
            array[i*4+3] = ((e+63) + (x>0?128:0))||0;
          };
        } else { // upload 32-bit Uints as Vec4s
          if (textureSide * textureSide !== length)
            throw "WebMonkey error: when on raw buffer mode, the length of your\n"
                + "buffer must be (2^n)^2 for a positive integer n. That is, it\n"
                + "could be 1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144\n"
                + "and so on. Your '"+name+"' buffer has length "+length+".";
          var array = new Uint8Array(lengthOrArray.buffer);
        }
      }
      gl.activeTexture(gl.TEXTURE0);
      if (!arrayByName[name]){
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureSide, textureSide, 0, gl.RGBA, gl.UNSIGNED_BYTE, array);
        var depthbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, textureSide, textureSide);
        arrayByName[name] = {
          name: name,
          uint32Array: lengthOrArray instanceof Uint32Array ? lengthOrArray : null,
          valueType: lengthOrArray instanceof Uint32Array ? "vec4" : "float",
          texture: texture,
          depthbuffer: depthbuffer,
          textureName: name+"_",
          textureSide: textureSide,
          length: length};
        arrays.push(arrayByName[name]);
      } else {
        var texture = arrayByName[name].texture;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureSide, textureSide, 0, gl.RGBA, gl.UNSIGNED_BYTE, array);
      }
      return monkeysApi;
    };

    // *Monkeys => String, Uint32 -> Monkeys
    function clear(name, value){
      var array = arrayByName[name];
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, array.texture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
      gl.clearColor(
        ((value&0x000000FF) >>>  0)/255,
        ((value&0x0000FF00) >>>  8)/255,
        ((value&0x00FF0000) >>> 16)/255,
        ((value&0xFF000000) >>> 24)/255);
      gl.clear(gl.COLOR_BUFFER_BIT)
      return monkeysApi;
    };

    // *Monkeys => String -> Monkeys
    function del(name){
      var existingArray;
      if (existingArray = arraysByName[name]){
        delete arraysByName[name];
        arrays = arrays.filter(function(arr){
          return arr !== existingArray;
        });
        gl.deleteTexture(existingArray.texture);
      };
      return monkeysApi;
    };

    // String -> Maybe {name: String, index: String, depth: String, value: String}
    //   Parses a setter statement such as `foo(i*8) := bar(i*8) + baz(i*8);` and
    //   returns `name`, `index`, `depth` and `value` strings:
    //   {name: "foo", index: "i*8", depth: "", value: "bar(i*8) + baz(i*8)"}
    function parseSetterStatement(statement){
      var name = "";
      var index = "";
      var depth = "";
      var value = "";
      var phase = 0;
      var brackets = 1;
      for (var i=0, l=statement.length; i < l; ++i){
        var chr = statement[i];
        switch (phase){
          case 0: 
            if (chr === "(")
              phase = 1;
            else if (chr !== " " && chr !== "\n")
              name += chr;
          break;
          case 1:
            if (chr === "(")
              ++brackets;
            else if (chr === ")")
              --brackets;
            if (brackets === 1 && chr === ",")
              phase = 2;
            else if (brackets === 0)
              phase = 3;
            else
              index += chr;
          break;
          case 2:
            if (chr === "(")
              ++brackets;
            else if (chr === ")")
              --brackets;
            if (brackets === 0)
              phase = 3;
            else
              depth += chr;
          break;
          case 3:
            if (chr === ":")
              phase = 4;
          break;
          case 4:
            if (chr === "=")
              phase = 5;
            else
              return null;
          break;
          case 5:
            if (chr !== " ")
              value += chr,
              phase = 6;
            break;
          case 6:
            if (chr === ";")
              phase = 7;
            else
              value += chr;
          break;
        };
      };
      return phase === 7 
        ? {name: name,
          index: index,
          depth: depth,
          value: value}
        : null;
    };

    // String -> {shader: GLShader, maxResults: Number, resultArrayName: String, usesDepth: Bool}
    function buildShaderForTask(task){
      if (shaderByTask[task]) 
        return shaderByTask[task];

      var usesDepth = false;
      var taskStatements = task.split(";");
      taskStatements.pop();
      var setters = [];
      var setter;
      while (setter = parseSetterStatement(taskStatements[taskStatements.length-1]+";")){
        setters.push(setter);
        taskStatements.pop();
        if (setter.depth !== "0")
          usesDepth = true;
      };
      if (setters.length === 0)
        throw "Error parsing Monkey task: tasks must end with a setter statement such as `foo[0] = 0;`.";
      var resultArrayName = setters[0].name;
      for (var i=1, l=setters.length; i<l; ++i)
        if (setters[i].name !== resultArrayName)
          throw "Error parsing Monkey task: you can't write to different arrays on the same task.";

      var taskWithoutSetters = taskStatements.join(";")+";";

      var usedResults = setters.length;
      var maxResults = Math.pow(fitTextureSide(usedResults*2),2)/2;

      var getters = "";
      for (var i=0, l=arrays.length; i<l; ++i)
        getters 
          += "uniform sampler2D "+arrays[i].textureName+";\n"
          +  arrays[i].valueType+" "+arrays[i].name+"(float idx){\n"
          +  "  return "+(arrays[i].valueType==="float"?"unpackFloat":"unpackVec4")+"(texture2D("+arrays[i].textureName+",indexToPos(vec2("+arrays[i].textureSide.toFixed(1)+"), idx)/"+arrays[i].textureSide.toFixed(2)+"));\n"
          +  "}\n"
          +  arrays[i].valueType+" "+arrays[i].name+"(int idx){\n"
          +  "  return "+arrays[i].name+"(float(idx));\n"
          +  "}\n";

      var setterFns = "";
      for (var i=0; i<maxResults; ++i){
        setterFns += "void set"+i+"(int i"+i+", int d"+i+", float v"+i+"){\n";
        setterFns += "  results["+(i*2+0)+"] = packIndexDepth(i"+i+"+1, d"+i+");\n"
        setterFns += "  results["+(i*2+1)+"] = packFloat(v"+i+");\n"
        setterFns += "}\n";
        setterFns += "void set"+i+"(int i"+i+", int d"+i+", vec4 v"+i+"){\n";
        setterFns += "  results["+(i*2+0)+"] = packIndexDepth(i"+i+"+1, d"+i+");\n"
        setterFns += "  results["+(i*2+1)+"] = packVec4(v"+i+");\n"
        setterFns += "}\n";
      };

      var writeToTexture = "";
      for (var i=0; i<maxResults*2; ++i)
        writeToTexture += "  if (idx == "+i+") gl_FragColor = results["+i+"];\n";

      var setter = "";
      for (var i=0; i < maxResults; ++i){
        setter += "  set"+i+"(";
        setter += i < usedResults
          ? setters[i].index+", "
            + (setters[i].depth||"1")+", "
            + setters[i].value
          : "0, 0, vec4(0.0)";
        setter += ");\n";
      };

      var vertexShader = [
        "precision highp float;",
        "uniform float resultTextureSide;",
        "uniform float resultGridSide;",
        "uniform float resultSquareSide;",
        "attribute float resultIndex;",
        "varying float resultIndexVar;",
        "varying vec4 results["+(maxResults*2)+"];",
        defaultLib,
        getters,
        setterFns,
        userLib,
        "vec4 scaleToScreen(vec2 pos){",
        "  vec2 screenCoord = scaleRange(vec2(0.0,0.0), vec2(resultGridSide), vec2(-1.0), vec2(-1.0+resultSquareSide*resultGridSide/resultTextureSide*2.0), pos);",
        "  return vec4(screenCoord + vec2(resultSquareSide)/resultTextureSide, 1.0, 1.0);",
        "}",
        "void main(){",
        "  int i = int(resultIndex);",
        "  float f = resultIndex;",
        taskWithoutSetters,
        setter,
        "  gl_PointSize = resultSquareSide;",
        "  gl_Position = scaleToScreen(indexToPos(vec2(resultGridSide), resultIndex));",
        "  resultIndexVar = resultIndex;",
        "}"].join("\n")

      var fragmentShader = [
        "precision highp float;",
        "varying float resultIndexVar;",
        "varying vec4 results["+(maxResults*2)+"];",
        "uniform float resultSquareSide;",
        defaultLib,
        "void main(){",
        "  vec2 coord = floor(gl_PointCoord * resultSquareSide);",
        "  int idx = int((resultSquareSide-1.0-coord.y) * resultSquareSide + coord.x);",
        writeToTexture,
        "}"].join("\n");
        
        var shader = buildShader(vertexShader, fragmentShader);

        return shaderByTask[task] = {
          usesDepth: usesDepth,
          shader: shader,
          maxResults: maxResults,
          resultArrayName: resultArrayName};
    };

    // *Monkeys => Number, String -> Monkeys
    function work(monkeyCount, task){
      var shaderObject = buildShaderForTask(task);
      var shader = shaderObject.shader;
      var maxResults = shaderObject.maxResults;
      var resultArrayName = shaderObject.resultArrayName;
      var usesDepth = shaderObject.usesDepth;

      var output = arrayByName[resultArrayName];

      var resultSquareSide = fitTextureSide(maxResults*2);
      var resultGridSide = fitTextureSide(monkeyCount);
      var usedResultTextureSide = resultGridSide * resultSquareSide;

      gl.useProgram(shader);
      gl.bindBuffer(gl.ARRAY_BUFFER, rangebuffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.uniform1f(gl.getUniformLocation(shader,"resultGridSide"), resultGridSide);
      gl.uniform1f(gl.getUniformLocation(shader,"resultSquareSide"), resultSquareSide);
      gl.uniform1f(gl.getUniformLocation(shader,"resultTextureSide"), resultTextureSide);
      gl.vertexAttribPointer(gl.getAttribLocation(shader,"resultIndex"), 1, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(gl.getAttribLocation(shader,"resultIndex"));
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resultTexture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
      gl.viewport(0, 0, resultTextureSide, resultTextureSide);
      for (var i=0, l=arrays.length; i<l; ++i){
        gl.activeTexture(gl.TEXTURE0+i);
        gl.bindTexture(gl.TEXTURE_2D, arrays[i].texture);
        gl.uniform1i(gl.getUniformLocation(shader,arrays[i].textureName), i);
      }
      gl.drawArrays(gl.POINTS, 0, monkeyCount);

      if (usesDepth) gl.enable(gl.DEPTH_TEST);
      gl.useProgram(writer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resultTexture);
      gl.uniform1i(gl.getUniformLocation(writer,"resultTexture"), resultTexture);
      gl.uniform1f(gl.getUniformLocation(writer,"resultGridSide"), resultGridSide);
      gl.uniform1f(gl.getUniformLocation(writer,"resultSquareSide"), resultSquareSide);
      gl.uniform1f(gl.getUniformLocation(writer,"resultTextureSide"), resultTextureSide);
      gl.uniform1f(gl.getUniformLocation(writer,"targetTextureSide"), output.textureSide);
      gl.vertexAttribPointer(gl.getAttribLocation(writer,"resultIndex"), 1, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(gl.getAttribLocation(writer,"resultIndex"));
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output.texture, 0);
      gl.viewport(0, 0, output.textureSide, output.textureSide);
      if (usesDepth){
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, output.depthbuffer);
        gl.clear(gl.DEPTH_BUFFER_BIT)
      };
      gl.drawArrays(gl.POINTS, 0, monkeyCount*resultSquareSide*resultSquareSide/2);
      if (usesDepth) gl.disable(gl.DEPTH_TEST);
      return monkeysApi;
    };

    // Allows rendering arrays to a Canvas for visualization
    // *Monkeys => String, Number, Number -> Maybe Canvas
    function render(name, width, height){
      if (gl.canvas && arrayByName[name]){
        gl.canvas.width = width;
        gl.canvas.height = height;
        gl.useProgram(renderer);
        gl.viewport(0, 0, width, height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, arrayByName[name].texture);

        gl.bindBuffer(gl.ARRAY_BUFFER, rendererVertexBuffer);
        var vertexPosAttr = gl.getAttribLocation(renderer, "vertexPos")
        gl.vertexAttribPointer(vertexPosAttr, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(vertexPosAttr);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return gl.canvas;
      }
      return null;
    };

    // *Monkeys => String -> Monkeys
    function lib(source){
      userLib = source;
      return monkeysApi;
    };

    // Monkeys => String -> String
    function stringify(name){
      return JSON.stringify(get(name));
    };

    // Monkeys => String -> IO ()
    function log(name){
      console.log(stringify(name))
    };

    var monkeysApi = {
      set: set,
      get: get,
      del: del,
      lib: lib,
      work: work,
      clear: clear,
      render: render,
      stringify: stringify,
      log: log
    };

    return init();
  }

  if (typeof window === 'object')
    exports.WebMonkeys = WebMonkeys;

  if (typeof module !== "undefined")
    module.exports = WebMonkeys;
});

function load(root, factory) {
  'use strict';

  // amd
  if (typeof define === 'function' && define.amd)
    // register as an anonymous module
    define([], factory);

  // commonjs
  else if (typeof exports === 'object' && typeof exports.nodeName !== 'string')
    factory(exports);

  // browser globals
  else
    factory(root);

}

},{}],4:[function(require,module,exports){
module.exports = (function(){
  // type AtomsCList = ∀ a . (#Vector3, #Vector3, a -> a), a -> a
  // Vector3 values are expanded (splat) on the callback function call
//   Example: box(8,8,8)(function(x,y,z,nx,ny,nz,init){ ... }, init);

  // Number, Number, Number, Number -> AtomsCList
  function sphere(cx, cy, cz, r){
    var sqrt = Math.sqrt;
    var round = Math.round;
    return function(cons, nil){
      for (var y = -r; y < r; ++y){
        var xl = round(sqrt(r*r - y*y));
        for (var x = -xl; x < xl; ++x){
          if (x*x + y*y < r*r){
            var z = round(sqrt(r*r - x*x - y*y));
            nil = cons(cx+x, cy+y, cz-z, nil);
            nil = cons(cx+x, cy+y, cz+z, nil);
          };
        };
      };
      return nil;
    };
  };

  // Number, Number, Number -> AtomsCList
  // Every grid position of the box with dimensions (w,h,d).
  function box(w, h, d){
    return function(cons, nil){
      function register(x, y, z){
        var nx = x === -w ? -1 : x === w ? 1 : 0;
        var ny = y === -h ? -1 : y === h ? 1 : 0;
        var nz = z === -d ? -1 : z === d ? 1 : 0;
        var nl = Math.sqrt(nx*nx+ny*ny+nz*nz);
        nil = cons(x, y, z, nx/nl, ny/nl, nz/nl);
      };
      for (var y=-h; y<=h; ++y)
        for (var x=-w; x<=w; ++x)
          register(x, y,  d),
          register(x, y, -d);
      for (var z=-d+1; z<d; ++z)
        for (var x=-w; x<=w; ++x)
          register(x,  h, z),
          register(x, -h, z);
      for (var z=-d+1; z<d; ++z)
        for (var y=-h+1; y<h; ++y)
          register( w, y, z),
          register(-w, y, z);
      return nil;
    };
  };

  // Number, Number, Number -> AtomsCList
  function block(w, h, d){
    return function(cons, nil){
      for (var z=-d; z<=d; ++z)
        for (var y=-h; y<=h; ++y)
          for (var x=-w; x<=w; ++x)
            nil = cons(x, y, z),
            nil = cons(x, y, z);
      return nil;
    };
  };


  // Number, Number, Number, Number, RGBA8 -> Voxels
  function sphereVoxels(cx, cy, cz, r, col){
    return function(cons, nil){
      sphere(cx, cy, cz, r)(function(x, y, z, res){
        return cons(x, y, z, col, res);
      }, nil);
    };
  };

  return {
    sphere: sphere,
    box: box,
    block: block,
    sphereVoxels: sphereVoxels};
})();

},{}]},{},[2])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy5udm0vdmVyc2lvbnMvbm9kZS92NS45LjEvbGliL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJOaWdodFNoYWRlci5qcyIsImV4YW1wbGVzL2JveGVzL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL1dlYk1vbmtleXMvc3JjL1dlYk1vbmtleXMuanMiLCJub2RlX21vZHVsZXMvZGF0dGF0YS9nZW9tZXRyaWVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdG9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8vIFZlY3RvcjMsIFZlY3RvcjMgLT4gQXRvbUZubGlzdCwgTGlnaHRGbkxpc3QgLT4gKkNhbnZhc1xuLy8gXG4vLyAgIHR5cGUgQXRvbUZuTGlzdCA9IFxuLy8gICAgIHggIDogTnVtYmVyICgwLi4yNTUpLFxuLy8gICAgIHkgIDogTnVtYmVyICgwLi4yNTUpLFxuLy8gICAgIHogIDogTnVtYmVyICgwLi4yNTUpLFxuLy8gICAgIG54IDogTnVtYmVyICgtMS4uMSksIC0tIG5vcm1hbFxuLy8gICAgIG55IDogTnVtYmVyICgtMS4uMSksIC0tIG5vcm1hbFxuLy8gICAgIG56IDogTnVtYmVyICgtMS4uMSksIC0tIG5vcm1hbFxuLy8gICAgIHIgIDogTnVtYmVyICgwfjI1NSksIC0tIHJlZFxuLy8gICAgIGcgIDogTnVtYmVyICgwfjI1NSksIC0tIGdyZWVuXG4vLyAgICAgYiAgOiBOdW1iZXIgKDB+MjU1KSwgLS0gZ3JlZW5cbi8vICAgICBhICA6IE51bWJlciAoMH4yNTUpICAtLSBibHVlXG4vLyAgICAgLT4gSU8gKClcbi8vICAgXG4vLyB0eXBlIExpZ2h0Rm5MaXN0ID0gXG4vLyAgICB4IDogTnVtYmVyICgwLi4yNTUpLFxuLy8gICAgeSA6IE51bWJlciAoMC4uMjU1KSxcbi8vICAgIHogOiBOdW1iZXIgKDAuLjI1NSksXG4vLyAgICBzIDogTnVtYmVyICgwLi4yNTUpIC0tIHN0cmVuZ3RoXG4vLyAgICAtPiBJTyAoKVxuLy9cbi8vIEFuIGBGbkxpc3RgIGlzIGEgbGlzdCBkZWZpbmVkIGJ5IGEgZnVuY3Rpb25cbi8vIHRoYXQgY2FsbHMgYSBjYWxsYmFjayBpbiBhbGwgbGlzdGVkIHZhbHVlcy5cbi8vIEZvciBleC4sIHRoaXMgaXMgYW4gQXRvbUZuTGlzdCB3aXRoIDMgYXRvbXMsXG4vLyBwb3NpdGlvbmVkIG9uIHRoZSB1bml0IHZlY3RvcnMgb2YgdGhlIFhZWlxuLy8gYXhpcywgd2l0aCBub3JtYWxzIHBvaW50aW5nIHRvIHRoZSBheGlzLFxuLy8gYW5kIGNvbG9yZWQgcmVkLCBncmVlbiBhbmQgYmx1ZTpcbi8vIHZhciBhdG9tcyA9IGZ1bmN0aW9uKGF0b20pe1xuLy8gICBhdG9tKDEsMCwwLCAxLDAsMCwgMjU1LDAsMCwyNTUpO1xuLy8gICBhdG9tKDAsMSwwLCAwLDEsMCwgMCwyNTUsMCwyNTUpO1xuLy8gICBhdG9tKDAsMCwxLCAwLDAsMSwgMCwwLDI1NSwyNTUpO1xuLy8gfTtcbi8vIFxuLy8gTmlnaHRTaGFkZSB3b3JrcyBieSByZWNlaXZpbmcgYSBncmlkU2l6ZSAodGhlIFxuLy8gcXVhbnRpemF0aW9uIG9mIHRoZSBzcGFjZSksIGEgc2NyZWVuU2l6ZSAodGhlXG4vLyByZXN1bHRpbmcgY2FudmFzIHNpemUpLCBhbiBhdG9tcyBsaXN0LCBhIGxpc3Rcbi8vIG9mIGxpZ2h0cywgYW5kIHJldHVybnMgdGhlIHJlbmRlcmVkIHJlc3VsdCBhc1xuLy8gYSBjYW52YXMuIEl0IGlzIGEgcHVyZSBmdW5jdGlvbi4gVGhlIHJldHVybmVkXG4vLyBjYW52YXMgaXMgbW9kaWZpZWQgb24gbGF0ZXIgY2FsbHMsIHRob3VnaC5cbi8vXG4vLyBZb3UncmUgc3VwcG9zZWQgdG8gY2FsbCBpdCBvbmNlIHdpdGggdGhlIHNpemVcbi8vIHZhbHVlcywgYW5kIHRoZW4gY2FsbCB0aGUgcmV0dXJuZWQgZnVuY3Rpb25zXG4vLyBmb3IgZWFjaCByZW5kZXIgZnJhbWUuIEkuZS4sXG4vL1xuLy8gICB2YXIgcmVuZGVyID0gTmlnaHRTaGFkZShncmlkU2l6ZSwgc2NyZWVuU2l6ZSk7XG4vLyAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQocmVuZGVyKC4uLikpO1xuLy9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gTmlnaHRTaGFkZShncmlkU2l6ZSwgc2NyZWVuU2l6ZSl7XG4gIHZhciBtb25rZXlzID0gcmVxdWlyZShcIldlYk1vbmtleXNcIikoKTtcbiAgdmFyIG1heEF0b21zID0gNTEyKjUxMjtcbiAgdmFyIG1heExpZ2h0cyA9IDQ7XG4gIHZhciBncmlkQnVmZmVyID0gbmV3IFVpbnQzMkFycmF5KGdyaWRTaXplLngqZ3JpZFNpemUueSpncmlkU2l6ZS56KTtcbiAgdmFyIHNjcmVlbkJ1ZmZlciA9IG5ldyBVaW50MzJBcnJheShzY3JlZW5TaXplLngqc2NyZWVuU2l6ZS55KTtcbiAgdmFyIGF0b21zQnVmZmVyID0gbmV3IFVpbnQzMkFycmF5KG1heEF0b21zKTtcbiAgdmFyIGxpZ2h0c0J1ZmZlciA9IG5ldyBVaW50MzJBcnJheShtYXhMaWdodHMpO1xuICB2YXIgZ3cgPSBncmlkU2l6ZS54LCBnaCA9IGdyaWRTaXplLmgsIGdkID0gZ3JpZFNpemUuZDtcbiAgbW9ua2V5cy5zZXQoXCJncmlkXCIsIGdyaWRCdWZmZXIpO1xuICBtb25rZXlzLnNldChcInNjcmVlblwiLCBzY3JlZW5CdWZmZXIpO1xuICBtb25rZXlzLmxpYihgXG4gICAgY29uc3QgdmVjMyBncmlkU2l6ZSA9IHZlYzMoJHtncmlkU2l6ZS54fSwke2dyaWRTaXplLnl9LCR7Z3JpZFNpemUuen0pO1xuICAgIGludCBncmlkSW5kZXgodmVjMyBwb3Mpe1xuICAgICAgcG9zID0gZmxvb3IocG9zKjEuMCk7XG4gICAgICByZXR1cm4gaW50KHBvcy56KmdyaWRTaXplLnkqZ3JpZFNpemUueCArIHBvcy55KmdyaWRTaXplLnggKyBwb3MueCk7XG4gICAgfVxuICAgIGZsb2F0IHNxdWFyZWREaXN0YW5jZSh2ZWMzIGEsIHZlYzMgYil7XG4gICAgICByZXR1cm4gZG90KGEtYiwgYS1iKTtcbiAgICB9XG4gICAgYm9vbCBtYXJjaCh2ZWMzIHBvcywgdmVjMyBsaWdodCl7XG4gICAgICB2ZWMzIGRpciA9IG5vcm1hbGl6ZShsaWdodCAtIHBvcyk7XG4gICAgICBmb3IgKGludCBpPTA7IGk8MjU2OyArK2kpe1xuICAgICAgICBwb3MgKz0gZGlyO1xuICAgICAgICBpZiAoZ3JpZChncmlkSW5kZXgocG9zKSkgIT0gdmVjNCgwLjApKVxuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgaWYgKHNxdWFyZWREaXN0YW5jZShwb3MsIGxpZ2h0KSA8IDQuMClcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgaWYgKCBwb3MueCA8IDAuMCB8fCBwb3MueCA+IGdyaWRTaXplLnhcbiAgICAgICAgICB8fCBwb3MueSA8IDAuMCB8fCBwb3MueSA+IGdyaWRTaXplLnlcbiAgICAgICAgICB8fCBwb3MueiA8IDAuMCB8fCBwb3MueiA+IGdyaWRTaXplLnopXG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9O1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICB2ZWMzIHVucGFja05vcm1hbChmbG9hdCBuKXtcbiAgICAgIHJldHVybiB2ZWMzKFxuICAgICAgICBtb2QoZmxvb3Iobi8gMS4wKSwgNC4wKSAtIDEuMCxcbiAgICAgICAgbW9kKGZsb29yKG4vIDQuMCksIDQuMCkgLSAxLjAsXG4gICAgICAgIG1vZChmbG9vcihuLzE2LjApLCA0LjApIC0gMS4wKTtcbiAgICB9XG4gICAgdmVjMyB1bnBhY2tVbml0VmVjdG9yKGZsb2F0IHNxcnRCYXNlLCBmbG9hdCBlKXtcbiAgICAgIGZsb2F0IHUgPSBtb2QoZSwgc3FydEJhc2UpIC8gc3FydEJhc2U7XG4gICAgICBmbG9hdCB2ID0gZmxvb3IoZSAvIHNxcnRCYXNlKSAvIHNxcnRCYXNlO1xuICAgICAgZmxvYXQgZnggPSB1KjQuMC0yLjA7XG4gICAgICBmbG9hdCBmeSA9IHYqNC4wLTIuMDtcbiAgICAgIGZsb2F0IGYgPSBmeCpmeCArIGZ5KmZ5O1xuICAgICAgZmxvYXQgZyA9IHNxcnQoYWJzKDEuMC1mLzQuMCkpO1xuICAgICAgcmV0dXJuIHZlYzMoZngqZywgZnkqZywgMS4wLWYvMi4wKTtcbiAgICB9XG4gIGApO1xuICByZXR1cm4gZnVuY3Rpb24gcmVuZGVyKHdpdGhBdG9tcywgd2l0aExpZ2h0cywgYmFzZUxpZ2h0KXtcbiAgICB2YXIgYXRvbXNDb3VudCA9IGxpZ2h0c0NvdW50ID0gMDtcblxuICAgIHdpdGhBdG9tcyhmdW5jdGlvbih4LHkseixueCxueSxueixyLGcsYixhKXtcbiAgICAgIC8vIENvbXBhY3RzIG5vcm1hbCB0byAxIGJ5dGVcbiAgICAgIC8vIEFkYXB0ZWQgZnJvbSBNZXRob2QgIzQgb2ZcbiAgICAgIC8vIGh0dHA6Ly9hcmFzLXAuaW5mby90ZXh0cy9Db21wYWN0Tm9ybWFsU3RvcmFnZS5odG1sXG4gICAgICB2YXIgZiA9IE1hdGguc3FydCg4Km56KzgpO1xuICAgICAgdmFyIHUgPSAobngvZiswLjUpfHwwLjU7XG4gICAgICB2YXIgdiA9IChueS9mKzAuNSl8fDE7XG4gICAgICB2YXIgbiA9IE1hdGgucm91bmQodSoxNikgKyBNYXRoLnJvdW5kKHYqMTYpKjE2O1xuICAgICAgLy8gQWRkcyBhdG9tIHRvIGJ1ZmZlciB1c2luZyA4IGJ5dGVzXG4gICAgICBhdG9tc0J1ZmZlclthdG9tc0NvdW50KytdID0gKHg8PDApICsgKHk8PDgpICsgKHo8PDE2KSArIChuPDwyNCk7XG4gICAgICBhdG9tc0J1ZmZlclthdG9tc0NvdW50KytdID0gKHI8PDApICsgKGc8PDgpICsgKGI8PDE2KSArIChhPDwyNCk7XG4gICAgfSk7XG4gICAgd2l0aExpZ2h0cyhmdW5jdGlvbih4LHkseixzKXtcbiAgICAgIC8vIEFkZHMgbGlnaHQgdG8gYnVmZmVyIHVzaWduIDQgYnl0ZXNcbiAgICAgIGxpZ2h0c0J1ZmZlcltsaWdodHNDb3VudCsrXSA9ICh4PDwwKSArICh5PDw4KSArICh6PDwxNikgKyAoczw8MjQpO1xuICAgIH0pO1xuXG4gICAgbW9ua2V5cy5zZXQoXCJhdG9tc1wiLCBhdG9tc0J1ZmZlcik7XG4gICAgbW9ua2V5cy5zZXQoXCJsaWdodHNcIiwgbGlnaHRzQnVmZmVyKTtcbiAgICBtb25rZXlzLnNldChcImJhc2VMaWdodFwiLCBbYmFzZUxpZ2h0XSk7XG4gICAgbW9ua2V5cy53b3JrKGF0b21zQ291bnQsIGBcbiAgICAgIHZlYzQgYXRvbSA9IGF0b21zKGkqMik7XG4gICAgICBncmlkKGdyaWRJbmRleChhdG9tLnh5eikpIDo9IGF0b207XG4gICAgYCk7XG4gICAgbW9ua2V5cy5jbGVhcihcInNjcmVlblwiLCAwKTtcbiAgICBtb25rZXlzLndvcmsoYXRvbXNDb3VudCwgYFxuICAgICAgdmVjNCBhdG9tUG9zID0gYXRvbXMoaSoyKzApO1xuICAgICAgdmVjNCBhdG9tQ29sID0gYXRvbXMoaSoyKzEpO1xuICAgICAgZmxvYXQgbHVtID0gYmFzZUxpZ2h0KDApO1xuICAgICAgZm9yIChpbnQgaT0wOyBpPCR7bWF4TGlnaHRzfTsgKytpKXtcbiAgICAgICAgdmVjNCBsaWdodCA9IGxpZ2h0cyhpKTtcbiAgICAgICAgaWYgKGxpZ2h0ID09IHZlYzQoMC4wKSkgY29udGludWU7XG4gICAgICAgIHZlYzMgbm9ybSA9IHVucGFja1VuaXRWZWN0b3IoMTYuMCwgYXRvbVBvcy53KTtcbiAgICAgICAgdmVjMyBwb3MgPSBhdG9tUG9zLnh5eiArIHZlYzMoMC41KSArIG5vcm0qMC41O1xuICAgICAgICBmbG9hdCBsaWdodEVmZmVjdCA9IG1heChkb3Qobm9ybSwgbm9ybWFsaXplKGxpZ2h0Lnh5ei1wb3MpKSwgMC4wKTtcbiAgICAgICAgZmxvYXQgbGlnaHRTdHJlbmd0aCA9IGxpZ2h0LncgKiBsaWdodC53O1xuICAgICAgICBpZiAobGlnaHRFZmZlY3QgPiAwLjApXG4gICAgICAgICAgaWYgKG1hcmNoKHBvcywgbGlnaHQueHl6KSlcbiAgICAgICAgICAgIGx1bSArPSAoMS4wLWRpc3RhbmNlKHBvcyxsaWdodC54eXopL2xpZ2h0U3RyZW5ndGgpICogbGlnaHRFZmZlY3QgKiAwLjY7XG4gICAgICB9O1xuICAgICAgdmVjMyBjb2xvciA9IGF0b21Db2wueHl6Kmx1bTtcbiAgICAgIHZlYzMgc2NyZWVuUG9zID0gZmxvb3IodmVjMyhhdG9tUG9zLngtYXRvbVBvcy56LCBhdG9tUG9zLnkrYXRvbVBvcy56LCBhdG9tUG9zLnopKTtcbiAgICAgIGludCBzY3JlZW5JbmRleCA9IGludChzY3JlZW5Qb3MueSAqICR7c2NyZWVuU2l6ZS55LnRvRml4ZWQoMSl9ICsgc2NyZWVuUG9zLngpO1xuICAgICAgc2NyZWVuKHNjcmVlbkluZGV4LCBpbnQoYXRvbVBvcy56KSkgOj0gdmVjNChjb2xvciwgMjU1LjApO1xuICAgIGApO1xuICAgIG1vbmtleXMud29yayhhdG9tc0NvdW50LCBgXG4gICAgICB2ZWM0IGF0b21Qb3MgPSBhdG9tcyhpKjIrMCk7XG4gICAgICBncmlkKGdyaWRJbmRleChhdG9tUG9zLnh5eikpIDo9IHZlYzQoMC4wKTtcbiAgICBgKTtcbiAgICBmb3IgKHZhciBpPTA7IGk8YXRvbXNDb3VudDsgKytpKXtcbiAgICAgIGF0b21zQnVmZmVyW2kqMiswXSA9IDA7XG4gICAgICBhdG9tc0J1ZmZlcltpKjIrMV0gPSAwO1xuICAgICAgbGlnaHRzQnVmZmVyW2kqMiswXSA9IDA7XG4gICAgfTtcbiAgICByZXR1cm4gbW9ua2V5cy5yZW5kZXIoXCJzY3JlZW5cIiwgc2NyZWVuU2l6ZS54LCBzY3JlZW5TaXplLnkpO1xuICB9XG59O1xuIiwidmFyIEdlb20gPSByZXF1aXJlKFwiZGF0dGF0YS9nZW9tZXRyaWVzLmpzXCIpO1xudmFyIE5pZ2h0U2hhZGUgPSByZXF1aXJlKFwiLi8uLi8uLi9OaWdodFNoYWRlci5qc1wiKTtcblxuZnVuY3Rpb24gcm5kKCl7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpKjItMTtcbn07XG5cbmZ1bmN0aW9uIG5vdygpe1xuICByZXR1cm4gRGF0ZS5ub3coKS8xMDAwO1xufTtcblxudmFyIEdXID0gMjU2O1xudmFyIEdIID0gMjU2O1xudmFyIEdEID0gNjQ7XG52YXIgU1cgPSAyNTY7XG52YXIgU0ggPSAyNTY7XG52YXIgcmVuZGVyID0gTmlnaHRTaGFkZSh7eDpHVywgeTpHSCwgejpHRH0sIHt4OlNXLCB5OlNIfSk7XG52YXIgbGFzdE1hcmsgPSBEYXRlLm5vdygpO1xudmFyIHRpY2tzID0gMDtcbndpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnVuY3Rpb24gUigpe1xuICB2YXIgdCA9IG5vdygpICogTWF0aC5QSSoyO1xuICB2YXIgRiA9IE1hdGguZmxvb3I7XG4gIHZhciBTID0gTWF0aC5zaW47XG4gIHZhciBDID0gTWF0aC5jb3M7XG4gIHZhciBjYW52YXMgPSByZW5kZXIoXG4gICAgZnVuY3Rpb24oYXRvbSl7XG4gICAgICAvLyBGbG9vclxuICAgICAgR2VvbS5ib3goNjQsIDY0LCA0KShmdW5jdGlvbiBwYWludCh4LHkseixueCxueSxueil7XG4gICAgICAgIGF0b20oeCtHVy8yLCB5K0dILzIsIHorNCwgbngsIG55LCBueiwgMTk2LCAyMjIsIDE1OCwgMCk7XG4gICAgICB9LCAwKTtcbiAgICAgIC8vIFdhbGxcbiAgICAgIEdlb20uYm94KDY0LCA0LCAzMikoZnVuY3Rpb24gcGFpbnQoeCx5LHosbngsbnksbnope1xuICAgICAgICBhdG9tKHgrR1cvMiwgeS02NCwgeitHRC8yLCBueCwgbnksIG56LCAyMzEsIDIzOSwgMjU1LCAwKTtcbiAgICAgIH0sIDApO1xuICAgICAgLy8gUGlsbGFyXG4gICAgICBHZW9tLmJveCgxNiwgMTYsIDI4K0ModCkqNCkoZnVuY3Rpb24gcGFpbnQoeCx5LHosbngsbnksbnope1xuICAgICAgICB2YXIgbCBcbiAgICAgICAgICA9IChDKCh6KzMyKS82NCozMi10KjMpKjAuNSswLjUpKjAuMjVcbiAgICAgICAgICArIChDKCh6KzMyKS82NCo4LXQqMSkqMC41KzAuNSkqMC4yNVxuICAgICAgICAgICsgKEMoKHgrMTYpLzE2KjE2LXQqMikqMC41KzAuNSkqMC4yNVxuICAgICAgICAgICsgKEMoKHkrMTYpLzE2KjE2LXQqMikqMC41KzAuNSkqMC4yNTtcbiAgICAgICAgYXRvbSh4K0dXLzIsIHkrR0gvMiwgeitHRC8yLCBueCwgbnksIG56LCAyNTUqbCwgMjU1KmwsIDI1NSpsLCAwKTtcbiAgICAgIH0sIDApO1xuICAgICAgLy8gQ3ViZXNcbiAgICAgIEdlb20uYm94KDgsIDgsIDMpKGZ1bmN0aW9uIHBhaW50KHgseSx6LG54LG55LG56KXtcbiAgICAgICAgYXRvbShHVy8yK0ModC80KzAuMCkqNDgreCwgR0gvMitTKHQvNCswLjApKjQ4K3ksIHorMTIsIG54LCBueSwgbnosIDI1MCwgMCwgMCwgMjU1KTtcbiAgICAgICAgYXRvbShHVy8yK0ModC80KzIuMSkqNDgreCwgR0gvMitTKHQvNCsyLjEpKjQ4K3ksIHorMTIsIG54LCBueSwgbnosIDAsIDI1MCwgMCwgMjU1KTtcbiAgICAgICAgYXRvbShHVy8yK0ModC80KzQuMikqNDgreCwgR0gvMitTKHQvNCs0LjIpKjQ4K3ksIHorMTIsIG54LCBueSwgbnosIDAsIDAsIDI1MCwgMjU1KTtcbiAgICAgIH0sIDApO1xuICAgIH0sIGZ1bmN0aW9uKGxpZ2h0KXtcbiAgICAgIGxpZ2h0KDEwMCs4MCpDKC10LzQpLCAxMDArODAqUygtdC80KSwgNDgsIDEwMCk7XG4gICAgfSxcbiAgICBbMC40XSk7XG4gIC8vY2FudmFzLnN0eWxlID0gXCJib3JkZXI6IG5vbmU7XCI7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoY2FudmFzKTtcbiAgaWYgKERhdGUubm93KCkgLSBsYXN0TWFyayA+IDEwMDApe1xuICAgIGNvbnNvbGUubG9nKHRpY2tzKTtcbiAgICBsYXN0TWFyayA9IERhdGUubm93KCksIHRpY2tzID0gMDtcbiAgfSBlbHNlICsrdGlja3M7XG4gIHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUoUik7XG59KTtcbiIsImxvYWQodGhpcywgZnVuY3Rpb24gKGV4cG9ydHMpIHtcbiAgZnVuY3Rpb24gV2ViTW9ua2V5cyhvcHQpe1xuICAgIHZhciBtYXhNb25rZXlzLFxuICAgICAgcmVzdWx0VGV4dHVyZVNpZGUsXG4gICAgICBhcnJheXMsXG4gICAgICBhcnJheUJ5TmFtZSxcbiAgICAgIHNoYWRlckJ5VGFzayxcbiAgICAgIG1vbmtleUluZGV4QXJyYXksXG4gICAgICBnbCxcbiAgICAgIGRlZmF1bHRMaWIsXG4gICAgICB3cml0ZXIsXG4gICAgICByZW5kZXJlcixcbiAgICAgIHJlc3VsdFRleHR1cmUsXG4gICAgICB1c2VyTGliLFxuICAgICAgZnJhbWVidWZmZXIsXG4gICAgICByYW5nZWJ1ZmZlcixcbiAgICAgIHJlbmRlcmVyVmVydGV4QnVmZmVyO1xuXG4gICAgLy8gKCkgLT4gTW9ua2V5c1xuICAgIGZ1bmN0aW9uIGluaXQoKXtcbiAgICAgIG9wdCA9IG9wdCB8fCBbXTtcbiAgICAgIG1heE1vbmtleXMgPSBvcHQubWF4TW9ua2V5cyB8fCAyMDQ4KjIwNDg7XG4gICAgICByZXN1bHRUZXh0dXJlU2lkZSA9IG9wdC5yZXN1bHRUZXh0dXJlU2lkZSB8fCAyMDQ4O1xuICAgICAgYXJyYXlzID0gW107XG4gICAgICBhcnJheUJ5TmFtZSA9IHt9O1xuICAgICAgc2hhZGVyQnlUYXNrID0ge307XG4gICAgICBtb25rZXlJbmRleEFycmF5ID0gbmV3IEludDMyQXJyYXkobWF4TW9ua2V5cyk7XG5cbiAgICAgIHZhciBnbE9wdCA9IHthbnRpYWxpYXM6IGZhbHNlLCBwcmVzZXJ2ZURyYXdpbmdCdWZmZXI6IHRydWV9O1xuICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09IFwidW5kZWZpbmVkXCIpe1xuICAgICAgICBnbCA9IHJlcXVpcmUoXCJnXCIrXCJsXCIpKDEsIDEsIGdsT3B0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiY2FudmFzXCIpO1xuICAgICAgICBnbCA9IGNhbnZhcy5nZXRDb250ZXh0KFwid2ViZ2xcIiwgZ2xPcHQpO1xuICAgICAgICBnbC5jYW52YXMgPSBjYW52YXM7XG4gICAgICAgIGdsLmNhbnZhcy53aWR0aCA9IDE7XG4gICAgICAgIGdsLmNhbnZhcy5oZWlnaHQgPSAxO1xuICAgICAgICBnbC5jYW52YXMuc3R5bGUgPSBbXG4gICAgICAgICAgXCJpbWFnZS1yZW5kZXJpbmc6IG9wdGltaXplU3BlZWQ7XCIsXG4gICAgICAgICAgXCJpbWFnZS1yZW5kZXJpbmc6IC1tb3otY3Jpc3AtZWRnZXM7XCIsXG4gICAgICAgICAgXCJpbWFnZS1yZW5kZXJpbmc6IC13ZWJraXQtb3B0aW1pemUtY29udHJhc3Q7XCIsXG4gICAgICAgICAgXCJpbWFnZS1yZW5kZXJpbmc6IC1vLWNyaXNwLWVkZ2VzO1wiLFxuICAgICAgICAgIFwiaW1hZ2UtcmVuZGVyaW5nOiBwaXhlbGF0ZWQ7XCIsXG4gICAgICAgICAgXCItbXMtaW50ZXJwb2xhdGlvbi1tb2RlOiBuZWFyZXN0LW5laWdoYm9yO1wiXS5qb2luKFwiXCIpO1xuICAgICAgfVxuXG4gICAgICBmb3IgKHZhciBpPTA7IGk8bWF4TW9ua2V5czsgKytpKVxuICAgICAgICBtb25rZXlJbmRleEFycmF5W2ldID0gaTsgXG5cbiAgICAgIGRlZmF1bHRMaWIgPSBbXG4gICAgICAgIFwidmVjMiBpbmRleFRvUG9zKHZlYzIgc2l6ZSwgZmxvYXQgaW5kZXgpe1wiLFxuICAgICAgICBcIiAgcmV0dXJuIHZlYzIobW9kKGluZGV4LCBzaXplLngpLCBmbG9vcihpbmRleC9zaXplLngpKTtcIixcbiAgICAgICAgXCJ9XCIsXG4gICAgICAgIFwiZmxvYXQgcG9zVG9JbmRleCh2ZWMyIHNpemUsIHZlYzIgcG9zKXtcIixcbiAgICAgICAgXCIgIHJldHVybiBwb3MueSpzaXplLnggKyBwb3MueDtcIixcbiAgICAgICAgXCJ9XCIsXG4gICAgICAgIFwidmVjMiBzY2FsZVJhbmdlKHZlYzIgZnJvbUEsIHZlYzIgZnJvbUIsIHZlYzIgdG9BLCB2ZWMyIHRvQiwgdmVjMiBwb3Mpe1wiLFxuICAgICAgICBcIiAgcmV0dXJuIHRvQSsocG9zLWZyb21BKS8oZnJvbUItZnJvbUEpKih0b0ItdG9BKTtcIixcbiAgICAgICAgXCJ9XCIsXG4gICAgICAgIFwidmVjNCBwYWNrRmxvYXQoZmxvYXQgeCl7XCIsXG4gICAgICAgIFwiICBmbG9hdCBzID0geCA+IDAuMCA/IDEuMCA6IC0xLjA7XCIsXG4gICAgICAgIFwiICBmbG9hdCBlID0gZmxvb3IobG9nMihzKngpKTtcIixcbiAgICAgICAgXCIgIGZsb2F0IG0gPSBzKnggLyBwb3coMi4wLCBlKTtcIixcbiAgICAgICAgXCIgIHJldHVybiB2ZWM0KFwiLFxuICAgICAgICBcIiAgICBmbG9vcihmcmFjdCgobS0xLjApKjI1Ni4wKjI1Ni4wKSoyNTYuMCksXCIsXG4gICAgICAgIFwiICAgIGZsb29yKGZyYWN0KChtLTEuMCkqMjU2LjApKjI1Ni4wKSxcIixcbiAgICAgICAgXCIgICAgZmxvb3IoZnJhY3QoKG0tMS4wKSoxLjApKjI1Ni4wKSxcIixcbiAgICAgICAgXCIgICAgKChlKzYzLjApICsgKHg+MC4wPzEyOC4wOjAuMCkpKS8yNTUuMDtcIixcbiAgICAgICAgXCJ9XCIsXG4gICAgICAgIFwiZmxvYXQgdW5wYWNrRmxvYXQodmVjNCB2KXtcIixcbiAgICAgICAgXCIgIHYgKj0gMjU1LjA7XCIsXG4gICAgICAgIFwiICBmbG9hdCBzID0gdi5hID49IDEyOC4wID8gMS4wIDogLTEuMDtcIixcbiAgICAgICAgXCIgIGZsb2F0IGUgPSB2LmEgLSAodi5hID49IDEyOC4wID8gMTI4LjAgOiAwLjApIC0gNjMuMDtcIixcbiAgICAgICAgXCIgIGZsb2F0IG0gPSAxLjAgKyB2LngvMjU2LjAvMjU2LjAvMjU2LjAgKyB2LnkvMjU2LjAvMjU2LjAgKyB2LnovMjU2LjA7XCIsXG4gICAgICAgIFwiICByZXR1cm4gcyAqIHBvdygyLjAsIGUpICogbTtcIixcbiAgICAgICAgXCJ9XCIsXG4gICAgICAgIFwidmVjNCBwYWNrVmVjNCh2ZWM0IHYpe1wiLFxuICAgICAgICBcIiAgcmV0dXJuIHYvMjU1LjA7XCIsXG4gICAgICAgIFwifVwiLFxuICAgICAgICBcInZlYzQgdW5wYWNrVmVjNCh2ZWM0IHYpe1wiLFxuICAgICAgICBcIiAgcmV0dXJuIHYqMjU1LjA7XCIsXG4gICAgICAgIFwifVwiLFxuICAgICAgICBcInZlYzQgcGFja0luZGV4RGVwdGgoaW50IGEsIGludCBiKXtcIixcbiAgICAgICAgXCIgIGZsb2F0IGF2ID0gZmxvYXQoYSk7XCIsXG4gICAgICAgIFwiICBmbG9hdCBidiA9IGZsb2F0KGIpO1wiLFxuICAgICAgICBcIiAgZmxvYXQgeCA9IG1vZChmbG9vcihhdiksIDI1Ni4wKTtcIixcbiAgICAgICAgXCIgIGZsb2F0IHkgPSBtb2QoZmxvb3IoYXYvMjU2LjApLCAyNTYuMCk7XCIsXG4gICAgICAgIFwiICBmbG9hdCB6ID0gbW9kKGZsb29yKGF2LzI1Ni4wLzI1Ni4wKSwgMjU2LjApO1wiLFxuICAgICAgICBcIiAgZmxvYXQgdyA9IG1vZChmbG9vcihidiksIDI1Ni4wKTtcIixcbiAgICAgICAgXCIgIHJldHVybiB2ZWM0KHgseSx6LHcpLzI1NS4wO1wiLFxuICAgICAgICBcIn1cIixcbiAgICAgICAgXCJpbnQgdW5wYWNrSW5kZXgodmVjNCB2KXtcIixcbiAgICAgICAgXCIgIHJldHVybiBpbnQodi54KjI1NS4wICsgdi55KjI1NS4wKjI1Ni4wICsgdi56KjI1NS4wKjI1Ni4wKjI1Ni4wKTtcIixcbiAgICAgICAgXCJ9XCIsXG4gICAgICAgIFwiaW50IHVucGFja0RlcHRoKHZlYzQgdil7XCIsXG4gICAgICAgIFwiICByZXR1cm4gaW50KHYudyoyNTUuMCk7XCIsXG4gICAgICAgIFwifVwiLFxuICAgICAgICBdLmpvaW4oXCJcXG5cIik7XG5cbiAgICAgIHdyaXRlciA9IGJ1aWxkU2hhZGVyKFxuICAgICAgICBbXCJwcmVjaXNpb24gaGlnaHAgZmxvYXQ7XCIsXG4gICAgICAgIFwiYXR0cmlidXRlIGZsb2F0IHJlc3VsdEluZGV4O1wiLFxuICAgICAgICBcInVuaWZvcm0gc2FtcGxlcjJEIHJlc3VsdFRleHR1cmU7XCIsXG4gICAgICAgIFwidW5pZm9ybSBmbG9hdCByZXN1bHRUZXh0dXJlU2lkZTtcIixcbiAgICAgICAgXCJ1bmlmb3JtIGZsb2F0IHJlc3VsdEdyaWRTaWRlO1wiLFxuICAgICAgICBcInVuaWZvcm0gZmxvYXQgcmVzdWx0U3F1YXJlU2lkZTtcIixcbiAgICAgICAgXCJ1bmlmb3JtIGZsb2F0IHRhcmdldFRleHR1cmVTaWRlO1wiLFxuICAgICAgICBcInZhcnlpbmcgdmVjNCB2YWx1ZTtcIixcbiAgICAgICAgZGVmYXVsdExpYixcbiAgICAgICAgXCJ2b2lkIG1haW4oKXtcIixcbiAgICAgICAgXCIgIGZsb2F0IHJlc3VsdFNxdWFyZUluZGV4ID0gbW9kKHJlc3VsdEluZGV4LCByZXN1bHRTcXVhcmVTaWRlKnJlc3VsdFNxdWFyZVNpZGUvMi4wKTtcIiwgXG4gICAgICAgIFwiICB2ZWMyIHJlc3VsdFNxdWFyZUNvb3JkID0gaW5kZXhUb1Bvcyh2ZWMyKHJlc3VsdFNxdWFyZVNpZGUvMi4wLHJlc3VsdFNxdWFyZVNpZGUpLCByZXN1bHRTcXVhcmVJbmRleCkqdmVjMigyLjAsMS4wKTtcIixcbiAgICAgICAgXCIgIHZlYzIgcmVzdWx0R3JpZENvb3JkID0gaW5kZXhUb1Bvcyh2ZWMyKHJlc3VsdEdyaWRTaWRlKSwgZmxvb3IocmVzdWx0SW5kZXgvKHJlc3VsdFNxdWFyZVNpZGUqcmVzdWx0U3F1YXJlU2lkZS8yLjApKSk7XCIsXG4gICAgICAgIFwiICB2ZWMyIHJlc3VsdENvb3JkID0gcmVzdWx0R3JpZENvb3JkICogcmVzdWx0U3F1YXJlU2lkZSArIHJlc3VsdFNxdWFyZUNvb3JkO1wiLFxuICAgICAgICBcIiAgdmVjMiBpbmRleENvb3JkID0gKHJlc3VsdENvb3JkK3ZlYzIoMC41LDAuNSkpL3Jlc3VsdFRleHR1cmVTaWRlO1wiLFxuICAgICAgICBcIiAgdmVjMiB2YWx1ZUNvb3JkID0gKHJlc3VsdENvb3JkK3ZlYzIoMS41LDAuNSkpL3Jlc3VsdFRleHR1cmVTaWRlO1wiLFxuICAgICAgICBcIiAgZmxvYXQgaW5kZXggPSBmbG9hdCh1bnBhY2tJbmRleCh0ZXh0dXJlMkQocmVzdWx0VGV4dHVyZSwgaW5kZXhDb29yZCkpLTEpO1wiLFxuICAgICAgICBcIiAgZmxvYXQgZGVwdGggPSBmbG9hdCh1bnBhY2tEZXB0aCh0ZXh0dXJlMkQocmVzdWx0VGV4dHVyZSwgaW5kZXhDb29yZCkpKTtcIixcbiAgICAgICAgXCIgIHZhbHVlID0gdGV4dHVyZTJEKHJlc3VsdFRleHR1cmUsIHZhbHVlQ29vcmQpO1wiLFxuICAgICAgICBcIiAgdmVjMiByUG9zID0gKGluZGV4VG9Qb3ModmVjMih0YXJnZXRUZXh0dXJlU2lkZSksaW5kZXgpK3ZlYzIoMC41KSkvdGFyZ2V0VGV4dHVyZVNpZGUqMi4wLTEuMDtcIixcbiAgICAgICAgXCIgIGdsX1Bvc2l0aW9uID0gdmVjNChkZXB0aCA+IDAuNSA/IHJQb3MgOiB2ZWMyKC0xLjAsLTEuMCksICgyNTUuMC1kZXB0aCkvMjU1LjAsIDEuMCk7XCIsXG4gICAgICAgIC8vXCIgIGdsX1Bvc2l0aW9uID0gdmVjNChyUG9zLCAtMC41LCAxLjApO1wiLFxuICAgICAgICBcIiAgZ2xfUG9pbnRTaXplID0gMS4wO1wiLFxuICAgICAgICBcIn1cIl0uam9pbihcIlxcblwiKSxcbiAgICAgICAgW1wicHJlY2lzaW9uIGhpZ2hwIGZsb2F0O1wiLFxuICAgICAgICBcInZhcnlpbmcgdmVjNCB2YWx1ZTtcIixcbiAgICAgICAgXCJ2b2lkIG1haW4oKXtcIixcbiAgICAgICAgXCIgIGdsX0ZyYWdDb2xvciA9IHZhbHVlO1wiLFxuICAgICAgICBcIn1cIl0uam9pbihcIlxcblwiKSk7XG5cbiAgICAgIHJlbmRlcmVyID0gYnVpbGRTaGFkZXIoXG4gICAgICAgIFtcInByZWNpc2lvbiBoaWdocCBmbG9hdDtcIixcbiAgICAgICAgXCJhdHRyaWJ1dGUgdmVjMiB2ZXJ0ZXhQb3M7XCIsXG4gICAgICAgIFwidmFyeWluZyB2ZWMyIHBvcztcIixcbiAgICAgICAgXCJ2b2lkIG1haW4oKXtcIixcbiAgICAgICAgXCIgIHBvcyA9IHZlcnRleFBvcztcIixcbiAgICAgICAgXCIgIGdsX1Bvc2l0aW9uID0gdmVjNCh2ZXJ0ZXhQb3MsIDAuMCwgMS4wKTtcIixcbiAgICAgICAgXCJ9XCJdLmpvaW4oXCJcXG5cIiksXG4gICAgICAgIFtcInByZWNpc2lvbiBtZWRpdW1wIGZsb2F0O1wiLFxuICAgICAgICBcInVuaWZvcm0gc2FtcGxlcjJEIGFycmF5O1wiLFxuICAgICAgICBcInZhcnlpbmcgdmVjMiBwb3M7XCIsXG4gICAgICAgIFwidm9pZCBtYWluKCl7XCIsXG4gICAgICAgIFwiICBnbF9GcmFnQ29sb3IgPSB0ZXh0dXJlMkQoYXJyYXksIHBvcyowLjUrMC41KTtcIixcbiAgICAgICAgLy9cIiAgZ2xfRnJhZ0NvbG9yID0gdmVjNCgxLjAsIDAuNSwgMC41LCAxLjApO1wiLFxuICAgICAgICBcIn1cIl0uam9pbihcIlxcblwiKSk7XG5cbiAgICAgIGdsLmNsZWFyRGVwdGgoMjU2LjApO1xuXG4gICAgICByZW5kZXJlclZlcnRleEJ1ZmZlciA9IGdsLmNyZWF0ZUJ1ZmZlcigpO1xuICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIHJlbmRlcmVyVmVydGV4QnVmZmVyKTtcbiAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBuZXcgRmxvYXQzMkFycmF5KFsxLDEsLTEsLTEsMSwtMSwxLDEsLTEsMSwtMSwtMV0pLCBnbC5TVEFUSUNfRFJBVyk7XG5cbiAgICAgIHJhbmdlYnVmZmVyID0gZ2wuY3JlYXRlQnVmZmVyKCk7XG4gICAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgcmFuZ2VidWZmZXIpO1xuICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIG5ldyBGbG9hdDMyQXJyYXkobW9ua2V5SW5kZXhBcnJheSksIGdsLlNUQVRJQ19EUkFXKTtcbiAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBudWxsKTtcblxuICAgICAgcmVzdWx0VGV4dHVyZSA9IGdsLmNyZWF0ZVRleHR1cmUoKTtcbiAgICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTApO1xuICAgICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgcmVzdWx0VGV4dHVyZSk7XG4gICAgICBnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfTUFHX0ZJTFRFUiwgZ2wuTkVBUkVTVCk7XG4gICAgICBnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfTUlOX0ZJTFRFUiwgZ2wuTkVBUkVTVCk7XG4gICAgICBnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfV1JBUF9TLCBnbC5DTEFNUF9UT19FREdFKTtcbiAgICAgIGdsLnRleFBhcmFtZXRlcmkoZ2wuVEVYVFVSRV8yRCwgZ2wuVEVYVFVSRV9XUkFQX1QsIGdsLkNMQU1QX1RPX0VER0UpO1xuICAgICAgZ2wudGV4SW1hZ2UyRChnbC5URVhUVVJFXzJELCAwLCBnbC5SR0JBLCByZXN1bHRUZXh0dXJlU2lkZSwgcmVzdWx0VGV4dHVyZVNpZGUsIDAsIGdsLlJHQkEsIGdsLlVOU0lHTkVEX0JZVEUsIG51bGwpO1xuXG4gICAgICBmcmFtZWJ1ZmZlciA9IGdsLmNyZWF0ZUZyYW1lYnVmZmVyKCk7XG4gICAgICBnbC5iaW5kRnJhbWVidWZmZXIoZ2wuRlJBTUVCVUZGRVIsIGZyYW1lYnVmZmVyKTtcblxuICAgICAgcmV0dXJuIG1vbmtleXNBcGk7XG4gICAgfTtcblxuICAgIC8vICpNb25rZXlzID0+IFN0cmluZywgU3RyaW5nIC0+IFdlYkdMUHJvZ3JhbVxuICAgIGZ1bmN0aW9uIGJ1aWxkU2hhZGVyKHZlcnRleFNyYywgZnJhZ21lbnRTcmMpe1xuICAgICAgZnVuY3Rpb24gY29tcGlsZSh0eXBlLCBzaGFkZXJTb3VyY2Upe1xuICAgICAgICB2YXIgc2hhZGVyID0gZ2wuY3JlYXRlU2hhZGVyKHR5cGUpO1xuICAgICAgICBnbC5zaGFkZXJTb3VyY2Uoc2hhZGVyLCBzaGFkZXJTb3VyY2UpO1xuICAgICAgICBnbC5jb21waWxlU2hhZGVyKHNoYWRlcik7XG4gICAgICAgIGlmICghZ2wuZ2V0U2hhZGVyUGFyYW1ldGVyKHNoYWRlciwgZ2wuQ09NUElMRV9TVEFUVVMpKXtcbiAgICAgICAgICB2YXIgZXJyb3JNc2cgPSBcIldlYk1vbmtleXMgaGFkIHRoZSBmb2xsb3dpbmcgZXJyb3IgZnJvbSBXZWJHTDogXCIgKyBnbC5nZXRTaGFkZXJJbmZvTG9nKHNoYWRlcik7XG4gICAgICAgICAgaWYgKGVycm9yTXNnLmluZGV4T2YoXCJzeW50YXggZXJyb3JcIikgIT09IC0xKVxuICAgICAgICAgICAgZXJyb3JNc2cgKz0gXCJUaGlzIGNvdWxkIGJlIGZpeGVkIGJ5IGFkZGluZyBleHRyYSBgO2AgYmVmb3JlIHNldHRlcnMuXCI7XG4gICAgICAgICAgdGhyb3cgZXJyb3JNc2c7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHNoYWRlcjtcbiAgICAgIH1cbiAgICAgIHZhciB2ZXJ0ZXhTaGFkZXIgPSBjb21waWxlKGdsLlZFUlRFWF9TSEFERVIsIHZlcnRleFNyYyk7XG4gICAgICB2YXIgZnJhZ21lbnRTaGFkZXIgPSBjb21waWxlKGdsLkZSQUdNRU5UX1NIQURFUiwgZnJhZ21lbnRTcmMpO1xuXG4gICAgICB2YXIgc2hhZGVyID0gZ2wuY3JlYXRlUHJvZ3JhbSgpO1xuICAgICAgZ2wuYXR0YWNoU2hhZGVyKHNoYWRlciwgdmVydGV4U2hhZGVyKTtcbiAgICAgIGdsLmF0dGFjaFNoYWRlcihzaGFkZXIsIGZyYWdtZW50U2hhZGVyKTtcbiAgICAgIGdsLmxpbmtQcm9ncmFtKHNoYWRlcik7XG4gICAgICBpZighZ2wuZ2V0UHJvZ3JhbVBhcmFtZXRlcihzaGFkZXIsIGdsLkxJTktfU1RBVFVTKSlcbiAgICAgICAgdGhyb3cgXCJFcnJvciBsaW5raW5nIHNoYWRlcnMuXCI7XG5cbiAgICAgIHJldHVybiBzaGFkZXI7XG4gICAgfVxuXG4gICAgLy8gTnVtYmVyIC0+IE51bWJlclxuICAgIGZ1bmN0aW9uIGZpdFRleHR1cmVTaWRlKGVsZW1lbnRzKXtcbiAgICAgIHJldHVybiBNYXRoLnBvdygyLCBNYXRoLmNlaWwoTWF0aC5sb2coTWF0aC5zcXJ0KGVsZW1lbnRzKSkvTWF0aC5sb2coMikpKTtcbiAgICB9O1xuXG4gICAgLy8gTnVtYmVyIC0+IE51bWJlclxuICAgIGZ1bmN0aW9uIGZyYWN0KHgpeyBcbiAgICAgIHJldHVybiB4IC0gTWF0aC5mbG9vcih4KTtcbiAgICB9O1xuXG4gICAgLy8gKk1vbmtleXMgPT4gU3RyaW5nIC0+IE1heWJlIChFaXRoZXIgKEFycmF5IE51bWJlcikgKlVpbnQzMkFycmF5KVxuICAgIGZ1bmN0aW9uIGdldChuYW1lKXtcbiAgICAgIHZhciBhcnJheSA9IGFycmF5QnlOYW1lW25hbWVdO1xuICAgICAgaWYgKCFhcnJheSkgcmV0dXJuIG51bGw7XG4gICAgICB2YXIgdGFyZ2V0QXJyYXkgPSBhcnJheS51aW50MzJBcnJheTtcbiAgICAgIHZhciBwaXhlbHMgPSB0YXJnZXRBcnJheVxuICAgICAgICA/IG5ldyBVaW50OEFycmF5KHRhcmdldEFycmF5LmJ1ZmZlcikgIC8vIHJlLXVzZXMgZXhpc3RpbmcgYnVmZmVyXG4gICAgICAgIDogbmV3IFVpbnQ4QXJyYXkoYXJyYXkudGV4dHVyZVNpZGUqYXJyYXkudGV4dHVyZVNpZGUqNCk7XG4gICAgICBnbC5mcmFtZWJ1ZmZlclRleHR1cmUyRChnbC5GUkFNRUJVRkZFUiwgZ2wuQ09MT1JfQVRUQUNITUVOVDAsIGdsLlRFWFRVUkVfMkQsIGFycmF5LnRleHR1cmUsIDApO1xuICAgICAgZ2wuZnJhbWVidWZmZXJSZW5kZXJidWZmZXIoZ2wuRlJBTUVCVUZGRVIsIGdsLkRFUFRIX0FUVEFDSE1FTlQsIGdsLlJFTkRFUkJVRkZFUiwgbnVsbCk7XG4gICAgICBnbC5yZWFkUGl4ZWxzKDAsIDAsIGFycmF5LnRleHR1cmVTaWRlLCBhcnJheS50ZXh0dXJlU2lkZSwgZ2wuUkdCQSwgZ2wuVU5TSUdORURfQllURSwgcGl4ZWxzKTtcblxuICAgICAgaWYgKCF0YXJnZXRBcnJheSl7XG4gICAgICAgIHZhciByZXN1bHQgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaT0wLCBsPWFycmF5Lmxlbmd0aDsgaTxsOyArK2kpe1xuICAgICAgICAgIHZhciBzID0gcGl4ZWxzW2kqNCszXSA+PSAxMjggPyAxIDogLTE7XG4gICAgICAgICAgdmFyIGUgPSBwaXhlbHNbaSo0KzNdIC0gKHBpeGVsc1tpKjQrM10gPj0gMTI4ID8gMTI4IDogMCkgLSA2MztcbiAgICAgICAgICB2YXIgbSA9IDEgKyBwaXhlbHNbaSo0KzBdLzI1Ni8yNTYvMjU2ICsgcGl4ZWxzW2kqNCsxXS8yNTYvMjU2ICsgcGl4ZWxzW2kqNCsyXS8yNTY7XG4gICAgICAgICAgdmFyIG4gPSBzICogTWF0aC5wb3coMiwgZSkgKiBtO1xuICAgICAgICAgIHZhciB6ID0gMC4wMDAwMDAwMDAwMDAwMDAwMDE7IC8vIHRvIGF2b2lkIGFubm95aW5nIGZsb2F0aW5nIHBvaW50IGVycm9yIGZvciAwXG4gICAgICAgICAgcmVzdWx0LnB1c2goLXogPCBuICYmIG4gPCB6ID8gMCA6IG4pO1xuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHRhcmdldEFycmF5O1xuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyAqTW9ua2V5cyA9PiBTdHJpbmcsICpVaW50MzJBcnJheSAtPiBNb25rZXlzXG4gICAgLy8gKk1vbmtleXMgPT4gU3RyaW5nLCBBcnJheSBOdW1iZXIgLT4gTW9ua2V5c1xuICAgIC8vICpNb25rZXlzID0+IFN0cmluZywgTnVtYmVyIC0+IE1vbmtleXNcbiAgICBmdW5jdGlvbiBzZXQobmFtZSwgbGVuZ3RoT3JBcnJheSl7XG4gICAgICBpZiAodHlwZW9mIGxlbmd0aE9yQXJyYXkgPT09IFwibnVtYmVyXCIpe1xuICAgICAgICB2YXIgbGVuZ3RoID0gbGVuZ3RoT3JBcnJheTtcbiAgICAgICAgdmFyIHRleHR1cmVTaWRlID0gZml0VGV4dHVyZVNpZGUobGVuZ3RoKTtcbiAgICAgICAgdmFyIGFycmF5ID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBsZW5ndGggPSBsZW5ndGhPckFycmF5Lmxlbmd0aDtcbiAgICAgICAgdmFyIHRleHR1cmVTaWRlID0gZml0VGV4dHVyZVNpZGUobGVuZ3RoKTtcbiAgICAgICAgaWYgKGxlbmd0aE9yQXJyYXkgaW5zdGFuY2VvZiBBcnJheSkgeyAvLyB1cGxvYWQgSlMgTnVtYmVycyBhcyBGbG9hdHNcbiAgICAgICAgICB2YXIgYXJyYXkgPSBuZXcgVWludDhBcnJheSh0ZXh0dXJlU2lkZSp0ZXh0dXJlU2lkZSo0KTtcbiAgICAgICAgICBmb3IgKHZhciBpPTAsIGw9bGVuZ3RoT3JBcnJheS5sZW5ndGg7IGk8bDsgKytpKXsgXG4gICAgICAgICAgICB2YXIgeCA9IGxlbmd0aE9yQXJyYXlbaV07XG4gICAgICAgICAgICB2YXIgcyA9IHggPiAwID8gMSA6IC0xO1xuICAgICAgICAgICAgdmFyIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nMihzKngpKTtcbiAgICAgICAgICAgIHZhciBtID0gcyp4L01hdGgucG93KDIsIGUpO1xuICAgICAgICAgICAgYXJyYXlbaSo0KzBdID0gTWF0aC5mbG9vcihmcmFjdCgobS0xKSoyNTYqMjU2KSoyNTYpfHwwO1xuICAgICAgICAgICAgYXJyYXlbaSo0KzFdID0gTWF0aC5mbG9vcihmcmFjdCgobS0xKSoyNTYpKjI1Nil8fDA7XG4gICAgICAgICAgICBhcnJheVtpKjQrMl0gPSBNYXRoLmZsb29yKGZyYWN0KChtLTEpKjEpKjI1Nil8fDA7XG4gICAgICAgICAgICBhcnJheVtpKjQrM10gPSAoKGUrNjMpICsgKHg+MD8xMjg6MCkpfHwwO1xuICAgICAgICAgIH07XG4gICAgICAgIH0gZWxzZSB7IC8vIHVwbG9hZCAzMi1iaXQgVWludHMgYXMgVmVjNHNcbiAgICAgICAgICBpZiAodGV4dHVyZVNpZGUgKiB0ZXh0dXJlU2lkZSAhPT0gbGVuZ3RoKVxuICAgICAgICAgICAgdGhyb3cgXCJXZWJNb25rZXkgZXJyb3I6IHdoZW4gb24gcmF3IGJ1ZmZlciBtb2RlLCB0aGUgbGVuZ3RoIG9mIHlvdXJcXG5cIlxuICAgICAgICAgICAgICAgICsgXCJidWZmZXIgbXVzdCBiZSAoMl5uKV4yIGZvciBhIHBvc2l0aXZlIGludGVnZXIgbi4gVGhhdCBpcywgaXRcXG5cIlxuICAgICAgICAgICAgICAgICsgXCJjb3VsZCBiZSAxLCA0LCAxNiwgNjQsIDI1NiwgMTAyNCwgNDA5NiwgMTYzODQsIDY1NTM2LCAyNjIxNDRcXG5cIlxuICAgICAgICAgICAgICAgICsgXCJhbmQgc28gb24uIFlvdXIgJ1wiK25hbWUrXCInIGJ1ZmZlciBoYXMgbGVuZ3RoIFwiK2xlbmd0aCtcIi5cIjtcbiAgICAgICAgICB2YXIgYXJyYXkgPSBuZXcgVWludDhBcnJheShsZW5ndGhPckFycmF5LmJ1ZmZlcik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTApO1xuICAgICAgaWYgKCFhcnJheUJ5TmFtZVtuYW1lXSl7XG4gICAgICAgIHZhciB0ZXh0dXJlID0gZ2wuY3JlYXRlVGV4dHVyZSgpO1xuICAgICAgICBnbC5iaW5kVGV4dHVyZShnbC5URVhUVVJFXzJELCB0ZXh0dXJlKTtcbiAgICAgICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX01BR19GSUxURVIsIGdsLk5FQVJFU1QpO1xuICAgICAgICBnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfTUlOX0ZJTFRFUiwgZ2wuTkVBUkVTVCk7XG4gICAgICAgIGdsLnRleFBhcmFtZXRlcmkoZ2wuVEVYVFVSRV8yRCwgZ2wuVEVYVFVSRV9XUkFQX1MsIGdsLkNMQU1QX1RPX0VER0UpO1xuICAgICAgICBnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfV1JBUF9ULCBnbC5DTEFNUF9UT19FREdFKTtcbiAgICAgICAgZ2wudGV4SW1hZ2UyRChnbC5URVhUVVJFXzJELCAwLCBnbC5SR0JBLCB0ZXh0dXJlU2lkZSwgdGV4dHVyZVNpZGUsIDAsIGdsLlJHQkEsIGdsLlVOU0lHTkVEX0JZVEUsIGFycmF5KTtcbiAgICAgICAgdmFyIGRlcHRoYnVmZmVyID0gZ2wuY3JlYXRlUmVuZGVyYnVmZmVyKCk7XG4gICAgICAgIGdsLmJpbmRSZW5kZXJidWZmZXIoZ2wuUkVOREVSQlVGRkVSLCBkZXB0aGJ1ZmZlcik7XG4gICAgICAgIGdsLnJlbmRlcmJ1ZmZlclN0b3JhZ2UoZ2wuUkVOREVSQlVGRkVSLCBnbC5ERVBUSF9DT01QT05FTlQxNiwgdGV4dHVyZVNpZGUsIHRleHR1cmVTaWRlKTtcbiAgICAgICAgYXJyYXlCeU5hbWVbbmFtZV0gPSB7XG4gICAgICAgICAgbmFtZTogbmFtZSxcbiAgICAgICAgICB1aW50MzJBcnJheTogbGVuZ3RoT3JBcnJheSBpbnN0YW5jZW9mIFVpbnQzMkFycmF5ID8gbGVuZ3RoT3JBcnJheSA6IG51bGwsXG4gICAgICAgICAgdmFsdWVUeXBlOiBsZW5ndGhPckFycmF5IGluc3RhbmNlb2YgVWludDMyQXJyYXkgPyBcInZlYzRcIiA6IFwiZmxvYXRcIixcbiAgICAgICAgICB0ZXh0dXJlOiB0ZXh0dXJlLFxuICAgICAgICAgIGRlcHRoYnVmZmVyOiBkZXB0aGJ1ZmZlcixcbiAgICAgICAgICB0ZXh0dXJlTmFtZTogbmFtZStcIl9cIixcbiAgICAgICAgICB0ZXh0dXJlU2lkZTogdGV4dHVyZVNpZGUsXG4gICAgICAgICAgbGVuZ3RoOiBsZW5ndGh9O1xuICAgICAgICBhcnJheXMucHVzaChhcnJheUJ5TmFtZVtuYW1lXSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgdGV4dHVyZSA9IGFycmF5QnlOYW1lW25hbWVdLnRleHR1cmU7XG4gICAgICAgIGdsLmJpbmRUZXh0dXJlKGdsLlRFWFRVUkVfMkQsIHRleHR1cmUpO1xuICAgICAgICBnbC50ZXhJbWFnZTJEKGdsLlRFWFRVUkVfMkQsIDAsIGdsLlJHQkEsIHRleHR1cmVTaWRlLCB0ZXh0dXJlU2lkZSwgMCwgZ2wuUkdCQSwgZ2wuVU5TSUdORURfQllURSwgYXJyYXkpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG1vbmtleXNBcGk7XG4gICAgfTtcblxuICAgIC8vICpNb25rZXlzID0+IFN0cmluZywgVWludDMyIC0+IE1vbmtleXNcbiAgICBmdW5jdGlvbiBjbGVhcihuYW1lLCB2YWx1ZSl7XG4gICAgICB2YXIgYXJyYXkgPSBhcnJheUJ5TmFtZVtuYW1lXTtcbiAgICAgIGdsLmJpbmRGcmFtZWJ1ZmZlcihnbC5GUkFNRUJVRkZFUiwgZnJhbWVidWZmZXIpO1xuICAgICAgZ2wuZnJhbWVidWZmZXJUZXh0dXJlMkQoZ2wuRlJBTUVCVUZGRVIsIGdsLkNPTE9SX0FUVEFDSE1FTlQwLCBnbC5URVhUVVJFXzJELCBhcnJheS50ZXh0dXJlLCAwKTtcbiAgICAgIGdsLmZyYW1lYnVmZmVyUmVuZGVyYnVmZmVyKGdsLkZSQU1FQlVGRkVSLCBnbC5ERVBUSF9BVFRBQ0hNRU5ULCBnbC5SRU5ERVJCVUZGRVIsIG51bGwpO1xuICAgICAgZ2wuY2xlYXJDb2xvcihcbiAgICAgICAgKCh2YWx1ZSYweDAwMDAwMEZGKSA+Pj4gIDApLzI1NSxcbiAgICAgICAgKCh2YWx1ZSYweDAwMDBGRjAwKSA+Pj4gIDgpLzI1NSxcbiAgICAgICAgKCh2YWx1ZSYweDAwRkYwMDAwKSA+Pj4gMTYpLzI1NSxcbiAgICAgICAgKCh2YWx1ZSYweEZGMDAwMDAwKSA+Pj4gMjQpLzI1NSk7XG4gICAgICBnbC5jbGVhcihnbC5DT0xPUl9CVUZGRVJfQklUKVxuICAgICAgcmV0dXJuIG1vbmtleXNBcGk7XG4gICAgfTtcblxuICAgIC8vICpNb25rZXlzID0+IFN0cmluZyAtPiBNb25rZXlzXG4gICAgZnVuY3Rpb24gZGVsKG5hbWUpe1xuICAgICAgdmFyIGV4aXN0aW5nQXJyYXk7XG4gICAgICBpZiAoZXhpc3RpbmdBcnJheSA9IGFycmF5c0J5TmFtZVtuYW1lXSl7XG4gICAgICAgIGRlbGV0ZSBhcnJheXNCeU5hbWVbbmFtZV07XG4gICAgICAgIGFycmF5cyA9IGFycmF5cy5maWx0ZXIoZnVuY3Rpb24oYXJyKXtcbiAgICAgICAgICByZXR1cm4gYXJyICE9PSBleGlzdGluZ0FycmF5O1xuICAgICAgICB9KTtcbiAgICAgICAgZ2wuZGVsZXRlVGV4dHVyZShleGlzdGluZ0FycmF5LnRleHR1cmUpO1xuICAgICAgfTtcbiAgICAgIHJldHVybiBtb25rZXlzQXBpO1xuICAgIH07XG5cbiAgICAvLyBTdHJpbmcgLT4gTWF5YmUge25hbWU6IFN0cmluZywgaW5kZXg6IFN0cmluZywgZGVwdGg6IFN0cmluZywgdmFsdWU6IFN0cmluZ31cbiAgICAvLyAgIFBhcnNlcyBhIHNldHRlciBzdGF0ZW1lbnQgc3VjaCBhcyBgZm9vKGkqOCkgOj0gYmFyKGkqOCkgKyBiYXooaSo4KTtgIGFuZFxuICAgIC8vICAgcmV0dXJucyBgbmFtZWAsIGBpbmRleGAsIGBkZXB0aGAgYW5kIGB2YWx1ZWAgc3RyaW5nczpcbiAgICAvLyAgIHtuYW1lOiBcImZvb1wiLCBpbmRleDogXCJpKjhcIiwgZGVwdGg6IFwiXCIsIHZhbHVlOiBcImJhcihpKjgpICsgYmF6KGkqOClcIn1cbiAgICBmdW5jdGlvbiBwYXJzZVNldHRlclN0YXRlbWVudChzdGF0ZW1lbnQpe1xuICAgICAgdmFyIG5hbWUgPSBcIlwiO1xuICAgICAgdmFyIGluZGV4ID0gXCJcIjtcbiAgICAgIHZhciBkZXB0aCA9IFwiXCI7XG4gICAgICB2YXIgdmFsdWUgPSBcIlwiO1xuICAgICAgdmFyIHBoYXNlID0gMDtcbiAgICAgIHZhciBicmFja2V0cyA9IDE7XG4gICAgICBmb3IgKHZhciBpPTAsIGw9c3RhdGVtZW50Lmxlbmd0aDsgaSA8IGw7ICsraSl7XG4gICAgICAgIHZhciBjaHIgPSBzdGF0ZW1lbnRbaV07XG4gICAgICAgIHN3aXRjaCAocGhhc2Upe1xuICAgICAgICAgIGNhc2UgMDogXG4gICAgICAgICAgICBpZiAoY2hyID09PSBcIihcIilcbiAgICAgICAgICAgICAgcGhhc2UgPSAxO1xuICAgICAgICAgICAgZWxzZSBpZiAoY2hyICE9PSBcIiBcIiAmJiBjaHIgIT09IFwiXFxuXCIpXG4gICAgICAgICAgICAgIG5hbWUgKz0gY2hyO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgMTpcbiAgICAgICAgICAgIGlmIChjaHIgPT09IFwiKFwiKVxuICAgICAgICAgICAgICArK2JyYWNrZXRzO1xuICAgICAgICAgICAgZWxzZSBpZiAoY2hyID09PSBcIilcIilcbiAgICAgICAgICAgICAgLS1icmFja2V0cztcbiAgICAgICAgICAgIGlmIChicmFja2V0cyA9PT0gMSAmJiBjaHIgPT09IFwiLFwiKVxuICAgICAgICAgICAgICBwaGFzZSA9IDI7XG4gICAgICAgICAgICBlbHNlIGlmIChicmFja2V0cyA9PT0gMClcbiAgICAgICAgICAgICAgcGhhc2UgPSAzO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICBpbmRleCArPSBjaHI7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAyOlxuICAgICAgICAgICAgaWYgKGNociA9PT0gXCIoXCIpXG4gICAgICAgICAgICAgICsrYnJhY2tldHM7XG4gICAgICAgICAgICBlbHNlIGlmIChjaHIgPT09IFwiKVwiKVxuICAgICAgICAgICAgICAtLWJyYWNrZXRzO1xuICAgICAgICAgICAgaWYgKGJyYWNrZXRzID09PSAwKVxuICAgICAgICAgICAgICBwaGFzZSA9IDM7XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgIGRlcHRoICs9IGNocjtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlIDM6XG4gICAgICAgICAgICBpZiAoY2hyID09PSBcIjpcIilcbiAgICAgICAgICAgICAgcGhhc2UgPSA0O1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgNDpcbiAgICAgICAgICAgIGlmIChjaHIgPT09IFwiPVwiKVxuICAgICAgICAgICAgICBwaGFzZSA9IDU7XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgNTpcbiAgICAgICAgICAgIGlmIChjaHIgIT09IFwiIFwiKVxuICAgICAgICAgICAgICB2YWx1ZSArPSBjaHIsXG4gICAgICAgICAgICAgIHBoYXNlID0gNjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgNjpcbiAgICAgICAgICAgIGlmIChjaHIgPT09IFwiO1wiKVxuICAgICAgICAgICAgICBwaGFzZSA9IDc7XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgIHZhbHVlICs9IGNocjtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfTtcbiAgICAgIH07XG4gICAgICByZXR1cm4gcGhhc2UgPT09IDcgXG4gICAgICAgID8ge25hbWU6IG5hbWUsXG4gICAgICAgICAgaW5kZXg6IGluZGV4LFxuICAgICAgICAgIGRlcHRoOiBkZXB0aCxcbiAgICAgICAgICB2YWx1ZTogdmFsdWV9XG4gICAgICAgIDogbnVsbDtcbiAgICB9O1xuXG4gICAgLy8gU3RyaW5nIC0+IHtzaGFkZXI6IEdMU2hhZGVyLCBtYXhSZXN1bHRzOiBOdW1iZXIsIHJlc3VsdEFycmF5TmFtZTogU3RyaW5nLCB1c2VzRGVwdGg6IEJvb2x9XG4gICAgZnVuY3Rpb24gYnVpbGRTaGFkZXJGb3JUYXNrKHRhc2spe1xuICAgICAgaWYgKHNoYWRlckJ5VGFza1t0YXNrXSkgXG4gICAgICAgIHJldHVybiBzaGFkZXJCeVRhc2tbdGFza107XG5cbiAgICAgIHZhciB1c2VzRGVwdGggPSBmYWxzZTtcbiAgICAgIHZhciB0YXNrU3RhdGVtZW50cyA9IHRhc2suc3BsaXQoXCI7XCIpO1xuICAgICAgdGFza1N0YXRlbWVudHMucG9wKCk7XG4gICAgICB2YXIgc2V0dGVycyA9IFtdO1xuICAgICAgdmFyIHNldHRlcjtcbiAgICAgIHdoaWxlIChzZXR0ZXIgPSBwYXJzZVNldHRlclN0YXRlbWVudCh0YXNrU3RhdGVtZW50c1t0YXNrU3RhdGVtZW50cy5sZW5ndGgtMV0rXCI7XCIpKXtcbiAgICAgICAgc2V0dGVycy5wdXNoKHNldHRlcik7XG4gICAgICAgIHRhc2tTdGF0ZW1lbnRzLnBvcCgpO1xuICAgICAgICBpZiAoc2V0dGVyLmRlcHRoICE9PSBcIjBcIilcbiAgICAgICAgICB1c2VzRGVwdGggPSB0cnVlO1xuICAgICAgfTtcbiAgICAgIGlmIChzZXR0ZXJzLmxlbmd0aCA9PT0gMClcbiAgICAgICAgdGhyb3cgXCJFcnJvciBwYXJzaW5nIE1vbmtleSB0YXNrOiB0YXNrcyBtdXN0IGVuZCB3aXRoIGEgc2V0dGVyIHN0YXRlbWVudCBzdWNoIGFzIGBmb29bMF0gPSAwO2AuXCI7XG4gICAgICB2YXIgcmVzdWx0QXJyYXlOYW1lID0gc2V0dGVyc1swXS5uYW1lO1xuICAgICAgZm9yICh2YXIgaT0xLCBsPXNldHRlcnMubGVuZ3RoOyBpPGw7ICsraSlcbiAgICAgICAgaWYgKHNldHRlcnNbaV0ubmFtZSAhPT0gcmVzdWx0QXJyYXlOYW1lKVxuICAgICAgICAgIHRocm93IFwiRXJyb3IgcGFyc2luZyBNb25rZXkgdGFzazogeW91IGNhbid0IHdyaXRlIHRvIGRpZmZlcmVudCBhcnJheXMgb24gdGhlIHNhbWUgdGFzay5cIjtcblxuICAgICAgdmFyIHRhc2tXaXRob3V0U2V0dGVycyA9IHRhc2tTdGF0ZW1lbnRzLmpvaW4oXCI7XCIpK1wiO1wiO1xuXG4gICAgICB2YXIgdXNlZFJlc3VsdHMgPSBzZXR0ZXJzLmxlbmd0aDtcbiAgICAgIHZhciBtYXhSZXN1bHRzID0gTWF0aC5wb3coZml0VGV4dHVyZVNpZGUodXNlZFJlc3VsdHMqMiksMikvMjtcblxuICAgICAgdmFyIGdldHRlcnMgPSBcIlwiO1xuICAgICAgZm9yICh2YXIgaT0wLCBsPWFycmF5cy5sZW5ndGg7IGk8bDsgKytpKVxuICAgICAgICBnZXR0ZXJzIFxuICAgICAgICAgICs9IFwidW5pZm9ybSBzYW1wbGVyMkQgXCIrYXJyYXlzW2ldLnRleHR1cmVOYW1lK1wiO1xcblwiXG4gICAgICAgICAgKyAgYXJyYXlzW2ldLnZhbHVlVHlwZStcIiBcIithcnJheXNbaV0ubmFtZStcIihmbG9hdCBpZHgpe1xcblwiXG4gICAgICAgICAgKyAgXCIgIHJldHVybiBcIisoYXJyYXlzW2ldLnZhbHVlVHlwZT09PVwiZmxvYXRcIj9cInVucGFja0Zsb2F0XCI6XCJ1bnBhY2tWZWM0XCIpK1wiKHRleHR1cmUyRChcIithcnJheXNbaV0udGV4dHVyZU5hbWUrXCIsaW5kZXhUb1Bvcyh2ZWMyKFwiK2FycmF5c1tpXS50ZXh0dXJlU2lkZS50b0ZpeGVkKDEpK1wiKSwgaWR4KS9cIithcnJheXNbaV0udGV4dHVyZVNpZGUudG9GaXhlZCgyKStcIikpO1xcblwiXG4gICAgICAgICAgKyAgXCJ9XFxuXCJcbiAgICAgICAgICArICBhcnJheXNbaV0udmFsdWVUeXBlK1wiIFwiK2FycmF5c1tpXS5uYW1lK1wiKGludCBpZHgpe1xcblwiXG4gICAgICAgICAgKyAgXCIgIHJldHVybiBcIithcnJheXNbaV0ubmFtZStcIihmbG9hdChpZHgpKTtcXG5cIlxuICAgICAgICAgICsgIFwifVxcblwiO1xuXG4gICAgICB2YXIgc2V0dGVyRm5zID0gXCJcIjtcbiAgICAgIGZvciAodmFyIGk9MDsgaTxtYXhSZXN1bHRzOyArK2kpe1xuICAgICAgICBzZXR0ZXJGbnMgKz0gXCJ2b2lkIHNldFwiK2krXCIoaW50IGlcIitpK1wiLCBpbnQgZFwiK2krXCIsIGZsb2F0IHZcIitpK1wiKXtcXG5cIjtcbiAgICAgICAgc2V0dGVyRm5zICs9IFwiICByZXN1bHRzW1wiKyhpKjIrMCkrXCJdID0gcGFja0luZGV4RGVwdGgoaVwiK2krXCIrMSwgZFwiK2krXCIpO1xcblwiXG4gICAgICAgIHNldHRlckZucyArPSBcIiAgcmVzdWx0c1tcIisoaSoyKzEpK1wiXSA9IHBhY2tGbG9hdCh2XCIraStcIik7XFxuXCJcbiAgICAgICAgc2V0dGVyRm5zICs9IFwifVxcblwiO1xuICAgICAgICBzZXR0ZXJGbnMgKz0gXCJ2b2lkIHNldFwiK2krXCIoaW50IGlcIitpK1wiLCBpbnQgZFwiK2krXCIsIHZlYzQgdlwiK2krXCIpe1xcblwiO1xuICAgICAgICBzZXR0ZXJGbnMgKz0gXCIgIHJlc3VsdHNbXCIrKGkqMiswKStcIl0gPSBwYWNrSW5kZXhEZXB0aChpXCIraStcIisxLCBkXCIraStcIik7XFxuXCJcbiAgICAgICAgc2V0dGVyRm5zICs9IFwiICByZXN1bHRzW1wiKyhpKjIrMSkrXCJdID0gcGFja1ZlYzQodlwiK2krXCIpO1xcblwiXG4gICAgICAgIHNldHRlckZucyArPSBcIn1cXG5cIjtcbiAgICAgIH07XG5cbiAgICAgIHZhciB3cml0ZVRvVGV4dHVyZSA9IFwiXCI7XG4gICAgICBmb3IgKHZhciBpPTA7IGk8bWF4UmVzdWx0cyoyOyArK2kpXG4gICAgICAgIHdyaXRlVG9UZXh0dXJlICs9IFwiICBpZiAoaWR4ID09IFwiK2krXCIpIGdsX0ZyYWdDb2xvciA9IHJlc3VsdHNbXCIraStcIl07XFxuXCI7XG5cbiAgICAgIHZhciBzZXR0ZXIgPSBcIlwiO1xuICAgICAgZm9yICh2YXIgaT0wOyBpIDwgbWF4UmVzdWx0czsgKytpKXtcbiAgICAgICAgc2V0dGVyICs9IFwiICBzZXRcIitpK1wiKFwiO1xuICAgICAgICBzZXR0ZXIgKz0gaSA8IHVzZWRSZXN1bHRzXG4gICAgICAgICAgPyBzZXR0ZXJzW2ldLmluZGV4K1wiLCBcIlxuICAgICAgICAgICAgKyAoc2V0dGVyc1tpXS5kZXB0aHx8XCIxXCIpK1wiLCBcIlxuICAgICAgICAgICAgKyBzZXR0ZXJzW2ldLnZhbHVlXG4gICAgICAgICAgOiBcIjAsIDAsIHZlYzQoMC4wKVwiO1xuICAgICAgICBzZXR0ZXIgKz0gXCIpO1xcblwiO1xuICAgICAgfTtcblxuICAgICAgdmFyIHZlcnRleFNoYWRlciA9IFtcbiAgICAgICAgXCJwcmVjaXNpb24gaGlnaHAgZmxvYXQ7XCIsXG4gICAgICAgIFwidW5pZm9ybSBmbG9hdCByZXN1bHRUZXh0dXJlU2lkZTtcIixcbiAgICAgICAgXCJ1bmlmb3JtIGZsb2F0IHJlc3VsdEdyaWRTaWRlO1wiLFxuICAgICAgICBcInVuaWZvcm0gZmxvYXQgcmVzdWx0U3F1YXJlU2lkZTtcIixcbiAgICAgICAgXCJhdHRyaWJ1dGUgZmxvYXQgcmVzdWx0SW5kZXg7XCIsXG4gICAgICAgIFwidmFyeWluZyBmbG9hdCByZXN1bHRJbmRleFZhcjtcIixcbiAgICAgICAgXCJ2YXJ5aW5nIHZlYzQgcmVzdWx0c1tcIisobWF4UmVzdWx0cyoyKStcIl07XCIsXG4gICAgICAgIGRlZmF1bHRMaWIsXG4gICAgICAgIGdldHRlcnMsXG4gICAgICAgIHNldHRlckZucyxcbiAgICAgICAgdXNlckxpYixcbiAgICAgICAgXCJ2ZWM0IHNjYWxlVG9TY3JlZW4odmVjMiBwb3Mpe1wiLFxuICAgICAgICBcIiAgdmVjMiBzY3JlZW5Db29yZCA9IHNjYWxlUmFuZ2UodmVjMigwLjAsMC4wKSwgdmVjMihyZXN1bHRHcmlkU2lkZSksIHZlYzIoLTEuMCksIHZlYzIoLTEuMCtyZXN1bHRTcXVhcmVTaWRlKnJlc3VsdEdyaWRTaWRlL3Jlc3VsdFRleHR1cmVTaWRlKjIuMCksIHBvcyk7XCIsXG4gICAgICAgIFwiICByZXR1cm4gdmVjNChzY3JlZW5Db29yZCArIHZlYzIocmVzdWx0U3F1YXJlU2lkZSkvcmVzdWx0VGV4dHVyZVNpZGUsIDEuMCwgMS4wKTtcIixcbiAgICAgICAgXCJ9XCIsXG4gICAgICAgIFwidm9pZCBtYWluKCl7XCIsXG4gICAgICAgIFwiICBpbnQgaSA9IGludChyZXN1bHRJbmRleCk7XCIsXG4gICAgICAgIFwiICBmbG9hdCBmID0gcmVzdWx0SW5kZXg7XCIsXG4gICAgICAgIHRhc2tXaXRob3V0U2V0dGVycyxcbiAgICAgICAgc2V0dGVyLFxuICAgICAgICBcIiAgZ2xfUG9pbnRTaXplID0gcmVzdWx0U3F1YXJlU2lkZTtcIixcbiAgICAgICAgXCIgIGdsX1Bvc2l0aW9uID0gc2NhbGVUb1NjcmVlbihpbmRleFRvUG9zKHZlYzIocmVzdWx0R3JpZFNpZGUpLCByZXN1bHRJbmRleCkpO1wiLFxuICAgICAgICBcIiAgcmVzdWx0SW5kZXhWYXIgPSByZXN1bHRJbmRleDtcIixcbiAgICAgICAgXCJ9XCJdLmpvaW4oXCJcXG5cIilcblxuICAgICAgdmFyIGZyYWdtZW50U2hhZGVyID0gW1xuICAgICAgICBcInByZWNpc2lvbiBoaWdocCBmbG9hdDtcIixcbiAgICAgICAgXCJ2YXJ5aW5nIGZsb2F0IHJlc3VsdEluZGV4VmFyO1wiLFxuICAgICAgICBcInZhcnlpbmcgdmVjNCByZXN1bHRzW1wiKyhtYXhSZXN1bHRzKjIpK1wiXTtcIixcbiAgICAgICAgXCJ1bmlmb3JtIGZsb2F0IHJlc3VsdFNxdWFyZVNpZGU7XCIsXG4gICAgICAgIGRlZmF1bHRMaWIsXG4gICAgICAgIFwidm9pZCBtYWluKCl7XCIsXG4gICAgICAgIFwiICB2ZWMyIGNvb3JkID0gZmxvb3IoZ2xfUG9pbnRDb29yZCAqIHJlc3VsdFNxdWFyZVNpZGUpO1wiLFxuICAgICAgICBcIiAgaW50IGlkeCA9IGludCgocmVzdWx0U3F1YXJlU2lkZS0xLjAtY29vcmQueSkgKiByZXN1bHRTcXVhcmVTaWRlICsgY29vcmQueCk7XCIsXG4gICAgICAgIHdyaXRlVG9UZXh0dXJlLFxuICAgICAgICBcIn1cIl0uam9pbihcIlxcblwiKTtcbiAgICAgICAgXG4gICAgICAgIHZhciBzaGFkZXIgPSBidWlsZFNoYWRlcih2ZXJ0ZXhTaGFkZXIsIGZyYWdtZW50U2hhZGVyKTtcblxuICAgICAgICByZXR1cm4gc2hhZGVyQnlUYXNrW3Rhc2tdID0ge1xuICAgICAgICAgIHVzZXNEZXB0aDogdXNlc0RlcHRoLFxuICAgICAgICAgIHNoYWRlcjogc2hhZGVyLFxuICAgICAgICAgIG1heFJlc3VsdHM6IG1heFJlc3VsdHMsXG4gICAgICAgICAgcmVzdWx0QXJyYXlOYW1lOiByZXN1bHRBcnJheU5hbWV9O1xuICAgIH07XG5cbiAgICAvLyAqTW9ua2V5cyA9PiBOdW1iZXIsIFN0cmluZyAtPiBNb25rZXlzXG4gICAgZnVuY3Rpb24gd29yayhtb25rZXlDb3VudCwgdGFzayl7XG4gICAgICB2YXIgc2hhZGVyT2JqZWN0ID0gYnVpbGRTaGFkZXJGb3JUYXNrKHRhc2spO1xuICAgICAgdmFyIHNoYWRlciA9IHNoYWRlck9iamVjdC5zaGFkZXI7XG4gICAgICB2YXIgbWF4UmVzdWx0cyA9IHNoYWRlck9iamVjdC5tYXhSZXN1bHRzO1xuICAgICAgdmFyIHJlc3VsdEFycmF5TmFtZSA9IHNoYWRlck9iamVjdC5yZXN1bHRBcnJheU5hbWU7XG4gICAgICB2YXIgdXNlc0RlcHRoID0gc2hhZGVyT2JqZWN0LnVzZXNEZXB0aDtcblxuICAgICAgdmFyIG91dHB1dCA9IGFycmF5QnlOYW1lW3Jlc3VsdEFycmF5TmFtZV07XG5cbiAgICAgIHZhciByZXN1bHRTcXVhcmVTaWRlID0gZml0VGV4dHVyZVNpZGUobWF4UmVzdWx0cyoyKTtcbiAgICAgIHZhciByZXN1bHRHcmlkU2lkZSA9IGZpdFRleHR1cmVTaWRlKG1vbmtleUNvdW50KTtcbiAgICAgIHZhciB1c2VkUmVzdWx0VGV4dHVyZVNpZGUgPSByZXN1bHRHcmlkU2lkZSAqIHJlc3VsdFNxdWFyZVNpZGU7XG5cbiAgICAgIGdsLnVzZVByb2dyYW0oc2hhZGVyKTtcbiAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCByYW5nZWJ1ZmZlcik7XG4gICAgICBnbC5iaW5kRnJhbWVidWZmZXIoZ2wuRlJBTUVCVUZGRVIsIGZyYW1lYnVmZmVyKTtcbiAgICAgIGdsLnVuaWZvcm0xZihnbC5nZXRVbmlmb3JtTG9jYXRpb24oc2hhZGVyLFwicmVzdWx0R3JpZFNpZGVcIiksIHJlc3VsdEdyaWRTaWRlKTtcbiAgICAgIGdsLnVuaWZvcm0xZihnbC5nZXRVbmlmb3JtTG9jYXRpb24oc2hhZGVyLFwicmVzdWx0U3F1YXJlU2lkZVwiKSwgcmVzdWx0U3F1YXJlU2lkZSk7XG4gICAgICBnbC51bmlmb3JtMWYoZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHNoYWRlcixcInJlc3VsdFRleHR1cmVTaWRlXCIpLCByZXN1bHRUZXh0dXJlU2lkZSk7XG4gICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGdsLmdldEF0dHJpYkxvY2F0aW9uKHNoYWRlcixcInJlc3VsdEluZGV4XCIpLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgICAgZ2wuZW5hYmxlVmVydGV4QXR0cmliQXJyYXkoZ2wuZ2V0QXR0cmliTG9jYXRpb24oc2hhZGVyLFwicmVzdWx0SW5kZXhcIikpO1xuICAgICAgZ2wuZnJhbWVidWZmZXJUZXh0dXJlMkQoZ2wuRlJBTUVCVUZGRVIsIGdsLkNPTE9SX0FUVEFDSE1FTlQwLCBnbC5URVhUVVJFXzJELCByZXN1bHRUZXh0dXJlLCAwKTtcbiAgICAgIGdsLmZyYW1lYnVmZmVyUmVuZGVyYnVmZmVyKGdsLkZSQU1FQlVGRkVSLCBnbC5ERVBUSF9BVFRBQ0hNRU5ULCBnbC5SRU5ERVJCVUZGRVIsIG51bGwpO1xuICAgICAgZ2wudmlld3BvcnQoMCwgMCwgcmVzdWx0VGV4dHVyZVNpZGUsIHJlc3VsdFRleHR1cmVTaWRlKTtcbiAgICAgIGZvciAodmFyIGk9MCwgbD1hcnJheXMubGVuZ3RoOyBpPGw7ICsraSl7XG4gICAgICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTAraSk7XG4gICAgICAgIGdsLmJpbmRUZXh0dXJlKGdsLlRFWFRVUkVfMkQsIGFycmF5c1tpXS50ZXh0dXJlKTtcbiAgICAgICAgZ2wudW5pZm9ybTFpKGdsLmdldFVuaWZvcm1Mb2NhdGlvbihzaGFkZXIsYXJyYXlzW2ldLnRleHR1cmVOYW1lKSwgaSk7XG4gICAgICB9XG4gICAgICBnbC5kcmF3QXJyYXlzKGdsLlBPSU5UUywgMCwgbW9ua2V5Q291bnQpO1xuXG4gICAgICBpZiAodXNlc0RlcHRoKSBnbC5lbmFibGUoZ2wuREVQVEhfVEVTVCk7XG4gICAgICBnbC51c2VQcm9ncmFtKHdyaXRlcik7XG4gICAgICBnbC5hY3RpdmVUZXh0dXJlKGdsLlRFWFRVUkUwKTtcbiAgICAgIGdsLmJpbmRUZXh0dXJlKGdsLlRFWFRVUkVfMkQsIHJlc3VsdFRleHR1cmUpO1xuICAgICAgZ2wudW5pZm9ybTFpKGdsLmdldFVuaWZvcm1Mb2NhdGlvbih3cml0ZXIsXCJyZXN1bHRUZXh0dXJlXCIpLCByZXN1bHRUZXh0dXJlKTtcbiAgICAgIGdsLnVuaWZvcm0xZihnbC5nZXRVbmlmb3JtTG9jYXRpb24od3JpdGVyLFwicmVzdWx0R3JpZFNpZGVcIiksIHJlc3VsdEdyaWRTaWRlKTtcbiAgICAgIGdsLnVuaWZvcm0xZihnbC5nZXRVbmlmb3JtTG9jYXRpb24od3JpdGVyLFwicmVzdWx0U3F1YXJlU2lkZVwiKSwgcmVzdWx0U3F1YXJlU2lkZSk7XG4gICAgICBnbC51bmlmb3JtMWYoZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHdyaXRlcixcInJlc3VsdFRleHR1cmVTaWRlXCIpLCByZXN1bHRUZXh0dXJlU2lkZSk7XG4gICAgICBnbC51bmlmb3JtMWYoZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHdyaXRlcixcInRhcmdldFRleHR1cmVTaWRlXCIpLCBvdXRwdXQudGV4dHVyZVNpZGUpO1xuICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihnbC5nZXRBdHRyaWJMb2NhdGlvbih3cml0ZXIsXCJyZXN1bHRJbmRleFwiKSwgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcbiAgICAgIGdsLmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KGdsLmdldEF0dHJpYkxvY2F0aW9uKHdyaXRlcixcInJlc3VsdEluZGV4XCIpKTtcbiAgICAgIGdsLmZyYW1lYnVmZmVyVGV4dHVyZTJEKGdsLkZSQU1FQlVGRkVSLCBnbC5DT0xPUl9BVFRBQ0hNRU5UMCwgZ2wuVEVYVFVSRV8yRCwgb3V0cHV0LnRleHR1cmUsIDApO1xuICAgICAgZ2wudmlld3BvcnQoMCwgMCwgb3V0cHV0LnRleHR1cmVTaWRlLCBvdXRwdXQudGV4dHVyZVNpZGUpO1xuICAgICAgaWYgKHVzZXNEZXB0aCl7XG4gICAgICAgIGdsLmZyYW1lYnVmZmVyUmVuZGVyYnVmZmVyKGdsLkZSQU1FQlVGRkVSLCBnbC5ERVBUSF9BVFRBQ0hNRU5ULCBnbC5SRU5ERVJCVUZGRVIsIG91dHB1dC5kZXB0aGJ1ZmZlcik7XG4gICAgICAgIGdsLmNsZWFyKGdsLkRFUFRIX0JVRkZFUl9CSVQpXG4gICAgICB9O1xuICAgICAgZ2wuZHJhd0FycmF5cyhnbC5QT0lOVFMsIDAsIG1vbmtleUNvdW50KnJlc3VsdFNxdWFyZVNpZGUqcmVzdWx0U3F1YXJlU2lkZS8yKTtcbiAgICAgIGlmICh1c2VzRGVwdGgpIGdsLmRpc2FibGUoZ2wuREVQVEhfVEVTVCk7XG4gICAgICByZXR1cm4gbW9ua2V5c0FwaTtcbiAgICB9O1xuXG4gICAgLy8gQWxsb3dzIHJlbmRlcmluZyBhcnJheXMgdG8gYSBDYW52YXMgZm9yIHZpc3VhbGl6YXRpb25cbiAgICAvLyAqTW9ua2V5cyA9PiBTdHJpbmcsIE51bWJlciwgTnVtYmVyIC0+IE1heWJlIENhbnZhc1xuICAgIGZ1bmN0aW9uIHJlbmRlcihuYW1lLCB3aWR0aCwgaGVpZ2h0KXtcbiAgICAgIGlmIChnbC5jYW52YXMgJiYgYXJyYXlCeU5hbWVbbmFtZV0pe1xuICAgICAgICBnbC5jYW52YXMud2lkdGggPSB3aWR0aDtcbiAgICAgICAgZ2wuY2FudmFzLmhlaWdodCA9IGhlaWdodDtcbiAgICAgICAgZ2wudXNlUHJvZ3JhbShyZW5kZXJlcik7XG4gICAgICAgIGdsLnZpZXdwb3J0KDAsIDAsIHdpZHRoLCBoZWlnaHQpO1xuXG4gICAgICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTApO1xuICAgICAgICBnbC5iaW5kVGV4dHVyZShnbC5URVhUVVJFXzJELCBhcnJheUJ5TmFtZVtuYW1lXS50ZXh0dXJlKTtcblxuICAgICAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgcmVuZGVyZXJWZXJ0ZXhCdWZmZXIpO1xuICAgICAgICB2YXIgdmVydGV4UG9zQXR0ciA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHJlbmRlcmVyLCBcInZlcnRleFBvc1wiKVxuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKHZlcnRleFBvc0F0dHIsIDIsIGdsLkZMT0FULCBmYWxzZSwgMCwgMCk7XG4gICAgICAgIGdsLmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KHZlcnRleFBvc0F0dHIpO1xuICAgICAgICBnbC5iaW5kRnJhbWVidWZmZXIoZ2wuRlJBTUVCVUZGRVIsIG51bGwpO1xuXG4gICAgICAgIGdsLmRyYXdBcnJheXMoZ2wuVFJJQU5HTEVTLCAwLCA2KTtcbiAgICAgICAgcmV0dXJuIGdsLmNhbnZhcztcbiAgICAgIH1cbiAgICAgIHJldHVybiBudWxsO1xuICAgIH07XG5cbiAgICAvLyAqTW9ua2V5cyA9PiBTdHJpbmcgLT4gTW9ua2V5c1xuICAgIGZ1bmN0aW9uIGxpYihzb3VyY2Upe1xuICAgICAgdXNlckxpYiA9IHNvdXJjZTtcbiAgICAgIHJldHVybiBtb25rZXlzQXBpO1xuICAgIH07XG5cbiAgICAvLyBNb25rZXlzID0+IFN0cmluZyAtPiBTdHJpbmdcbiAgICBmdW5jdGlvbiBzdHJpbmdpZnkobmFtZSl7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoZ2V0KG5hbWUpKTtcbiAgICB9O1xuXG4gICAgLy8gTW9ua2V5cyA9PiBTdHJpbmcgLT4gSU8gKClcbiAgICBmdW5jdGlvbiBsb2cobmFtZSl7XG4gICAgICBjb25zb2xlLmxvZyhzdHJpbmdpZnkobmFtZSkpXG4gICAgfTtcblxuICAgIHZhciBtb25rZXlzQXBpID0ge1xuICAgICAgc2V0OiBzZXQsXG4gICAgICBnZXQ6IGdldCxcbiAgICAgIGRlbDogZGVsLFxuICAgICAgbGliOiBsaWIsXG4gICAgICB3b3JrOiB3b3JrLFxuICAgICAgY2xlYXI6IGNsZWFyLFxuICAgICAgcmVuZGVyOiByZW5kZXIsXG4gICAgICBzdHJpbmdpZnk6IHN0cmluZ2lmeSxcbiAgICAgIGxvZzogbG9nXG4gICAgfTtcblxuICAgIHJldHVybiBpbml0KCk7XG4gIH1cblxuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpXG4gICAgZXhwb3J0cy5XZWJNb25rZXlzID0gV2ViTW9ua2V5cztcblxuICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIilcbiAgICBtb2R1bGUuZXhwb3J0cyA9IFdlYk1vbmtleXM7XG59KTtcblxuZnVuY3Rpb24gbG9hZChyb290LCBmYWN0b3J5KSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICAvLyBhbWRcbiAgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZClcbiAgICAvLyByZWdpc3RlciBhcyBhbiBhbm9ueW1vdXMgbW9kdWxlXG4gICAgZGVmaW5lKFtdLCBmYWN0b3J5KTtcblxuICAvLyBjb21tb25qc1xuICBlbHNlIGlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIGV4cG9ydHMubm9kZU5hbWUgIT09ICdzdHJpbmcnKVxuICAgIGZhY3RvcnkoZXhwb3J0cyk7XG5cbiAgLy8gYnJvd3NlciBnbG9iYWxzXG4gIGVsc2VcbiAgICBmYWN0b3J5KHJvb3QpO1xuXG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbigpe1xuICAvLyB0eXBlIEF0b21zQ0xpc3QgPSDiiIAgYSAuICgjVmVjdG9yMywgI1ZlY3RvcjMsIGEgLT4gYSksIGEgLT4gYVxuICAvLyBWZWN0b3IzIHZhbHVlcyBhcmUgZXhwYW5kZWQgKHNwbGF0KSBvbiB0aGUgY2FsbGJhY2sgZnVuY3Rpb24gY2FsbFxuLy8gICBFeGFtcGxlOiBib3goOCw4LDgpKGZ1bmN0aW9uKHgseSx6LG54LG55LG56LGluaXQpeyAuLi4gfSwgaW5pdCk7XG5cbiAgLy8gTnVtYmVyLCBOdW1iZXIsIE51bWJlciwgTnVtYmVyIC0+IEF0b21zQ0xpc3RcbiAgZnVuY3Rpb24gc3BoZXJlKGN4LCBjeSwgY3osIHIpe1xuICAgIHZhciBzcXJ0ID0gTWF0aC5zcXJ0O1xuICAgIHZhciByb3VuZCA9IE1hdGgucm91bmQ7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGNvbnMsIG5pbCl7XG4gICAgICBmb3IgKHZhciB5ID0gLXI7IHkgPCByOyArK3kpe1xuICAgICAgICB2YXIgeGwgPSByb3VuZChzcXJ0KHIqciAtIHkqeSkpO1xuICAgICAgICBmb3IgKHZhciB4ID0gLXhsOyB4IDwgeGw7ICsreCl7XG4gICAgICAgICAgaWYgKHgqeCArIHkqeSA8IHIqcil7XG4gICAgICAgICAgICB2YXIgeiA9IHJvdW5kKHNxcnQocipyIC0geCp4IC0geSp5KSk7XG4gICAgICAgICAgICBuaWwgPSBjb25zKGN4K3gsIGN5K3ksIGN6LXosIG5pbCk7XG4gICAgICAgICAgICBuaWwgPSBjb25zKGN4K3gsIGN5K3ksIGN6K3osIG5pbCk7XG4gICAgICAgICAgfTtcbiAgICAgICAgfTtcbiAgICAgIH07XG4gICAgICByZXR1cm4gbmlsO1xuICAgIH07XG4gIH07XG5cbiAgLy8gTnVtYmVyLCBOdW1iZXIsIE51bWJlciAtPiBBdG9tc0NMaXN0XG4gIC8vIEV2ZXJ5IGdyaWQgcG9zaXRpb24gb2YgdGhlIGJveCB3aXRoIGRpbWVuc2lvbnMgKHcsaCxkKS5cbiAgZnVuY3Rpb24gYm94KHcsIGgsIGQpe1xuICAgIHJldHVybiBmdW5jdGlvbihjb25zLCBuaWwpe1xuICAgICAgZnVuY3Rpb24gcmVnaXN0ZXIoeCwgeSwgeil7XG4gICAgICAgIHZhciBueCA9IHggPT09IC13ID8gLTEgOiB4ID09PSB3ID8gMSA6IDA7XG4gICAgICAgIHZhciBueSA9IHkgPT09IC1oID8gLTEgOiB5ID09PSBoID8gMSA6IDA7XG4gICAgICAgIHZhciBueiA9IHogPT09IC1kID8gLTEgOiB6ID09PSBkID8gMSA6IDA7XG4gICAgICAgIHZhciBubCA9IE1hdGguc3FydChueCpueCtueSpueStueipueik7XG4gICAgICAgIG5pbCA9IGNvbnMoeCwgeSwgeiwgbngvbmwsIG55L25sLCBuei9ubCk7XG4gICAgICB9O1xuICAgICAgZm9yICh2YXIgeT0taDsgeTw9aDsgKyt5KVxuICAgICAgICBmb3IgKHZhciB4PS13OyB4PD13OyArK3gpXG4gICAgICAgICAgcmVnaXN0ZXIoeCwgeSwgIGQpLFxuICAgICAgICAgIHJlZ2lzdGVyKHgsIHksIC1kKTtcbiAgICAgIGZvciAodmFyIHo9LWQrMTsgejxkOyArK3opXG4gICAgICAgIGZvciAodmFyIHg9LXc7IHg8PXc7ICsreClcbiAgICAgICAgICByZWdpc3Rlcih4LCAgaCwgeiksXG4gICAgICAgICAgcmVnaXN0ZXIoeCwgLWgsIHopO1xuICAgICAgZm9yICh2YXIgej0tZCsxOyB6PGQ7ICsreilcbiAgICAgICAgZm9yICh2YXIgeT0taCsxOyB5PGg7ICsreSlcbiAgICAgICAgICByZWdpc3RlciggdywgeSwgeiksXG4gICAgICAgICAgcmVnaXN0ZXIoLXcsIHksIHopO1xuICAgICAgcmV0dXJuIG5pbDtcbiAgICB9O1xuICB9O1xuXG4gIC8vIE51bWJlciwgTnVtYmVyLCBOdW1iZXIgLT4gQXRvbXNDTGlzdFxuICBmdW5jdGlvbiBibG9jayh3LCBoLCBkKXtcbiAgICByZXR1cm4gZnVuY3Rpb24oY29ucywgbmlsKXtcbiAgICAgIGZvciAodmFyIHo9LWQ7IHo8PWQ7ICsreilcbiAgICAgICAgZm9yICh2YXIgeT0taDsgeTw9aDsgKyt5KVxuICAgICAgICAgIGZvciAodmFyIHg9LXc7IHg8PXc7ICsreClcbiAgICAgICAgICAgIG5pbCA9IGNvbnMoeCwgeSwgeiksXG4gICAgICAgICAgICBuaWwgPSBjb25zKHgsIHksIHopO1xuICAgICAgcmV0dXJuIG5pbDtcbiAgICB9O1xuICB9O1xuXG5cbiAgLy8gTnVtYmVyLCBOdW1iZXIsIE51bWJlciwgTnVtYmVyLCBSR0JBOCAtPiBWb3hlbHNcbiAgZnVuY3Rpb24gc3BoZXJlVm94ZWxzKGN4LCBjeSwgY3osIHIsIGNvbCl7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGNvbnMsIG5pbCl7XG4gICAgICBzcGhlcmUoY3gsIGN5LCBjeiwgcikoZnVuY3Rpb24oeCwgeSwgeiwgcmVzKXtcbiAgICAgICAgcmV0dXJuIGNvbnMoeCwgeSwgeiwgY29sLCByZXMpO1xuICAgICAgfSwgbmlsKTtcbiAgICB9O1xuICB9O1xuXG4gIHJldHVybiB7XG4gICAgc3BoZXJlOiBzcGhlcmUsXG4gICAgYm94OiBib3gsXG4gICAgYmxvY2s6IGJsb2NrLFxuICAgIHNwaGVyZVZveGVsczogc3BoZXJlVm94ZWxzfTtcbn0pKCk7XG4iXX0=
