// @flow
export const toGridClipcoords = (nx: number, ny: number): Array<number> => {
  return [
    2 / nx, 0, 0, 0,
    0, 2 / ny, 0, 0,
    0, 0, 1, 0,
    -1 + 1 / nx, -1 + 1 / ny, 0, 1
  ];
};

export const toGridTexcoords = (nx: number, ny: number): Array<number> => {
  return [
    1 / nx, 0, 0, 0,
    0, 1 / ny, 0, 0,
    0, 0, 1, 0,
    0.5 / nx, 0.5 / ny, 0, 1
  ];
};

export const toGridTexcoordsWithOffset = (nx: number, ny: number, offset: number): Array<number> => {
  return [
    1 / nx, 0, 0, 0,
    0, 1 / ny, 0, 0,
    0, 0, 1, 0,
    (0.5 - offset) / nx, (0.5 - offset) / ny, 0, 1
  ]
};

export const toVelocityXClipcoords = (nx: number, ny: number): Array<number> => {
  return toGridClipcoords(nx + 1, ny);
};

export const toVelocityXTexcoords = (nx: number, ny: number): Array<number> => {
  return toGridTexcoords(nx + 1, ny);
};

export const toVelocityYClipcoords = (nx: number, ny: number): Array<number> => {
  return toGridClipcoords(nx, ny + 1);
};

export const toVelocityYTexcoords = (nx: number, ny: number): Array<number> => {
  return toGridTexcoords(nx, ny + 1);
};

export const gridTriangleStripVertices = (nx: number, ny: number): Array<number> => {
  const positions = [];
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < ny; j++) {
      // staggered grid
      positions.push(i, j, i + 1, j);
    }
  }
  return positions;
};

export const gridPointVertices = (nx: number, ny: number): Array<Array<number>> => {
  const positions = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      // staggered grid
      positions.push([i, j]);
    }
  }
  return positions;
};

const airBorder = (ny) => {
  return ny - Math.floor(ny / 12) - 0.5;
};

const solidBorderLeft = (nx) => {
  return Math.floor(nx / 12) - 0.5;
};

const solidBorderRight = (nx: number): number => {
  return nx - Math.floor(nx / 12) - 0.5;
};

const solidBorderBottom = (ny: number): number => {
  return Math.floor(ny / 12) - 0.5;
};

export const waterMask = (nx: number, ny: number): Array<number> => {
  const result = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if ((i > solidBorderLeft(nx)) &&
          (i < solidBorderRight(nx)) &&
          (j > solidBorderBottom(ny)) &&
          (j < airBorder(ny))) {
        result.push(1);
      } else {
        result.push(0);
      }
    }
  }
  return result;
};

export const airDistances = (nx: number, ny: number): Array<Array<number>> => {
  const result = [];
  const borderLeft = solidBorderLeft(nx);
  const borderRight = solidBorderRight(nx);
  const borderBottom = airBorder(ny);
  const isWater = (i, j) => (i > borderLeft && i < borderRight && j > borderBottom);

  const search = (applyOffset, i: number, j: number) => {
    let upperBound = Math.max(nx, ny);
    let lowerBound = 0.0;
    if (!isWater(...applyOffset(i, j, upperBound))) {
      return upperBound;
    }
    while (!isWater(...applyOffset(i, j, lowerBound)) && (upperBound - lowerBound) < 0.05) {
      const testPoint = (upperBound + lowerBound) / 2;
      if (isWater(...applyOffset(i, j, testPoint))) {
        upperBound = testPoint;
      } else {
        lowerBound = testPoint;
      }
    }
    return lowerBound;
  };

  search((a, b, offset) => [a, b + offset], 4, 6);

  // backwards iteration because texImage2D transposes.
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (i === borderLeft || i === borderRight || j === borderBottom) {
        throw new Error("border coincided with grid point");
      }
      const point = [];
      if (isWater(i, j)) {
        point.push(0, 0, 0, 0);
      } else if (i < borderLeft || i > borderRight) {
        point.push(nx, nx, ny, ny);
      } else {
        point.push(nx, nx, ny, borderBottom - j);
      }
      result.push(point);
    }
  }
  return result;
};

export const solidDistances = (nx: number, ny: number): Array<Array<number>> => {
  const result = [];
  const borderLeftEnd = solidBorderLeft(nx);
  const borderRightStart = solidBorderRight(nx);
  const borderBottomEnd = solidBorderBottom(ny);
  // backwards iteration because texImage2D transposes.
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (i === borderLeftEnd || i === borderRightStart || j === borderBottomEnd) {
        throw new Error("border coincided with grid point");
      }
      const point = [];
      if (i < borderLeftEnd || i > borderRightStart || j < borderBottomEnd) {
        point.push(0, 0, 0, 0);
      } else {
        point.push(i - borderLeftEnd, borderRightStart - i, j - borderBottomEnd, ny - j);
      }
      result.push(point);
    }
  }
  return result;
};
