// @flow

import {OnePhaseRenderTarget, TwoPhaseRenderTarget} from "./render_targets";
import {CanvasRender} from "./canvas_render";
import {BodyForcesRender} from "./body_forces_render";
import {DivergenceRender} from "./divergence_render";
import {MultigridInterpolatePressure} from "./multigrid_interpolate";
import {MultigridRestrictionRender} from "./multigrid_restrict";
import {ResidualsRender} from "./pressure_residuals_render";
import {ErrorCorrectionJacobiRender} from "./error_correction_render";
import {AddCorrectionRender} from "./add_correction_render";
import {airDistances, solidDistances, waterMask} from "./grids";
import {ApplyPressureCorrectionY} from "./apply_pressure_correction_y";
import {ApplyPressureCorrectionX} from "./apply_pressure_correction_x";
import {AdvectionRender} from "./advect_render";
import {flatten} from "./utils";
import type {GL} from "./gl_types";
import {Residual, Solution, Correction, RightHandSide} from "./types";
import {
  Multigrid,
  Pressure
} from "./types";
import {ZeroOutRender} from "./zero_out_render";
import {GPUTimer} from "./gpu_timer";

export class GPUFluid {
  onFrame: (now: number) => void;
  timer: GPUTimer;

  // WebGL2 Context
  gl: GL;
  nx: number;
  dx: number;
  ny: number;
  dy: number;
  dt: number;
  g: number;

  // masks and indicators
  waterMask: FinestGrid;
  airDistance: FinestGrid;
  solidDistance: FinestGrid;

  // render targets
  velocityX: StaggerXGrid;
  velocityY: StaggerYGrid;
  residuals: Residual & FinestGrid;
  pressure: Pressure;
  multigrid: Solution & Multigrid;
  residualsMultigrid: Residual;
  divergence: Divergence;
  rightHandSideMultigrid: RightHandSide & Multigrid;
  dye: FinestGrid;
  corrections: Correction & FinestGrid;
  correctionsMultigrid: Correction & Multigrid;

  // render stages
  bodyForcesRender: BodyForcesRender;
  divergenceRender: DivergenceRender;
  pressureResidualsRender: ResidualsRender;
  restrictResidualsRender: MultigridRestrictionRender;
  interpolatePressureRender: MultigridInterpolatePressure;
  errorCorrectionJacobiRender: ErrorCorrectionJacobiRender;
  addCorrectionRender: AddCorrectionRender;
  applyPressureCorrectionYRender: ApplyPressureCorrectionY;
  applyPressureCorrectionXRender: ApplyPressureCorrectionX;
  advectionRender: AdvectionRender;
  zeroOutRender: ZeroOutRender;
  canvasRender: CanvasRender;

  constructor(gl: GL, onFrame: (now: number) => void, timer: GPUTimer) {
    this.onFrame = onFrame;
    this.timer = timer;
    this.gl = gl;
    const n = 512;
    this.nx = n;
    this.dx = 1.0 / n;
    this.ny = n;
    this.dy = 1.0 / n;
    this.dt = 0.01;
    this.g = -9.8;
    this.initialize(gl);
  }

  initialize(gl: GL) {
    const multigridWidth = this.nx + Math.floor(Math.log2(this.nx)) * 2;
    const multigridHeight = this.ny + Math.floor(Math.log2(this.ny)) * 2;
    this.waterMask = new OnePhaseRenderTarget(gl, "water", gl.TEXTURE0, 0, () => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32I, this.nx, this.ny, 0, gl.RED_INTEGER, gl.INT,
          new Int32Array(waterMask(this.nx, this.ny)));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      // this is important.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }, this.nx, this.ny);
    this.airDistance = new OnePhaseRenderTarget(gl, "air_distance", gl.TEXTURE1, 1, () => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.nx, this.ny, 0, gl.RGBA, gl.FLOAT,
          new Float32Array(flatten(airDistances(this.nx, this.ny))));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      // this is important.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }, this.nx, this.ny);

    this.solidDistance = new OnePhaseRenderTarget(gl, "solid_distance", gl.TEXTURE2, 2, () => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.nx, this.ny, 0, gl.RGBA, gl.FLOAT,
          new Float32Array(flatten(solidDistances(this.nx, this.ny))));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      // this is important.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }, this.nx, this.ny);

    this.velocityX = new TwoPhaseRenderTarget(gl, "u_x", gl.TEXTURE3, 3, () => {
      const data = [];
      for (let j = 0; j < this.ny; j++) {
        for (let i = 0; i < this.nx + 1; i++) {
          if (i === this.nx / 2 && j === this.ny / 2) {
            data.push(0.0);
          } else {
            data.push(0.0);
          }
        }
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.nx + 1, this.ny, 0, gl.RED, gl.FLOAT, new Float32Array(data));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }, this.nx + 1, this.ny);

    this.velocityY = new TwoPhaseRenderTarget(gl, "u_y", gl.TEXTURE4, 4, () => {
      const data = [];
      for (let j = 0; j < this.ny + 1; j++) {
        for (let i = 0; i < this.nx; i++) {
          if (i === this.nx / 2 && j > this.ny / 3 && j < 2 * this.ny / 3) {
            data.push(-j);
            // data.push(0.0);
          } else {
            data.push(0.0);
          }
        }
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.nx, this.ny + 1, 0, gl.RED, gl.FLOAT, new Float32Array(data));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }, this.nx, this.ny + 1);

    this.residuals = new OnePhaseRenderTarget(gl, "residuals", gl.TEXTURE5, 5, () => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.nx, this.ny, 0, gl.RED, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    }, this.nx, this.ny);

