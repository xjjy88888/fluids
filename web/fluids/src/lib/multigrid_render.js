// @flow
import {gridPointVertices} from "./grids";
import {createProgram, loadShader} from "../gl_util";
import type {TwoPhaseRenderTarget} from "./render_targets";
import {flatten} from "./utils";
import type {GL, GLProgram, GLVAO} from "./gl_types";

export class MultigridRender {
  gl: GL;
  nx: number;
  ny: number;

  program: GLProgram;
  vaos: Array<GLVAO>;
  coords: Array<Array<Array<number>>>;

  constructor(gl: any,
              nx: number,
              ny: number,
              vertexShaderSource: string,
              fragmentShaderSource: string) {
    this.gl = gl;
    this.nx = nx;
    this.ny = ny;
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    this.program = createProgram(gl, vertexShader, fragmentShader);
  }

  initialize(gl: GL) {
    gl.useProgram(this.program);
    this.vaos = [];
    this.coords = [];
    this.setupPositions(gl);
    this.bindPositions(gl);
    this.initializeUniforms(gl, this.program);
  }

  initializeUniforms(gl: GL, program: GLProgram) {
    throw new Error("Implement me");
  }

  setupPositions(gl: GL) {
    this.vaos[0] = gl.createVertexArray();
    this.coords[0] = [];
    for (let i = 0; i < this.nx; i++) {
      for (let j = 0; j < this.ny; j++) {
        this.coords[0].push(this.vertexAttributeValues(0, i, j, 0));
      }
    }

    let level = 1;
    let levelNx = Math.floor(this.nx / 2);
    let levelNy = Math.floor(this.ny / 2);
    let offset = 0;

    while (levelNx > 2 && levelNy > 2) {
      console.log(level);
      const levelCoords = [];
      for (let i = 0; i < levelNx; i++) {
        for (let j = 0; j < levelNy; j++) {
          levelCoords.push(this.vertexAttributeValues(level, i, j, offset));
        }
      }
      this.coords[level] = levelCoords;
      this.vaos[level] = gl.createVertexArray();

      this.initializeLevel(level, levelNx, levelNy, offset);

      offset += Math.max(levelNx, levelNy) + 1;
      levelNx = Math.floor(levelNx / 2);
      levelNy = Math.floor(levelNy / 2);
      level += 1;
    }
  }

  initializeLevel(level: number, levelNx: number, levelNy: number, offset: number) {
    throw new Error("Implement me");
  }

  vertexAttributeValues(level: number, i: number, j: number, offset: number) {
    return [i + offset, j + offset];
  }

  bindPositions(gl: GL) {
    gl.useProgram(this.program);
    for (let level = 0; level < this.vaos.length; level++) {
      const buffer = gl.createBuffer();
      gl.bindVertexArray(this.vaos[level]);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(flatten(this.coords[level])), gl.STATIC_DRAW);
      this.bindCoordinateArrays(gl, this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindVertexArray(null);
    }
  }

  bindCoordinateArrays(gl: GL, program: GLProgram) {
    throw new Error("implement me");
  }
}