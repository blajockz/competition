/*
 * Huruf board geometry and connection rules, shared by the server and the browser.
 * (Ported from huroof-challenge/public/js/hex.js.)
 *
 * The board is n rows by n columns of pointy-top hexagons. Odd rows are pushed
 * half a cell to the right. Cells are numbered row by row: index = row * n + col.
 *
 * Team 0 (the challenger) links the LEFT and RIGHT edges.
 * Team 1 (the defender) links the TOP and BOTTOM edges.
 */
export function neighbors(i, n) {
    const r = Math.floor(i / n);
    const c = i % n;
    const odd = r % 2 === 1;
    const dirs = odd
      ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
      : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
    const out = [];
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n) out.push(nr * n + nc);
    }
    return out;
  }

  function isStart(i, n, team) {
    return team === 0 ? i % n === 0 : i < n;
  }
  function isEnd(i, n, team) {
    return team === 0 ? i % n === n - 1 : i >= n * (n - 1);
  }

  /**
   * Shortest chain of cells owned by `team` that links its two edges.
   * `owners` is an array of -1 / 0 / 1. Returns the cell indices, or null.
   */
  export function findPath(owners, team, n) {
    const prev = new Map();
    const queue = [];
    for (let i = 0; i < n * n; i++) {
      if (owners[i] === team && isStart(i, n, team)) {
        prev.set(i, -1);
        queue.push(i);
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const cur = queue[h];
      if (isEnd(cur, n, team)) {
        const path = [];
        for (let k = cur; k !== -1; k = prev.get(k)) path.push(k);
        return path.reverse();
      }
      for (const nb of neighbors(cur, n)) {
        if (owners[nb] === team && !prev.has(nb)) {
          prev.set(nb, cur);
          queue.push(nb);
        }
      }
    }
    return null;
  }

  /**
   * Drawing geometry for an n x n board with circumradius R.
   * `pad` is the thickness of the coloured team bands around the cells.
   */
  export function geometry(n, R, pad) {
    const w = Math.sqrt(3) * R;
    const W = 2 * pad + n * w + (n > 1 ? w / 2 : 0);
    const H = 2 * pad + 2 * R + (n - 1) * 1.5 * R;
    const cx = (r, c) => pad + w / 2 + c * w + (r % 2 === 1 ? w / 2 : 0);
    const cy = (r) => pad + R + r * 1.5 * R;
    // vertex k: 0 top, 1 upper-right, 2 lower-right, 3 bottom, 4 lower-left, 5 upper-left
    const vtx = (r, c, k, rad = R) => {
      const a = (Math.PI / 180) * (-90 + 60 * k);
      return [cx(r, c) + rad * Math.cos(a), cy(r) + rad * Math.sin(a)];
    };
    const cells = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) cells.push({ r, c, x: cx(r, c), y: cy(r) });
    }
    const hexPoints = (i, rad = R) => {
      const { r, c } = cells[i];
      return [0, 1, 2, 3, 4, 5].map((k) => vtx(r, c, k, rad));
    };

    const last = n - 1;
    const top = [];
    for (let c = 0; c < n; c++) top.push(vtx(0, c, 5), vtx(0, c, 0));
    top.push(vtx(0, last, 1));
    const bottom = [];
    for (let c = 0; c < n; c++) bottom.push(vtx(last, c, 4), vtx(last, c, 3));
    bottom.push(vtx(last, last, 2));
    const left = [];
    for (let r = 0; r < n; r++) left.push(vtx(r, 0, 5), vtx(r, 0, 4));
    const right = [];
    for (let r = 0; r < n; r++) right.push(vtx(r, last, 1), vtx(r, last, 2));

    // Four bands that tile the frame, split on the diagonals from each outer corner.
    const bands = {
      top: [[0, 0], [W, 0], ...top.slice().reverse()],
      bottom: [[0, H], ...bottom, [W, H]],
      left: [[0, 0], ...left, [0, H]],
      right: [[W, 0], ...right, [W, H]],
    };
    const corners = { tl: top[0], tr: top[top.length - 1], bl: bottom[0], br: bottom[bottom.length - 1] };
    return { n, R, pad, w, W, H, cells, hexPoints, bands, corners };
  }