    this.pressure = new Pressure(gl, "pressure", gl.TEXTURE6, 6, () => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.nx, this.ny, 0, gl.RED, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    }, this.nx, this.ny);

    this.multigrid = new TwoPhaseRenderTarget(gl, "multigrid", gl.TEXTURE7, 7,
        () => {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F,
              this.nx + Math.floor(Math.log2(this.nx)) * 2,
              this.ny + Math.floor(Math.log2(this.ny)) * 2,
              0, gl.RED, gl.FLOAT, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        },
        this.nx + Math.floor(Math.log2(this.nx)) * 2,
        this.ny + Math.floor(Math.log2(this.ny)) * 2,
        (texture) => {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.R32F, 0, 0, multigridWidth, multigridHeight, 0);
        }
    );

    this.residualsMultigrid = new OnePhaseRenderTarget(gl, "residualsMultigrid", gl.TEXTURE8, 8, () => {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F,
              this.nx + Math.floor(Math.log2(this.nx)) * 2,
              this.ny + Math.floor(Math.log2(this.ny)) * 2,
              0, gl.RED, gl.FLOAT, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        },
        this.nx + Math.floor(Math.log2(this.nx)) * 2,
        this.ny + Math.floor(Math.log2(this.ny)) * 2
    );

    this.dye = new TwoPhaseRenderTarget(gl, "dye", gl.TEXTURE9, 9, () => {
      const data = [];
      for (let j = 0; j < this.ny; j++) {
        for (let i = 0; i < this.nx; i++) {
          if (j === this.ny / 2) {
            data.push(10.0);
          } else {
            data.push(0.0);
          }
        }
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.nx, this.ny, 0, gl.RED, gl.FLOAT, new Float32Array(data));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }, this.nx, this.ny);

    this.corrections = new OnePhaseRenderTarget(gl, "corrections", gl.TEXTURE10, 10, () => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.nx, this.ny, 0, gl.RED, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    }, this.nx, this.ny);

    this.correctionsMultigrid = new OnePhaseRenderTarget(gl, "correctionsMultigrid", gl.TEXTURE11, 11, () => {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F,
              this.nx + Math.floor(Math.log2(this.nx)) * 2,
              this.ny + Math.floor(Math.log2(this.ny)) * 2,
              0, gl.RED, gl.FLOAT, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        },
        this.nx + Math.floor(Math.log2(this.nx)) * 2,
        this.ny + Math.floor(Math.log2(this.ny)) * 2
    );

    this.divergence = new OnePhaseRenderTarget(gl, "divergence", gl.TEXTURE12, 12, () => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.nx, this.ny, 0, gl.RED, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    }, this.nx, this.ny);

    this.rightHandSideMultigrid = new OnePhaseRenderTarget(gl, "rightHandSideMultigrid", gl.TEXTURE13, 13, () => {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F,
              this.nx + Math.floor(Math.log2(this.nx)) * 2,
              this.ny + Math.floor(Math.log2(this.ny)) * 2,
              0, gl.RED, gl.FLOAT, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        },
        this.nx + Math.floor(Math.log2(this.nx)) * 2,
        this.ny + Math.floor(Math.log2(this.ny)) * 2
    );

    this.bodyForcesRender = new BodyForcesRender(gl, this.nx, this.dx, this.ny, this.dy, this.dt,
        this.g, this.solidDistance, this.velocityY, this.timer);
    this.divergenceRender = new DivergenceRender(gl, this.nx, this.dx, this.ny, this.dy, this.divergence,
        this.velocityX, this.velocityY, this.waterMask, this.solidDistance, this.airDistance, this.timer);

    this.pressureResidualsRender = new ResidualsRender(gl, this.nx, this.dx, this.ny, this.dy,
        this.dt, this.waterMask, this.airDistance, this.solidDistance,
        this.pressure, this.divergence,
        this.multigrid, this.residualsMultigrid,
        this.residuals, this.rightHandSideMultigrid, this.timer);

    this.restrictResidualsRender = new MultigridRestrictionRender(gl, this.nx, this.ny, this.residuals,
        this.residualsMultigrid, this.rightHandSideMultigrid, this.waterMask, this.timer);
    this.interpolatePressureRender = new MultigridInterpolatePressure(gl, this.nx, this.ny,
        this.multigrid, this.corrections, this.correctionsMultigrid, this.waterMask, this.timer);

    this.errorCorrectionJacobiRender = new ErrorCorrectionJacobiRender(this.gl, this.nx, this.dx, this.ny, this.dy,
        this.dt, this.waterMask, this.airDistance, this.solidDistance,
        this.pressure, this.divergence, this.multigrid, this.rightHandSideMultigrid,
        this.timer);

    this.addCorrectionRender = new AddCorrectionRender(this.gl, this.nx, this.ny,
        this.pressure, this.corrections,
        this.multigrid, this.correctionsMultigrid,
        this.timer);

    this.applyPressureCorrectionXRender = new ApplyPressureCorrectionX(this.gl, this.nx, this.dx, this.ny, this.dy,
        this.dt, this.pressure, this.velocityX, this.velocityY, this.waterMask, this.timer);
    this.applyPressureCorrectionYRender = new ApplyPressureCorrectionY(this.gl, this.nx, this.dx, this.ny, this.dy,
        this.dt, this.pressure, this.velocityX, this.velocityY, this.waterMask, this.timer);

    this.advectionRender = new AdvectionRender(this.gl, this.nx, this.dx, this.ny, this.dy, this.dt,
        this.velocityX, this.velocityY, this.dye, this.waterMask, this.timer);

    this.zeroOutRender = new ZeroOutRender(this.gl, this.nx, this.ny, this.pressure, this.multigrid,
        this.timer);

    this.canvasRender = new CanvasRender(gl, this.nx, this.ny, this.velocityX, this.velocityY,
        this.airDistance, this.solidDistance,
        this.pressure, this.residuals, this.multigrid, this.residualsMultigrid,
        this.dye, this.corrections, this.correctionsMultigrid, this.divergence, this.rightHandSideMultigrid,
        this.timer);
  }

  errorCorrect(level: number) {
    console.log("smoothing");
    this.errorCorrectionJacobiRender.render(level);
    this.canvasRender.render();
  }

  computeResiduals(level: number) {
    this.pressureResidualsRender.render(level);
    this.canvasRender.render();
  }

  restrictFrom(fromLevel: number) {
    this.restrictResidualsRender.restrictFrom(fromLevel);
    this.canvasRender.render();
  }

  interpolateFrom(fromLevel: number) {
    this.interpolatePressureRender.interpolateTo(fromLevel - 1);
    this.canvasRender.render();
  }

  correct(level: number) {
    this.addCorrectionRender.render(level);
    this.canvasRender.render();
  }

  render() {
    this.bodyForcesRender.render();

    this.advectionRender.advectX();
    this.advectionRender.advectY();
    this.divergenceRender.render();

    this.solvePressure();

    this.applyPressureCorrectionXRender.render();
    this.applyPressureCorrectionYRender.render();

    this.divergenceRender.render();
    this.pressureResidualsRender.render(0);
    this.canvasRender.render();

    this.advectionRender.advectDye();

    this.gl.finish();
    requestAnimationFrame((now) => {
      // this.onFrame(now);
      this.render();
    });
    // setTimeout(() => {
    //   this.render();
    // }, 1000);
  }

  solveLevel(level: number) {
    if (level > 0) {
      this.zeroOutRender.render(level);
    }
    if (level >= Math.max(Math.log2(this.nx), Math.log2(this.ny)) - 4) {
      for (let i = 0; i < 10; i++) {
        this.errorCorrectionJacobiRender.render(level);
      }
    } else {
      this.errorCorrectionJacobiRender.render(level);
      this.errorCorrectionJacobiRender.render(level);
      this.pressureResidualsRender.render(level);
      this.restrictResidualsRender.restrictFrom(level);
      this.solveLevel(level + 1);
      this.addCorrectionRender.render(level);
      this.errorCorrectionJacobiRender.render(level);
    }
    if (level > 0) {
      this.interpolatePressureRender.interpolateTo(level - 1);
    }
  }

  solvePressure() {
    for (let i = 0; i < 10; i++) {
      this.solveLevel(0);
    }
  }
}