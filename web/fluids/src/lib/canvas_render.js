// @flow

import {
  createProgram, loadShader, renderToBottomLeft, renderToBottomRight, renderToCanvas, renderToTopLeft,
  renderToTopRight
} from "../gl_util";
import {toGridClipcoords, toGridTexcoords} from "./grids";
import {TwoPhaseRenderTarget} from "./render_targets";
import type {GL, GLLocation, GLProgram, GLVAO} from "./gl_types";
import type {
  Divergence} from "./types";
import type {
  Correction, FinestGrid, Multigrid, Pressure, Residual, RightHandSide, Solution, StaggerXGrid,
  StaggerYGrid
} from "./types";
import {Render} from "./render";
import {GPUTimer} from "./gpu_timer";

export class CanvasRender extends Render {
  gl: GL;
  nx: number;
  ny: number;
  velocityX: StaggerXGrid;
  velocityY: StaggerYGrid;

  airDistance: FinestGrid;
  solidDistance: FinestGrid;
  pressure: Pressure;
  residuals: Residual & FinestGrid;
  multigrid: Solution & Multigrid;
  residualsMultigrid: Residual & Multigrid;
  dye: FinestGrid;
  corrections: Correction & FinestGrid;
  correctionsMultigrid: Correction & Multigrid;
  divergence: Divergence;
  rightHandSideMultigrid: RightHandSide & Multigrid;

  program: GLProgram;
  vao: GLVAO;
  solidDistanceLocation: GLLocation;
  airDistanceLocation: GLLocation;
  uniformTextureLocation: GLLocation;
  normalizerLocation: GLLocation;

  constructor(gl: any,
              nx: number,
              ny: number,
              velocityX: TwoPhaseRenderTarget,
              velocityY: TwoPhaseRenderTarget,
              airDistance: TwoPhaseRenderTarget,
              solidDistance: TwoPhaseRenderTarget,
              pressure: TwoPhaseRenderTarget,
              residuals: TwoPhaseRenderTarget,
              multigrid: TwoPhaseRenderTarget,
              residualsMultigrid: TwoPhaseRenderTarget,
              dye: TwoPhaseRenderTarget,
              corrections: TwoPhaseRenderTarget,
              correctionsMultigrid: TwoPhaseRenderTarget,
              divergence: TwoPhaseRenderTarget,
              rightHandSideMultigrid: TwoPhaseRenderTarget,
              timer: GPUTimer) {
    super(timer, "canvas");
    this.gl = gl;
    this.nx = nx;
    this.ny = ny;
    this.velocityX = velocityX;
    this.velocityY = velocityY;
    this.airDistance = airDistance;
    this.solidDistance = solidDistance;
    this.pressure = pressure;
    this.residuals = residuals;
    this.multigrid = multigrid;
    this.residualsMultigrid = residualsMultigrid;
    this.dye = dye;
    this.corrections = corrections;
    this.correctionsMultigrid = correctionsMultigrid;
    this.divergence = divergence;
    this.rightHandSideMultigrid = rightHandSideMultigrid;
    this.initialize(gl);
  }

  initialize(gl: GL) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, canvasVertexShaderSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, canvasFragmentShaderSource);
    this.program = createProgram(gl, vertexShader, fragmentShader);

    // this is important
    gl.useProgram(this.program);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.setupPositions(gl, this.program);
    gl.bindVertexArray(null);

    this.uniformTextureLocation = gl.getUniformLocation(this.program, "u_texture");
    this.airDistanceLocation = gl.getUniformLocation(this.program, "airDistance");
    this.solidDistanceLocation = gl.getUniformLocation(this.program, "solidDistance");
    this.normalizerLocation = gl.getUniformLocation(this.program, "normalizer");

    gl.uniformMatrix4fv(
        gl.getUniformLocation(this.program, "toGridClipcoords"),
        false, toGridClipcoords(this.nx, this.ny));
    gl.uniformMatrix4fv(
        gl.getUniformLocation(this.program, "toGridTexcoords"),
        false, toGridTexcoords(this.nx, this.ny));
  }

  setupPositions(gl: GL, program: GLProgram) {
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      // top right triangle
      0, this.ny,
      this.nx, this.ny,
      this.nx, 0,

      // bottom left triangle
      0, 0,
      this.nx, 0,
      0, this.ny
    ]), gl.STATIC_DRAW);

    const positionAttributeLocation = gl.getAttribLocation(program, "a_gridcoords");
    // Turn on the attribute
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(
        positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
  }

  doRender() {
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.airDistance.useAsTexture(this.airDistanceLocation);
    this.solidDistance.useAsTexture(this.solidDistanceLocation);
    renderToCanvas(this.gl);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    renderToTopLeft(this.gl);
    this.gl.uniform1f(this.normalizerLocation, 10000.0);
    this.dye.useAsTexture(this.uniformTextureLocation);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    renderToTopRight(this.gl);
    this.gl.uniform1f(this.normalizerLocation, 1.0);
    this.divergence.useAsTexture(this.uniformTextureLocation);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    renderToBottomLeft(this.gl);
    this.gl.uniform1f(this.normalizerLocation, 2.0);
    this.gl.uniformMatrix4fv(
        this.gl.getUniformLocation(this.program, "toGridTexcoords"),
        false, toGridTexcoords(this.multigrid.width, this.multigrid.height));
    this.velocityX.useAsTexture(this.uniformTextureLocation);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    renderToBottomRight(this.gl);
    this.gl.uniform1f(this.normalizerLocation, 1.0);
    this.velocityY.useAsTexture(this.uniformTextureLocation);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);


    this.gl.bindVertexArray(null);
  }
}

const canvasVertexShaderSource = `
in vec4 a_gridcoords;

out vec4 v_gridcoords;

uniform mat4 toGridClipcoords;

void main() {
  v_gridcoords = a_gridcoords;
  gl_Position = toGridClipcoords * (a_gridcoords - vec4(0.5, 0.5, 0.0, 0.0));
}
`;

const canvasFragmentShaderSource = `
precision mediump float;

in vec4 v_gridcoords;

out vec4 outColor;

uniform mat4 toGridTexcoords;
uniform sampler2D u_texture;
uniform mediump sampler2D airDistance;
uniform mediump sampler2D solidDistance;

uniform float normalizer;

void main() {
  vec4 texcoords = toGridTexcoords * v_gridcoords;
  ivec2 here = ivec2(v_gridcoords.xy);
  
  bool solid = max4(texelFetch(solidDistance, here, 0)) == 0.0;
  bool air = max4(texelFetch(airDistance, here, 0)) == 0.0;
  bool water = !solid && !air;

  float p = texelFetch(u_texture, here, 0).x * normalizer;
  
  if (!water && !air) {
    outColor = vec4(0.2, 0.2, 0.2, 1.0);
  } else if (air) {
    outColor = vec4(0.90, 0.90, 0.97, 1.0);
  } else 
  if (p > 0.0) {
    outColor = vec4(0.0, 0.0, p, 1.0);
  } else if (p != 0.0) {
    outColor = vec4(abs(p), 0.0, 0.0, 1.0);
  } else {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
  } 
  // }
}
`;
